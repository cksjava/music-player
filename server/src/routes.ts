import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { nanoid } from "nanoid";
import { scanSource } from "./services/indexer.js";
import { listMpvAudioDevices } from "./services/devices.js";
import { ejectAudioCd, readAudioCdInfo } from "./services/cd.js";
import { clearErrorLogs, getErrorLogs, pushErrorLog } from "./services/error-log.js";
import type { PlayerService } from "./services/player.js";
import type { Album, Artist, Playlist, Source, Track } from "./types.js";

export function registerRoutes(
  app: Express,
  db: Database.Database,
  player: PlayerService
): void {
  const execFileAsync = promisify(execFile);
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "server", "data");
  const artworkDir = join(dataDir, "artwork");
  type ScanJobStatus = "queued" | "running" | "done" | "error";
  type ScanJob = {
    id: string;
    sourceId: string;
    sourcePath: string;
    status: ScanJobStatus;
    createdAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    result: { added: number; updated: number; removed: number; errors: string[] } | null;
    error: string | null;
  };
  const scanJobs = new Map<string, ScanJob>();
  const runningBySource = new Map<string, string>();
  const cdDevice = process.env.CDROM_DEVICE || "/dev/sr0";

  const resolveTrack = (id: string): (Track & { path: string }) | null => {
    const row = db
      .prepare(
        `SELECT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        WHERE t.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: row.id as string,
        path: row.path as string,
        title: row.title as string,
        discNumber: (row.discNumber as number) ?? null,
        trackNumber: (row.trackNumber as number) ?? null,
        durationMs: (row.durationMs as number) ?? null,
        albumId: (row.albumId as string) ?? null,
        albumTitle: (row.albumTitle as string) ?? null,
        artistId: (row.artistId as string) ?? null,
        artistName: (row.artistName as string) ?? null,
        sourceId: (row.sourceId as string) ?? null,
        codec: (row.codec as string) ?? null,
        bitrate: (row.bitrate as number) ?? null,
        sampleRate: (row.sampleRate as number) ?? null,
      };
    }
    return player.getVirtualTrack(id);
  };

  const runScanJob = async (jobId: string): Promise<void> => {
    const job = scanJobs.get(jobId);
    if (!job) return;
    if (job.status !== "queued") return;
    job.status = "running";
    job.startedAt = Date.now();
    try {
      const result = await scanSource(db, job.sourceId, job.sourcePath, { artworkDir });
      job.result = result;
      job.status = "done";
      job.finishedAt = Date.now();
    } catch (e) {
      job.status = "error";
      job.error = (e as Error).message;
      job.finishedAt = Date.now();
    } finally {
      runningBySource.delete(job.sourceId);
    }
  };
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  app.get("/api/fs/directories", async (req, res) => {
    const raw = String(req.query.path ?? "").trim();
    const current = normalize(resolve(raw || process.env.HOME || "/"));
    try {
      const entries = await readdir(current, { withFileTypes: true });
      const directories = entries
        .filter((e) => e.isDirectory())
        .map((e) => ({
          name: e.name,
          path: join(current, e.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = dirname(current);
      res.json({
        current,
        parent: parent === current ? null : parent,
        directories,
      });
    } catch (e) {
      const msg = (e as Error).message;
      pushErrorLog("fs", "failed to list directories", `${current}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/errors", (req, res) => {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit ?? 100)));
    res.json({ logs: getErrorLogs(limit) });
  });

  app.delete("/api/errors", (_req, res) => {
    clearErrorLogs();
    res.json({ ok: true });
  });

  app.get("/api/devices", async (_req, res) => {
    try {
      const devices = await listMpvAudioDevices();
      res.json({ devices });
    } catch (e) {
      const msg = (e as Error).message;
      pushErrorLog("audio", "failed to list output devices", msg);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/player/state", (_req, res) => {
    const state = player.getState();
    const current = state.trackId ? resolveTrack(state.trackId) : null;
    res.json({ state, current });
  });

  app.get("/api/cd", async (_req, res) => {
    try {
      const info = await readAudioCdInfo(cdDevice);
      res.json(info);
    } catch (e) {
      const msg = (e as Error).message;
      pushErrorLog("cd", "failed to query audio CD", msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/cd/play", async (req, res) => {
    const schema = z.object({ trackNumber: z.number().int().min(1).optional() });
    const body = schema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const info = await readAudioCdInfo(cdDevice);
    if (!info.present || info.tracks.length === 0) {
      pushErrorLog("cd", "play requested but no audio CD detected", cdDevice);
      return res.status(400).json({ error: "No audio CD detected" });
    }
    const desired = body.data.trackNumber ?? 1;
    const startIndex = Math.max(
      0,
      info.tracks.findIndex((t) => t.trackNumber === desired)
    );
    player.setAudioCdQueue(info.tracks, startIndex);
    await player.playQueueFrom(startIndex);
    res.json({ ok: true, state: player.getState(), cd: info });
  });

  app.post("/api/cd/stop", async (_req, res) => {
    await player.stop();
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/cd/eject", async (_req, res) => {
    try {
      await player.stop();
      await ejectAudioCd(cdDevice);
      res.json({ ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      pushErrorLog("cd", "failed to eject audio CD", msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/player/play", async (req, res) => {
    const schema = z.object({ trackId: z.string().optional() });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    try {
      if (body.data.trackId) await player.playTrackNow(body.data.trackId);
      else await player.resume();
      res.json({ ok: true, state: player.getState() });
    } catch (e) {
      const msg = (e as Error).message;
      pushErrorLog("playback", "play request failed", msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/player/pause", async (_req, res) => {
    await player.pause();
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/toggle", async (_req, res) => {
    await player.togglePause();
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/stop", async (_req, res) => {
    await player.stop();
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/seek", async (req, res) => {
    const schema = z.object({ ms: z.number().int().min(0) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    await player.seek(body.data.ms);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/next", async (_req, res) => {
    await player.skipNext();
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/prev", async (_req, res) => {
    await player.skipPrevious();
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/volume", async (req, res) => {
    const schema = z.object({ volume: z.number().min(0).max(130) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    await player.setVolume(body.data.volume);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/mute", async (req, res) => {
    const schema = z.object({ muted: z.boolean() });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    await player.setMuted(body.data.muted);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/shuffle", (req, res) => {
    const schema = z.object({ shuffle: z.boolean() });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    player.setShuffle(body.data.shuffle);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/repeat", (req, res) => {
    const schema = z.object({
      repeat: z.enum(["off", "one", "all"]),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    player.setRepeat(body.data.repeat);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/queue", async (req, res) => {
    const schema = z.object({
      trackIds: z.array(z.string()),
      startIndex: z.number().int().min(0).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const start = body.data.startIndex ?? 0;
    player.setQueue(body.data.trackIds, start);
    await player.playQueueFrom(start);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/queue/append", (req, res) => {
    const schema = z.object({ trackIds: z.array(z.string()) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    void player.appendQueue(body.data.trackIds);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/queue/play-index", async (req, res) => {
    const schema = z.object({ index: z.number().int().min(0) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    await player.playQueueFrom(body.data.index);
    res.json({ ok: true, state: player.getState() });
  });

  app.post("/api/player/device", async (req, res) => {
    const schema = z.object({ device: z.string().nullable() });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    await player.setAudioDevice(body.data.device);
    res.json({ ok: true, state: player.getState() });
  });

  app.get("/api/tracks", (req, res) => {
    const q = (req.query.q as string) || "";
    const albumId = (req.query.albumId as string) || "";
    const artistId = (req.query.artistId as string) || "";
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 60));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q) {
      clauses.push(
        `(t.title LIKE ? OR ar.name LIKE ? OR a.title LIKE ? OR EXISTS (
          SELECT 1 FROM track_artists ta
          JOIN artists arx ON arx.id = ta.artist_id
          WHERE ta.track_id = t.id AND arx.name LIKE ?
        ))`
      );
      const like = `%${q.replace(/%/g, "")}%`;
      params.push(like, like, like, like);
    }
    if (albumId) {
      clauses.push(`t.album_id = ?`);
      params.push(albumId);
    }
    if (artistId) {
      clauses.push(`t.artist_id = ?`);
      params.push(artistId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        ${where}
        ORDER BY ar.sort_key, a.title, t.disc_number, t.track_number, t.title
        LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as Track[];
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as c FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        ${where}`
      )
      .get(...params) as { c: number };
    res.json({ tracks: rows, total: countRow.c });
  });

  app.get("/api/tracks/by-ids", (req, res) => {
    const raw = String(req.query.ids ?? "");
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 300);
    if (ids.length === 0) {
      res.json({ tracks: [] as Track[] });
      return;
    }
    const ph = ids.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        WHERE t.id IN (${ph})`
      )
      .all(...ids) as (Track & { path: string })[];
    const map = new Map<string, Track>(rows.map((t) => [t.id, t]));
    for (const id of ids) {
      if (!map.has(id)) {
        const v = player.getVirtualTrack(id);
        if (v) map.set(id, v);
      }
    }
    const ordered = ids.map((id) => map.get(id)).filter((t): t is Track => Boolean(t));
    res.json({ tracks: ordered });
  });

  app.get("/api/tracks/:id", (req, res) => {
    const row = db
      .prepare(
        `SELECT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        WHERE t.id = ?`
      )
      .get(req.params.id) as Track | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(row);
  });

  app.get("/api/albums", (req, res) => {
    const q = (req.query.q as string) || "";
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 80));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const where = q
      ? `WHERE a.title LIKE ? OR ar.name LIKE ?`
      : "";
    const like = `%${q.replace(/%/g, "")}%`;
    const params = q ? [like, like, limit, offset] : [limit, offset];
    const rows = db
      .prepare(
        `SELECT a.id, a.title, a.artist_id as artistId, ar.name as artistName, a.year, a.artwork_path as artworkPath, a.source_id as sourceId,
          (SELECT COUNT(*) FROM tracks t WHERE t.album_id = a.id) as trackCount
        FROM albums a
        LEFT JOIN artists ar ON ar.id = a.artist_id
        ${where}
        ORDER BY a.title COLLATE NOCASE, ar.sort_key
        LIMIT ? OFFSET ?`
      )
      .all(...params) as (Album & { trackCount: number })[];
    const countRow = db
      .prepare(
        `SELECT COUNT(*) as c FROM albums a
        LEFT JOIN artists ar ON ar.id = a.artist_id
        ${where}`
      )
      .get(...(q ? [like, like] : [])) as { c: number };
    res.json({ albums: rows, total: countRow.c });
  });

  app.get("/api/albums/:id", (req, res) => {
    const album = db
      .prepare(
        `SELECT a.id, a.title, a.artist_id as artistId, ar.name as artistName, a.year, a.artwork_path as artworkPath, a.source_id as sourceId
        FROM albums a
        LEFT JOIN artists ar ON ar.id = a.artist_id
        WHERE a.id = ?`
      )
      .get(req.params.id) as Album | undefined;
    if (!album) return res.status(404).json({ error: "Not found" });
    const tracks = db
      .prepare(
        `SELECT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        WHERE t.album_id = ?
        ORDER BY t.disc_number, t.track_number, t.title`
      )
      .all(req.params.id) as Track[];
    res.json({ album, tracks });
  });

  app.get("/api/albums/:id/artwork", (req, res) => {
    const row = db
      .prepare(`SELECT artwork_path as artworkPath FROM albums WHERE id = ?`)
      .get(req.params.id) as { artworkPath: string | null } | undefined;
    if (!row?.artworkPath) return res.status(404).json({ error: "No artwork" });
    res.sendFile(row.artworkPath, (err) => {
      if (err) {
        res.status(404).json({ error: "No artwork" });
      }
    });
  });

  app.get("/api/artists", (req, res) => {
    const q = (req.query.q as string) || "";
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit), 10) || 80));
    const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
    const where = q ? `WHERE ar.name LIKE ?` : "";
    const like = `%${q.replace(/%/g, "")}%`;
    const rows = db
      .prepare(
        `SELECT ar.id, ar.name,
          (SELECT COUNT(DISTINCT t.id) FROM tracks t
            LEFT JOIN track_artists ta ON ta.track_id = t.id
            WHERE t.artist_id = ar.id OR ta.artist_id = ar.id) as trackCount,
          (SELECT COUNT(DISTINCT t.album_id) FROM tracks t
            LEFT JOIN track_artists ta ON ta.track_id = t.id
            WHERE (t.artist_id = ar.id OR ta.artist_id = ar.id) AND t.album_id IS NOT NULL) as albumCount
        FROM artists ar
        ${where}
        ORDER BY ar.sort_key
        LIMIT ? OFFSET ?`
      )
      .all(...(q ? [like, limit, offset] : [limit, offset])) as (Artist & {
      trackCount: number;
      albumCount: number;
    })[];
    const countRow = db
      .prepare(`SELECT COUNT(*) as c FROM artists ar ${where}`)
      .get(...(q ? [like] : [])) as { c: number };
    res.json({ artists: rows, total: countRow.c });
  });

  app.get("/api/artists/:id", (req, res) => {
    const artist = db
      .prepare(`SELECT id, name FROM artists WHERE id = ?`)
      .get(req.params.id) as Artist | undefined;
    if (!artist) return res.status(404).json({ error: "Not found" });
    const albums = db
      .prepare(
        `SELECT DISTINCT a.id, a.title, a.artist_id as artistId, ar.name as artistName, a.year, a.artwork_path as artworkPath, a.source_id as sourceId
        FROM albums a
        JOIN tracks t ON t.album_id = a.id
        LEFT JOIN artists ar ON ar.id = a.artist_id
        WHERE t.artist_id = ? OR EXISTS (
          SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id AND ta.artist_id = ?
        )
        ORDER BY a.title`
      )
      .all(req.params.id, req.params.id) as Album[];
    const tracks = db
      .prepare(
        `SELECT DISTINCT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate
        FROM tracks t
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        WHERE t.artist_id = ? OR EXISTS (
          SELECT 1 FROM track_artists ta WHERE ta.track_id = t.id AND ta.artist_id = ?
        )
        ORDER BY a.title, t.disc_number, t.track_number`
      )
      .all(req.params.id, req.params.id) as Track[];
    res.json({ artist, albums, tracks });
  });

  app.get("/api/sources", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, path, label, kind, enabled, created_at as createdAt, last_scan_at as lastScanAt FROM sources ORDER BY created_at DESC`
      )
      .all() as (Omit<Source, "enabled"> & { enabled: number })[];
    res.json({
      sources: rows.map((r) => ({
        ...r,
        enabled: Boolean(r.enabled),
      })),
    });
  });

  app.post("/api/sources", (req, res) => {
    const schema = z.object({
      path: z.string().min(1),
      label: z.string().optional(),
      kind: z.enum(["folder", "cd"]).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const id = nanoid();
    const label = body.data.label?.trim() || body.data.path;
    const kind = body.data.kind ?? "folder";
    const now = Date.now();
    try {
      db.prepare(
        `INSERT INTO sources (id, path, label, kind, enabled, created_at) VALUES (?,?,?,?,1,?)`
      ).run(id, body.data.path, label, kind, now);
    } catch {
      return res.status(409).json({ error: "Path already registered" });
    }
    const row = db
      .prepare(
        `SELECT id, path, label, kind, enabled, created_at as createdAt, last_scan_at as lastScanAt FROM sources WHERE id = ?`
      )
      .get(id) as Omit<Source, "enabled"> & { enabled: number };
    res.status(201).json({ ...row, enabled: Boolean(row.enabled) });
  });

  app.patch("/api/sources/:id", (req, res) => {
    const schema = z.object({
      label: z.string().optional(),
      enabled: z.boolean().optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const cur = db.prepare(`SELECT id FROM sources WHERE id = ?`).get(req.params.id);
    if (!cur) return res.status(404).json({ error: "Not found" });
    if (body.data.label != null) {
      db.prepare(`UPDATE sources SET label = ? WHERE id = ?`).run(
        body.data.label,
        req.params.id
      );
    }
    if (body.data.enabled != null) {
      db.prepare(`UPDATE sources SET enabled = ? WHERE id = ?`).run(
        body.data.enabled ? 1 : 0,
        req.params.id
      );
    }
    const row = db
      .prepare(
        `SELECT id, path, label, kind, enabled, created_at as createdAt, last_scan_at as lastScanAt FROM sources WHERE id = ?`
      )
      .get(req.params.id) as (Omit<Source, "enabled"> & { enabled: number }) | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ...row, enabled: Boolean(row.enabled) });
  });

  app.delete("/api/sources/:id", (req, res) => {
    const r = db.prepare(`DELETE FROM sources WHERE id = ?`).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  app.post("/api/sources/:id/scan", async (req, res) => {
    const row = db
      .prepare(`SELECT id, path, kind, enabled FROM sources WHERE id = ?`)
      .get(req.params.id) as
      | { id: string; path: string; kind: string; enabled: number }
      | undefined;
    if (!row) return res.status(404).json({ error: "Not found" });
    if (!row.enabled) return res.status(400).json({ error: "Source disabled" });
    if (row.kind !== "folder") {
      return res
        .status(400)
        .json({ error: "Scanning is only implemented for folder sources" });
    }
    const runningJobId = runningBySource.get(row.id);
    if (runningJobId) {
      const runningJob = scanJobs.get(runningJobId);
      if (runningJob) {
        return res.status(202).json({ job: runningJob, alreadyRunning: true });
      }
    }

    const job: ScanJob = {
      id: nanoid(),
      sourceId: row.id,
      sourcePath: row.path,
      status: "queued",
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };
    scanJobs.set(job.id, job);
    runningBySource.set(row.id, job.id);
    // Fire and forget to keep indexing asynchronous.
    setTimeout(() => {
      void runScanJob(job.id);
    }, 0);
    res.status(202).json({ job, alreadyRunning: false });
  });

  app.get("/api/scan-jobs/:jobId", (req, res) => {
    const job = scanJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ job });
  });

  app.get("/api/sources/:id/scan-jobs", (req, res) => {
    const jobs = [...scanJobs.values()]
      .filter((j) => j.sourceId === req.params.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
    res.json({ jobs });
  });

  app.post("/api/admin/library/reset", async (req, res) => {
    const schema = z.object({
      stopPlayback: z.boolean().optional().default(true),
    });
    const body = schema.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });

    if (body.data.stopPlayback) {
      await player.stop();
    }

    const artRows = db
      .prepare(`SELECT artwork_path as artworkPath FROM albums WHERE artwork_path IS NOT NULL`)
      .all() as { artworkPath: string }[];
    for (const row of artRows) {
      if (!row.artworkPath) continue;
      // Prevent accidental deletes outside the app data folder.
      if (dirname(row.artworkPath).startsWith(artworkDir)) {
        try {
          await unlink(row.artworkPath);
        } catch {
          /* ignore missing files */
        }
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM playlist_tracks`).run();
      db.prepare(`DELETE FROM playlists`).run();
      db.prepare(`DELETE FROM tracks`).run();
      db.prepare(`DELETE FROM albums`).run();
      db.prepare(`DELETE FROM artists`).run();
      db.prepare(`UPDATE sources SET last_scan_at = NULL`).run();
    });
    tx();

    res.json({
      ok: true,
      keepSources: true,
      playbackStopped: body.data.stopPlayback,
    });
  });

  app.post("/api/admin/system/shutdown", async (_req, res) => {
    res.status(202).json({ ok: true, message: "Shutdown requested" });
    // Execute after response is sent so the client receives acknowledgement.
    setTimeout(async () => {
      try {
        await execFileAsync("sudo", ["shutdown", "-h", "now"]);
      } catch (e) {
        const msg = (e as Error).message;
        pushErrorLog("system", "device shutdown failed", msg);
      }
    }, 250);
  });

  app.post("/api/admin/system/restart-app", async (_req, res) => {
    res.status(202).json({ ok: true, message: "App restart requested" });
    setTimeout(async () => {
      try {
        await execFileAsync("sudo", ["systemctl", "restart", "music-player.service"]);
      } catch (e) {
        const msg = (e as Error).message;
        pushErrorLog("system", "app restart failed", msg);
      }
    }, 250);
  });

  app.post("/api/admin/system/update-app", async (_req, res) => {
    res.status(202).json({ ok: true, message: "App update requested" });
    setTimeout(async () => {
      try {
        await execFileAsync("git", ["pull", "--ff-only"], { cwd: process.cwd() });
        await execFileAsync("sudo", ["systemctl", "restart", "music-player.service"]);
      } catch (e) {
        const msg = (e as Error).message;
        pushErrorLog("system", "app update failed", msg);
      }
    }, 250);
  });

  app.get("/api/playlists", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.position, p.created_at as createdAt,
          (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) as trackCount
        FROM playlists p ORDER BY p.position, p.created_at`
      )
      .all() as (Playlist & { trackCount: number })[];
    res.json({ playlists: rows });
  });

  app.post("/api/playlists", (req, res) => {
    const schema = z.object({ name: z.string().min(1) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const id = nanoid();
    const max = db.prepare(`SELECT COALESCE(MAX(position),0) as m FROM playlists`).get() as {
      m: number;
    };
    const pos = max.m + 1;
    db.prepare(
      `INSERT INTO playlists (id, name, position, created_at) VALUES (?,?,?,?)`
    ).run(id, body.data.name.trim(), pos, Date.now());
    const row = db
      .prepare(
        `SELECT p.id, p.name, p.position, p.created_at as createdAt,
          (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) as trackCount
        FROM playlists p WHERE p.id = ?`
      )
      .get(id) as Playlist & { trackCount: number };
    res.status(201).json(row);
  });

  app.patch("/api/playlists/:id", (req, res) => {
    const schema = z.object({ name: z.string().min(1) });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const r = db
      .prepare(`UPDATE playlists SET name = ? WHERE id = ?`)
      .run(body.data.name.trim(), req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "Not found" });
    const row = db
      .prepare(
        `SELECT p.id, p.name, p.position, p.created_at as createdAt,
          (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) as trackCount
        FROM playlists p WHERE p.id = ?`
      )
      .get(req.params.id) as Playlist & { trackCount: number };
    res.json(row);
  });

  app.delete("/api/playlists/:id", (req, res) => {
    const r = db.prepare(`DELETE FROM playlists WHERE id = ?`).run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  app.get("/api/playlists/:id/tracks", (req, res) => {
    const exists = db.prepare(`SELECT id FROM playlists WHERE id = ?`).get(req.params.id);
    if (!exists) return res.status(404).json({ error: "Not found" });
    const tracks = db
      .prepare(
        `SELECT t.id, t.path, t.title, t.disc_number as discNumber, t.track_number as trackNumber,
          t.duration_ms as durationMs, t.album_id as albumId, a.title as albumTitle,
          t.artist_id as artistId, ar.name as artistName, t.source_id as sourceId,
          t.codec, t.bitrate, t.sample_rate as sampleRate, pt.position as playlistPosition
        FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        LEFT JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = t.artist_id
        WHERE pt.playlist_id = ?
        ORDER BY pt.position`
      )
      .all(req.params.id) as (Track & { playlistPosition: number })[];
    res.json({ tracks });
  });

  app.post("/api/playlists/:id/tracks", (req, res) => {
    const schema = z.object({
      trackIds: z.array(z.string()),
      position: z.number().int().min(0).optional(),
    });
    const body = schema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: body.error.flatten() });
    const exists = db.prepare(`SELECT id FROM playlists WHERE id = ?`).get(req.params.id);
    if (!exists) return res.status(404).json({ error: "Not found" });
    const maxRow = db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) as m FROM playlist_tracks WHERE playlist_id = ?`
      )
      .get(req.params.id) as { m: number };
    let start = body.data.position ?? maxRow.m + 1;
    const ins = db.prepare(
      `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)`
    );
    const tx = db.transaction(() => {
      for (let i = 0; i < body.data.trackIds.length; i++) {
        ins.run(req.params.id, body.data.trackIds[i], start + i);
      }
    });
    tx();
    res.json({ ok: true });
  });

  app.delete("/api/playlists/:id/tracks/:trackId", (req, res) => {
    const r = db
      .prepare(
        `DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`
      )
      .run(req.params.id, req.params.trackId);
    if (r.changes === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: unknown) => {
    console.error(err);
    pushErrorLog("server", "unhandled route error", String(err));
    res.status(500).json({ error: "Internal error" });
  });
}
