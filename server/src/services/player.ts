import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { PlayerState, Track } from "../types.js";
import { MpvIpc, type MpvEvent } from "./mpv.js";
import { pushErrorLog } from "./error-log.js";
import { cddaMpvBaseUrl } from "./cd.js";

function defaultSocketPath(): string {
  return join(tmpdir(), "music-player-mpv.sock");
}

export class PlayerService {
  private mpv: MpvIpc;
  private state: PlayerState;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  /** Prevents double queue advance when both `end-file` and `eof-reached` fire. */
  private trackEndInFlight = false;
  private cdTracksById = new Map<string, Track & { path: string }>();
  /** Tracks on current Audio CD (TOC count); used to bound each chapter for sane mpv time-pos/duration. */
  private cdChapterCount = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly socketPath = process.env.MPV_IPC_PATH || defaultSocketPath()
  ) {
    this.mpv = new MpvIpc(socketPath);
    this.state = {
      status: "idle",
      trackId: null,
      positionMs: 0,
      durationMs: null,
      volume: 20,
      muted: false,
      shuffle: false,
      repeat: "off",
      queue: [],
      queueIndex: -1,
      error: null,
      audioDevice: null,
    };
    this.loadSettings();
    this.mpv.on("event", (ev: MpvEvent) => this.onMpvEvent(ev));
    this.mpv.on("mpv-exit", () => {
      this.state.status = "stopped";
      this.state.error = "mpv exited";
      pushErrorLog("playback", "mpv exited unexpectedly");
    });
    this.mpv.on("mpv-exit-error", (err: Error) => {
      this.state.status = "error";
      this.state.error = err.message;
      pushErrorLog("playback", "mpv process error", err.message);
    });
    this.mpv.on("mpv-stderr", (raw: unknown) => {
      const line = String(raw ?? "").trim();
      if (!line) return;
      // Keep logs useful by recording error-ish mpv stderr lines only.
      if (/error|failed|alsa|ao\/|device/i.test(line)) {
        pushErrorLog("playback", "mpv stderr", line);
      }
    });
  }

  private loadSettings(): void {
    // Always start from a safe default volume, regardless of persisted user changes.
    this.state.volume = 20;
    const dev = this.db
      .prepare(`SELECT value FROM settings WHERE key = 'audio_device'`)
      .get() as { value: string } | undefined;
    if (dev?.value) this.state.audioDevice = dev.value;
    const sh = this.db
      .prepare(`SELECT value FROM settings WHERE key = 'shuffle'`)
      .get() as { value: string } | undefined;
    if (sh) this.state.shuffle = sh.value === "1";
    const rep = this.db
      .prepare(`SELECT value FROM settings WHERE key = 'repeat'`)
      .get() as { value: string } | undefined;
    if (rep && (rep.value === "off" || rep.value === "one" || rep.value === "all")) {
      this.state.repeat = rep.value;
    }
  }

  private persist(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value);
  }

  async ensureStarted(): Promise<void> {
    if (this.started && this.mpv.running) return;
    this.state.error = null;
    const extra: string[] = [];
    const configuredAo = process.env.MPV_AO?.trim();
    if (configuredAo) extra.push(`--ao=${configuredAo}`);
    const configuredDevice = process.env.MPV_AUDIO_DEVICE?.trim();
    const selectedDevice =
      this.state.audioDevice && this.state.audioDevice !== "auto"
        ? this.state.audioDevice
        : configuredDevice && configuredDevice !== "auto"
          ? configuredDevice
          : null;
    if (selectedDevice) {
      extra.push(`--audio-device=${selectedDevice}`);
    }
    try {
      await this.mpv.start(extra);
      await this.mpv.setProp("volume", this.state.volume);
      await this.mpv.setProp("mute", this.state.muted);
      this.started = true;
      this.state.status = "idle";
      this.state.error = null;
      this.startPolling();
    } catch (e) {
      this.started = false;
      this.state.status = "error";
      const msg = (e as Error).message;
      this.state.error = msg;
      pushErrorLog("playback", "failed to start playback engine", msg);
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.refreshFromMpv();
    }, 900);
  }

  private async refreshFromMpv(): Promise<void> {
    if (!this.mpv.running) return;
    try {
      const pause = await this.mpv.getProp("pause");
      const t = await this.mpv.getProp("time-pos");
      const d = await this.mpv.getProp("duration");
      const vol = await this.mpv.getProp("volume");
      const mute = await this.mpv.getProp("mute");
      if (typeof vol === "number") this.state.volume = vol;
      if (typeof mute === "boolean") this.state.muted = mute;
      if (typeof t === "number") this.state.positionMs = Math.round(t * 1000);
      if (typeof d === "number") this.state.durationMs = Math.round(d * 1000);
      if (pause === true) this.state.status = "paused";
      else this.state.status = "playing";
    } catch {
      /* ignore transient mpv errors */
    }
  }

  private scheduleNaturalTrackEnd(): void {
    if (this.trackEndInFlight) return;
    this.trackEndInFlight = true;
    void (async () => {
      try {
        await this.onTrackEnded();
      } catch (e) {
        pushErrorLog("playback", "track-end handler failed", (e as Error).message);
      } finally {
        this.trackEndInFlight = false;
      }
    })();
  }

  private onMpvEvent(ev: MpvEvent): void {
    // Natural EOF is delivered as `end-file` over JSON IPC; `eof-reached` observe is a backup.
    if (ev.event === "end-file") {
      const reason = ev.reason;
      if (reason === "eof") {
        this.scheduleNaturalTrackEnd();
      }
      return;
    }

    if (ev.event === "property-change" && ev.name === "time-pos") {
      const v = ev.data;
      if (typeof v === "number") this.state.positionMs = Math.round(v * 1000);
    }
    if (ev.event === "property-change" && ev.name === "duration") {
      const v = ev.data;
      if (typeof v === "number") this.state.durationMs = Math.round(v * 1000);
    }
    if (ev.event === "property-change" && ev.name === "pause") {
      const v = ev.data;
      if (v === true) this.state.status = "paused";
      else if (v === false && this.state.trackId) this.state.status = "playing";
    }
    if (ev.event === "property-change" && ev.name === "eof-reached") {
      if (ev.data === true) {
        this.scheduleNaturalTrackEnd();
      }
    }
  }

  private async onTrackEnded(): Promise<void> {
    if (this.state.repeat === "one" && this.state.trackId) {
      await this.seek(0);
      await this.mpv.setProp("pause", false);
      return;
    }
    if (this.state.queue.length === 0) {
      this.state.trackId = null;
      this.state.status = "idle";
      return;
    }
    const next = this.nextIndex();
    if (next < 0) {
      this.state.trackId = null;
      this.state.status = "stopped";
      this.state.queueIndex = -1;
      return;
    }
    this.state.queueIndex = next;
    const tid = this.state.queue[this.state.queueIndex]!;
    await this.loadTrackById(tid, true);
  }

  private nextIndex(): number {
    const q = this.state.queue;
    if (q.length === 0) return -1;
    const cur = this.state.queueIndex;
    if (this.state.shuffle) {
      if (q.length === 1) return 0;
      if (cur < 0) return Math.floor(Math.random() * q.length);
      let n = cur;
      let guard = 0;
      while (n === cur && guard++ < 32) n = Math.floor(Math.random() * q.length);
      return n;
    }
    if (cur < q.length - 1) return cur + 1;
    if (this.state.repeat === "all") return 0;
    return -1;
  }

  private prevIndex(): number {
    const q = this.state.queue;
    if (q.length === 0) return -1;
    const cur = this.state.queueIndex;
    if (this.state.shuffle) {
      return Math.max(0, Math.min(q.length - 1, cur <= 0 ? 0 : cur - 1));
    }
    if (cur > 0) return cur - 1;
    if (this.state.repeat === "all") return q.length - 1;
    return -1;
  }

  getState(): PlayerState {
    return { ...this.state, queue: [...this.state.queue] };
  }

  setQueue(trackIds: string[], startIndex = 0): void {
    this.cdTracksById.clear();
    this.cdChapterCount = 0;
    this.state.queue = [...trackIds];
    this.state.queueIndex = Math.max(
      0,
      Math.min(trackIds.length - 1, startIndex)
    );
  }

  setAudioCdQueue(
    tracks: Array<{ trackNumber: number; title: string; durationMs: number | null }>,
    startIndex = 0
  ): void {
    this.cdTracksById.clear();
    this.cdChapterCount = tracks.length;
    const ids = tracks.map((t) => {
      const id = `cd:${t.trackNumber}`;
      this.cdTracksById.set(id, {
        id,
        path: cddaMpvBaseUrl(),
        title: t.title,
        discNumber: 1,
        trackNumber: t.trackNumber,
        durationMs: t.durationMs,
        albumId: null,
        albumTitle: "Audio CD",
        artistId: null,
        artistName: null,
        sourceId: null,
        codec: "cdda",
        bitrate: null,
        sampleRate: 44_100,
      });
      return id;
    });
    this.state.queue = ids;
    this.state.queueIndex = Math.max(0, Math.min(ids.length - 1, startIndex));
  }

  getVirtualTrack(id: string): (Track & { path: string }) | null {
    return this.cdTracksById.get(id) ?? null;
  }

  async playQueueFrom(startIndex: number): Promise<void> {
    await this.ensureStarted();
    if (this.state.status === "error") return;
    if (this.state.queue.length === 0) return;
    this.state.queueIndex = Math.max(
      0,
      Math.min(this.state.queue.length - 1, startIndex)
    );
    const tid = this.state.queue[this.state.queueIndex]!;
    const ok = await this.loadTrackById(tid, true);
    if (ok) return;
    // If selected item can't be loaded (e.g., stale queue entry), try later items.
    let idx = this.state.queueIndex + 1;
    while (idx < this.state.queue.length) {
      this.state.queueIndex = idx;
      const nextId = this.state.queue[idx]!;
      if (await this.loadTrackById(nextId, true)) return;
      idx += 1;
    }
  }

  async playTrackNow(trackId: string): Promise<void> {
    const idx = this.state.queue.indexOf(trackId);
    if (idx >= 0) {
      this.state.queueIndex = idx;
    } else {
      this.state.queue = [trackId];
      this.state.queueIndex = 0;
    }
    await this.ensureStarted();
    if (this.state.status === "error") return;
    await this.loadTrackById(trackId, true);
  }

  async appendQueue(trackIds: string[]): Promise<void> {
    this.state.queue.push(...trackIds);
  }

  private async loadTrackById(trackId: string, autoplay: boolean): Promise<boolean> {
    await this.ensureStarted();
    if (this.state.status === "error") return false;
    const virtual = this.cdTracksById.get(trackId);
    const row = virtual
      ? { path: virtual.path }
      : (this.db.prepare(`SELECT path FROM tracks WHERE id = ?`).get(trackId) as
          | { path: string }
          | undefined);
    if (!row?.path) {
      this.state.error = "Track not found";
      pushErrorLog("playback", "track not found", trackId);
      return false;
    }
    this.state.trackId = trackId;
    this.state.status = "loading";
    // Reset stale timeline immediately so UI doesn't stay at previous track end during transitions.
    this.state.positionMs = 0;
    this.state.durationMs = null;
    try {
      if (virtual) {
        const url = cddaMpvBaseUrl();
        const n = virtual.trackNumber ?? 1;
        // Load a single disc chapter (track) with an upper bound. Otherwise mpv's time-pos is often
        // disc-global (large) while the UI uses per-track TOC duration — the progress bar breaks and
        // can look like it moves right-to-left. end=#(N+1) stops at the next chapter (mpv manual).
        const withBounds =
          this.cdChapterCount > 0 && n < this.cdChapterCount
            ? `start=#${n},end=#${n + 1}`
            : `start=#${n}`;
        try {
          await this.mpv.command("loadfile", url, "replace", -1, withBounds);
        } catch {
          try {
            await this.mpv.command("loadfile", url, "replace", -1, `start=#${n}`);
          } catch {
            await this.mpv.command("loadfile", url, "replace", `start=#${n}`);
          }
        }
      } else {
        await this.mpv.command("loadfile", row.path, "replace");
      }
      if (!autoplay) await this.mpv.setProp("pause", true);
      else await this.mpv.setProp("pause", false);
      this.state.status = autoplay ? "playing" : "paused";
      this.state.error = null;
      return true;
    } catch (e) {
      this.state.status = "error";
      const msg = (e as Error).message;
      this.state.error = msg;
      pushErrorLog("playback", "failed to load track", msg);
      return false;
    }
  }

  async pause(): Promise<void> {
    await this.ensureStarted();
    await this.mpv.setProp("pause", true);
    this.state.status = "paused";
  }

  async resume(): Promise<void> {
    await this.ensureStarted();
    await this.mpv.setProp("pause", false);
    this.state.status = "playing";
  }

  async togglePause(): Promise<void> {
    const p = await this.mpv.getProp("pause");
    await this.mpv.setProp("pause", !(p === true));
    this.state.status = p === true ? "playing" : "paused";
  }

  async stop(): Promise<void> {
    if (!this.mpv.running) return;
    await this.mpv.command("stop");
    this.state.trackId = null;
    this.state.status = "stopped";
    this.state.positionMs = 0;
    this.state.durationMs = null;
  }

  async seek(ms: number): Promise<void> {
    await this.ensureStarted();
    await this.mpv.command("seek", ms / 1000, "absolute");
    this.state.positionMs = ms;
  }

  async skipNext(): Promise<void> {
    const n = this.nextIndex();
    if (n < 0) {
      await this.stop();
      return;
    }
    this.state.queueIndex = n;
    const tid = this.state.queue[n]!;
    const ok = await this.loadTrackById(tid, true);
    if (ok) return;
    let idx = n + 1;
    while (idx < this.state.queue.length) {
      this.state.queueIndex = idx;
      const nextId = this.state.queue[idx]!;
      if (await this.loadTrackById(nextId, true)) return;
      idx += 1;
    }
  }

  async skipPrevious(): Promise<void> {
    const pos = this.state.positionMs;
    if (pos > 3500) {
      await this.seek(0);
      return;
    }
    const p = this.prevIndex();
    if (p < 0) {
      await this.seek(0);
      return;
    }
    this.state.queueIndex = p;
    const tid = this.state.queue[p]!;
    const ok = await this.loadTrackById(tid, true);
    if (ok) return;
    let idx = p - 1;
    while (idx >= 0) {
      this.state.queueIndex = idx;
      const prevId = this.state.queue[idx]!;
      if (await this.loadTrackById(prevId, true)) return;
      idx -= 1;
    }
  }

  async setVolume(v: number): Promise<void> {
    this.state.volume = Math.min(130, Math.max(0, v));
    this.persist("volume", String(this.state.volume));
    await this.ensureStarted();
    if (this.mpv.running) await this.mpv.setProp("volume", this.state.volume);
  }

  async setMuted(m: boolean): Promise<void> {
    this.state.muted = m;
    await this.ensureStarted();
    if (this.mpv.running) await this.mpv.setProp("mute", m);
  }

  setShuffle(on: boolean): void {
    this.state.shuffle = on;
    this.persist("shuffle", on ? "1" : "0");
  }

  setRepeat(mode: "off" | "one" | "all"): void {
    this.state.repeat = mode;
    this.persist("repeat", mode);
  }

  async setAudioDevice(device: string | null): Promise<void> {
    const prevTrackId = this.state.trackId;
    const wasPlaying = this.state.status === "playing";
    const resumePlayback = this.state.status === "playing" || this.state.status === "paused";

    this.state.audioDevice = device;
    this.persist("audio_device", device ?? "");

    await this.ensureStarted();
    if (this.state.error) return;

    const target =
      device && device !== "auto" ? device : "auto";

    try {
      await this.mpv.setProp("audio-device", target);
    } catch (e) {
      pushErrorLog(
        "playback",
        "set audio-device failed; restarting mpv",
        (e as Error).message
      );
      this.started = false;
      await this.mpv.stop();
      await this.ensureStarted();
      if (this.state.error) return;
      // New process already started with --audio-device from ensureStarted + persisted state.
    }

    if (prevTrackId && resumePlayback) {
      await this.loadTrackById(prevTrackId, wasPlaying);
    }
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.mpv.stop();
    this.started = false;
  }
}
