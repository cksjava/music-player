import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import type { PlayerState, Track } from "../types.js";
import { MpvIpc, type MpvEvent } from "./mpv.js";
import { pushErrorLog } from "./error-log.js";

function defaultSocketPath(): string {
  return join(tmpdir(), "music-player-mpv.sock");
}

function audioCdPath(trackNumber: number): string {
  const device = process.env.CDROM_DEVICE?.trim();
  if (!device) return `cdda://${trackNumber}`;
  // mpv cdda URL format supports appending device path as /device.
  return `cdda://${trackNumber}/${device}`;
}

export class PlayerService {
  private mpv: MpvIpc;
  private state: PlayerState;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private cdTracksById = new Map<string, Track & { path: string }>();

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
      volume: 80,
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
    const vol = this.db
      .prepare(`SELECT value FROM settings WHERE key = 'volume'`)
      .get() as { value: string } | undefined;
    if (vol) this.state.volume = Math.min(130, Math.max(0, Number(vol.value) || 80));
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

  private onMpvEvent(ev: MpvEvent): void {
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
        void this.onTrackEnded();
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
    await this.loadTrackById(tid, false);
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
    const ids = tracks.map((t) => {
      const id = `cd:${t.trackNumber}`;
      this.cdTracksById.set(id, {
        id,
        path: audioCdPath(t.trackNumber),
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
    await this.loadTrackById(tid, true);
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

  private async loadTrackById(trackId: string, autoplay: boolean): Promise<void> {
    const virtual = this.cdTracksById.get(trackId);
    const row = virtual
      ? { path: virtual.path }
      : (this.db.prepare(`SELECT path FROM tracks WHERE id = ?`).get(trackId) as
          | { path: string }
          | undefined);
    if (!row?.path) {
      this.state.error = "Track not found";
      pushErrorLog("playback", "track not found", trackId);
      return;
    }
    this.state.trackId = trackId;
    this.state.status = "loading";
    try {
      await this.mpv.command("loadfile", row.path, "replace");
      if (!autoplay) await this.mpv.setProp("pause", true);
      else await this.mpv.setProp("pause", false);
      this.state.status = autoplay ? "playing" : "paused";
      this.state.error = null;
    } catch (e) {
      this.state.status = "error";
      const msg = (e as Error).message;
      this.state.error = msg;
      pushErrorLog("playback", "failed to load track", msg);
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
    await this.loadTrackById(tid, true);
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
    await this.loadTrackById(tid, true);
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
    this.state.audioDevice = device;
    this.persist("audio_device", device ?? "");
    this.started = false;
    await this.mpv.stop();
    await this.ensureStarted();
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
