import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname as pathExtname, join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { parseFile } from "music-metadata";
import { nanoid } from "nanoid";
import {
  guessArtworkExtension,
  parseFilenameFallback,
  splitArtists,
  stableArtKey,
} from "./indexer.js";

/** Playlist folder imports only index FLAC (per product spec). */
const FLAC_EXT = new Set([".flac"]);

export interface PlaylistImportResult {
  playlistId: string;
  playlistName: string;
  albumId: string;
  trackCount: number;
  added: number;
  updated: number;
  errors: string[];
}

function sortKey(name: string): string {
  return name.trim().toLowerCase();
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function collectFlacFiles(dir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    throw new Error(`Cannot read directory: ${(e as Error).message}`);
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      await collectFlacFiles(full, out);
      continue;
    }
    if (st.isFile() && FLAC_EXT.has(pathExtname(full).toLowerCase())) {
      out.push(full);
    }
  }
}

export async function importPlaylistFromDirectory(
  db: Database.Database,
  inputPath: string,
  options?: { artworkDir?: string }
): Promise<PlaylistImportResult> {
  const rootPath = resolve(inputPath.trim());
  let rootStat: Awaited<ReturnType<typeof stat>>;
  try {
    rootStat = await stat(rootPath);
  } catch (e) {
    throw new Error(`Path not found: ${(e as Error).message}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error("Path must be a directory");
  }

  const files: string[] = [];
  await collectFlacFiles(rootPath, files);
  files.sort(naturalCompare);
  if (files.length === 0) {
    throw new Error("No FLAC files found in this folder");
  }

  const playlistName = basename(rootPath);
  const artworkDir =
    options?.artworkDir ?? join(process.cwd(), "server", "data", "artwork");
  await mkdir(artworkDir, { recursive: true });

  const result: PlaylistImportResult = {
    playlistId: "",
    playlistName,
    albumId: "",
    trackCount: 0,
    added: 0,
    updated: 0,
    errors: [],
  };

  let sourceId: string;
  const existingSource = db
    .prepare(`SELECT id FROM sources WHERE path = ?`)
    .get(rootPath) as { id: string } | undefined;
  if (existingSource) {
    sourceId = existingSource.id;
    db.prepare(`UPDATE sources SET label = ?, kind = 'playlist', enabled = 0 WHERE id = ?`).run(
      playlistName,
      sourceId
    );
  } else {
    sourceId = nanoid();
    try {
      db.prepare(
        `INSERT INTO sources (id, path, label, kind, enabled, created_at) VALUES (?,?,?,?,0,?)`
      ).run(sourceId, rootPath, playlistName, "playlist", Date.now());
    } catch {
      throw new Error("This folder path is already registered as a music source");
    }
  }

  const seenPaths = new Set<string>();

  function firstText(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      const found = value.find((v) => typeof v === "string" && v.trim().length > 0);
      return found?.trim();
    }
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    return undefined;
  }

  function getOrCreateArtist(name: string): string | null {
    const n = name.trim();
    if (!n) return null;
    const existing = db
      .prepare(`SELECT id FROM artists WHERE name = ? COLLATE NOCASE`)
      .get(n) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = nanoid();
    db.prepare(`INSERT INTO artists (id, name, sort_key) VALUES (?, ?, ?)`).run(
      id,
      n,
      sortKey(n)
    );
    return id;
  }

  function getOrCreateAlbum(
    title: string,
    artistId: string | null,
    year: number | null,
    artworkPath: string | null
  ): string {
    const t = title.trim() || playlistName;
    const rows = db
      .prepare(
        `SELECT id, year, artwork_path as artworkPath FROM albums WHERE title = ? COLLATE NOCASE ORDER BY id`
      )
      .all(t) as { id: string; year: number | null; artworkPath: string | null }[];
    if (rows.length > 0) {
      const keepId = rows[0]!.id;
      if (!rows.some((r) => r.year != null) && year != null) {
        db.prepare(`UPDATE albums SET year = ? WHERE id = ?`).run(year, keepId);
      }
      if (artworkPath && !rows.some((r) => r.artworkPath != null)) {
        db.prepare(`UPDATE albums SET artwork_path = ? WHERE id = ?`).run(artworkPath, keepId);
      }
      db.prepare(`UPDATE albums SET source_id = ? WHERE id = ?`).run(sourceId, keepId);
      return keepId;
    }
    const id = nanoid();
    db.prepare(
      `INSERT INTO albums (id, title, artist_id, year, artwork_path, source_id) VALUES (?,?,?,?,?,?)`
    ).run(id, t, artistId, year, artworkPath, sourceId);
    return id;
  }

  const upsertTrack = db.prepare(`
    INSERT INTO tracks (
      id, path, title, disc_number, track_number, duration_ms,
      album_id, artist_id, source_id, codec, bitrate, sample_rate, mtime_ms
    ) VALUES (@id, @path, @title, @disc_number, @track_number, @duration_ms,
      @album_id, @artist_id, @source_id, @codec, @bitrate, @sample_rate, @mtime_ms)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      disc_number = excluded.disc_number,
      track_number = excluded.track_number,
      duration_ms = excluded.duration_ms,
      album_id = excluded.album_id,
      artist_id = excluded.artist_id,
      codec = excluded.codec,
      bitrate = excluded.bitrate,
      sample_rate = excluded.sample_rate,
      mtime_ms = excluded.mtime_ms
  `);
  const clearTrackArtists = db.prepare(`DELETE FROM track_artists WHERE track_id = ?`);
  const insertTrackArtist = db.prepare(
    `INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?,?,?)`
  );

  let albumId: string | null = null;
  let albumArtwork: string | null = null;
  const trackIds: string[] = [];

  for (const full of files) {
    seenPaths.add(full);
    let title: string;
    let albumTitle = playlistName;
    let artistName: string | undefined;
    let albumArtistName: string | null = null;
    let artistNames: string[] = [];
    let trackNo: number | null = null;
    let discNo: number | null = null;
    let durationMs: number | null = null;
    let codec: string | null = "flac";
    let bitrate: number | null = null;
    let sampleRate: number | null = null;
    let year: number | null = null;
    let extractedArtworkPath: string | null = null;
    const fbName = parseFilenameFallback(full);

    try {
      const meta = await parseFile(full, { duration: true, skipCovers: false });
      const common = meta.common;
      const format = meta.format;
      title = firstText(common.title) || fbName.title || basename(full, ".flac");
      albumTitle = firstText(common.album) || playlistName;
      albumArtistName =
        firstText(common.albumartist) ||
        firstText(common.artist) ||
        firstText(common.artists) ||
        null;
      artistName =
        firstText(common.artist) || firstText(common.artists) || fbName.artist;
      artistNames = splitArtists(common.artists, common.artist, fbName.artist);
      if (common.track?.no != null) trackNo = common.track.no;
      else if (fbName.trackNumber != null) trackNo = fbName.trackNumber;
      if (common.disk?.no != null) discNo = common.disk.no;
      if (common.year != null && Number.isFinite(common.year)) {
        year = Math.trunc(common.year);
      }
      if (format.duration != null) durationMs = Math.round(format.duration * 1000);
      codec = format.codec ?? format.container ?? "flac";
      bitrate = format.bitrate != null ? Math.round(format.bitrate) : null;
      sampleRate = format.sampleRate != null ? Math.round(format.sampleRate) : null;
      const cover = meta.common.picture?.[0];
      if (cover?.data && cover.data.length > 0) {
        const extForPic = guessArtworkExtension(cover.format);
        const artworkFile = join(
          artworkDir,
          `${sourceId}-${stableArtKey(albumTitle)}.${extForPic}`
        );
        await writeFile(artworkFile, cover.data);
        extractedArtworkPath = artworkFile;
        if (!albumArtwork) albumArtwork = artworkFile;
      }
    } catch (e) {
      title = fbName.title || basename(full, ".flac");
      artistName = fbName.artist;
      artistNames = splitArtists(fbName.artist);
      if (fbName.trackNumber != null) trackNo = fbName.trackNumber;
      result.errors.push(`${full}: metadata: ${(e as Error).message}`);
    }

    if (artistNames.length === 0 && artistName) artistNames = splitArtists(artistName);
    if (artistNames.length === 0 && albumArtistName) artistNames = splitArtists(albumArtistName);

    if (!albumId) {
      const albumArtistId = albumArtistName
        ? getOrCreateArtist(albumArtistName)
        : artistNames[0]
          ? getOrCreateArtist(artistNames[0])
          : null;
      albumId = getOrCreateAlbum(albumTitle, albumArtistId, year, albumArtwork);
      result.albumId = albumId;
    }

    const artistId = artistNames[0] ? getOrCreateArtist(artistNames[0]) : null;
    const existing = db
      .prepare(`SELECT id, mtime_ms FROM tracks WHERE path = ?`)
      .get(full) as { id: string; mtime_ms: number } | undefined;
    const id = existing?.id ?? nanoid();
    const mtimeMs = Math.floor((await stat(full)).mtimeMs);
    const isNew = !existing;
    const changed = existing && existing.mtime_ms !== mtimeMs;

    upsertTrack.run({
      id,
      path: full,
      title,
      disc_number: discNo,
      track_number: trackNo,
      duration_ms: durationMs,
      album_id: albumId,
      artist_id: artistId,
      source_id: sourceId,
      codec,
      bitrate,
      sample_rate: sampleRate,
      mtime_ms: mtimeMs,
    });
    if (isNew) result.added++;
    else if (changed) result.updated++;

    const resolvedArtistIds = artistNames
      .map((n) => getOrCreateArtist(n))
      .filter((v): v is string => Boolean(v));
    clearTrackArtists.run(id);
    resolvedArtistIds.forEach((aid, i) => insertTrackArtist.run(id, aid, i));

    trackIds.push(id);
  }

  if (!albumId) {
    throw new Error("Failed to create album for playlist import");
  }

  if (albumArtwork) {
    db.prepare(`UPDATE albums SET artwork_path = COALESCE(artwork_path, ?) WHERE id = ?`).run(
      albumArtwork,
      albumId
    );
  }

  const stale = db
    .prepare(`SELECT path FROM tracks WHERE source_id = ?`)
    .all(sourceId) as { path: string }[];
  for (const r of stale) {
    if (!seenPaths.has(r.path)) {
      db.prepare(`DELETE FROM tracks WHERE path = ?`).run(r.path);
    }
  }

  db.prepare(`UPDATE sources SET last_scan_at = ? WHERE id = ?`).run(Date.now(), sourceId);

  const existingPlaylist = db
    .prepare(`SELECT id FROM playlists WHERE name = ? COLLATE NOCASE`)
    .get(playlistName) as { id: string } | undefined;

  let playlistId: string;
  if (existingPlaylist) {
    playlistId = existingPlaylist.id;
  } else {
    playlistId = nanoid();
    const max = db.prepare(`SELECT COALESCE(MAX(position),0) as m FROM playlists`).get() as {
      m: number;
    };
    db.prepare(`INSERT INTO playlists (id, name, position, created_at) VALUES (?,?,?,?)`).run(
      playlistId,
      playlistName,
      max.m + 1,
      Date.now()
    );
  }

  db.prepare(`DELETE FROM playlist_tracks WHERE playlist_id = ?`).run(playlistId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)`
  );
  const tx = db.transaction(() => {
    trackIds.forEach((trackId, i) => {
      ins.run(playlistId, trackId, i);
    });
  });
  tx();

  result.playlistId = playlistId;
  result.trackCount = trackIds.length;
  return result;
}
