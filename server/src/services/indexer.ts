import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname as pathExtname, join } from "node:path";
import type Database from "better-sqlite3";
import { parseFile } from "music-metadata";
import { nanoid } from "nanoid";

const AUDIO_EXT = new Set([
  // Lossy / streaming-friendly
  ".aac",
  ".ac3",
  ".amr",
  ".m4a",
  ".mp2",
  ".mp3",
  ".ogg",
  ".oga",
  ".opus",
  ".spx",
  ".wma",
  ".webm",
  ".3gp",
  ".3g2",
  // Lossless / high quality
  ".aiff",
  ".aif",
  ".alac",
  ".ape",
  ".flac",
  ".mka",
  ".tta",
  ".wav",
  ".wv",
  // Container aliases often holding audio tracks
  ".asf",
  ".m4b",
  ".m4p",
  ".mp4",
  ".ra",
]);

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  errors: string[];
}

function sortKey(name: string): string {
  return name.trim().toLowerCase();
}

export function splitArtists(...values: Array<string | string[] | undefined>): string[] {
  const raw: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) raw.push(...value);
    else raw.push(value);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parts = String(item)
      .split(/\s*(?:,|;|\/|&|\bfeat\.?\b|\bfeaturing\b|\bft\.?\b|\bx\b)\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      const key = sortKey(p);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function parseFilenameFallback(
  filename: string
): { title?: string; artist?: string; trackNumber?: number } {
  const base = basename(filename, extname(filename));
  const numMatch = base.match(/^(\d+)\s*[-–—]\s*(.+)$/);
  let rest = base;
  let trackNumber: number | undefined;
  if (numMatch) {
    trackNumber = parseInt(numMatch[1], 10);
    rest = numMatch[2].trim();
  }
  const parts = rest
    .split(/\s*[-–—]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return {
      title: parts[0],
      artist: parts.slice(1).join(" — "),
      trackNumber,
    };
  }
  return { title: rest || base, trackNumber };
}

function extname(p: string): string {
  return pathExtname(p).toLowerCase();
}

export async function scanSource(
  db: Database.Database,
  sourceId: string,
  rootPath: string,
  options?: { artworkDir?: string }
): Promise<ScanResult> {
  const result: ScanResult = { added: 0, updated: 0, removed: 0, errors: [] };
  const seenPaths = new Set<string>();
  const artworkDir =
    options?.artworkDir ?? join(process.cwd(), "server", "data", "artwork");
  await mkdir(artworkDir, { recursive: true });

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
    const sk = sortKey(n);
    const existing = db
      .prepare(`SELECT id FROM artists WHERE name = ? COLLATE NOCASE`)
      .get(n) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = nanoid();
    db.prepare(
      `INSERT INTO artists (id, name, sort_key) VALUES (?, ?, ?)`
    ).run(id, n, sk);
    return id;
  }

  function getOrCreateAlbum(
    title: string,
    artistId: string | null,
    year: number | null
  ): string {
    const t = title.trim() || "Unknown album";
    const rows = db
      .prepare(
        `SELECT id, year, artwork_path as artworkPath
         FROM albums
         WHERE title = ? COLLATE NOCASE
         ORDER BY id`
      )
      .all(t) as { id: string; year: number | null; artworkPath: string | null }[];
    if (rows.length > 0) {
      const keepId = rows[0]!.id;
      // Consolidate duplicate album rows by title so tracks from prior scans don't stay split.
      if (rows.length > 1) {
        const duplicateIds = rows.slice(1).map((r) => r.id);
        const placeholders = duplicateIds.map(() => "?").join(",");
        db.prepare(
          `UPDATE tracks SET album_id = ? WHERE album_id IN (${placeholders})`
        ).run(keepId, ...duplicateIds);
        db.prepare(`DELETE FROM albums WHERE id IN (${placeholders})`).run(...duplicateIds);
      }
      const hasYear = rows.some((r) => r.year != null);
      const hasArtwork = rows.some((r) => r.artworkPath != null);
      if (!hasYear && year != null) {
        db.prepare(`UPDATE albums SET year = ? WHERE id = ?`).run(year, keepId);
      }
      if (!hasArtwork) {
        // artwork_path gets filled later in the scan path if present.
      }
      return keepId;
    }
    const id = nanoid();
    db.prepare(
      `INSERT INTO albums (id, title, artist_id, year, artwork_path, source_id) VALUES (?,?,?,?,?,?)`
    ).run(id, t, artistId, year, null, sourceId);
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
  const findDuplicateTrack = db.prepare(`
    SELECT id FROM tracks
    WHERE album_id = @album_id
      AND title = @title COLLATE NOCASE
      AND IFNULL(disc_number,0) = IFNULL(@disc_number,0)
      AND IFNULL(track_number,0) = IFNULL(@track_number,0)
      AND IFNULL(duration_ms,0) = IFNULL(@duration_ms,0)
      AND path <> @path
    LIMIT 1
  `);

  async function walk(dir: string, folderAlbumHint: string | null): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (e) {
      result.errors.push(`${dir}: ${(e as Error).message}`);
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(full);
      } catch (e) {
        result.errors.push(`${full}: ${(e as Error).message}`);
        continue;
      }
      if (st.isDirectory()) {
        await walk(full, basename(full));
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(full);
      if (!AUDIO_EXT.has(ext)) continue;
      seenPaths.add(full);

      let title: string;
      let albumTitle: string;
      let artistName: string | undefined;
      let albumArtistName: string | undefined;
      let artistNames: string[] = [];
      let trackNo: number | null = null;
      let discNo: number | null = null;
      let durationMs: number | null = null;
      let codec: string | null = null;
      let bitrate: number | null = null;
      let sampleRate: number | null = null;
      let year: number | null = null;
      let extractedArtworkPath: string | null = null;
      const fbName = parseFilenameFallback(full);
      try {
        const meta = await parseFile(full, { duration: true, skipCovers: false });
        const common = meta.common;
        const format = meta.format;
        title = firstText(common.title) || fbName.title || basename(full, ext);
        albumTitle =
          firstText(common.album) ||
          folderAlbumHint ||
          dirnameHint(full, rootPath);
        albumArtistName =
          firstText(common.albumartist) ||
          firstText(common.artist) ||
          firstText(common.artists);
        artistName =
          firstText(common.artist) ||
          firstText(common.artists) ||
          fbName.artist;
        artistNames = splitArtists(common.artists, common.artist, fbName.artist);
        if (common.track?.no != null) trackNo = common.track.no;
        else if (fbName.trackNumber != null) trackNo = fbName.trackNumber;
        if (common.disk?.no != null) discNo = common.disk.no;
        if (common.year != null && Number.isFinite(common.year)) {
          year = Math.trunc(common.year);
        }
        if (format.duration != null) durationMs = Math.round(format.duration * 1000);
        codec = format.codec ?? format.container ?? null;
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
        }
      } catch (e) {
        title = fbName.title || basename(full, ext);
        artistName = fbName.artist;
        artistNames = splitArtists(fbName.artist);
        albumArtistName = undefined;
        albumTitle = folderAlbumHint || dirnameHint(full, rootPath);
        if (fbName.trackNumber != null) trackNo = fbName.trackNumber;
        result.errors.push(`${full}: metadata: ${(e as Error).message}`);
      }

      if (artistNames.length === 0 && artistName) artistNames = splitArtists(artistName);
      if (artistNames.length === 0 && albumArtistName) artistNames = splitArtists(albumArtistName);
      const artistId = artistNames[0] ? getOrCreateArtist(artistNames[0]) : null;
      const albumArtistId = albumArtistName
        ? getOrCreateArtist(albumArtistName)
        : artistId;
      const albumId = getOrCreateAlbum(albumTitle, albumArtistId, year);
      if (extractedArtworkPath) {
        db.prepare(
          `UPDATE albums SET artwork_path = COALESCE(artwork_path, ?) WHERE id = ?`
        ).run(extractedArtworkPath, albumId);
      }
      const existing = db
        .prepare(`SELECT id, mtime_ms FROM tracks WHERE path = ?`)
        .get(full) as { id: string; mtime_ms: number } | undefined;
      const id = existing?.id ?? nanoid();
      const mtimeMs = Math.floor(st.mtimeMs);
      const isNew = !existing;
      const changed = existing && existing.mtime_ms !== mtimeMs;

      const duplicate = findDuplicateTrack.get({
        album_id: albumId,
        title,
        disc_number: discNo,
        track_number: trackNo,
        duration_ms: durationMs,
        path: full,
      }) as { id: string } | undefined;
      if (duplicate && !existing) {
        // Skip duplicate copies (same logical track from another folder).
        continue;
      }

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
    }
  }

  function dirnameHint(full: string, root: string): string {
    const parent = basename(dirname(full));
    if (parent && parent !== basename(root)) return parent;
    return "Unknown album";
  }

  await walk(rootPath, basename(rootPath));

  const rows = db
    .prepare(`SELECT path FROM tracks WHERE source_id = ?`)
    .all(sourceId) as { path: string }[];
  for (const r of rows) {
    if (!seenPaths.has(r.path)) {
      db.prepare(`DELETE FROM tracks WHERE path = ?`).run(r.path);
      result.removed++;
    }
  }

  db.prepare(`UPDATE sources SET last_scan_at = ? WHERE id = ?`).run(
    Date.now(),
    sourceId
  );

  return result;
}

export function stableArtKey(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "album"
  );
}

export function guessArtworkExtension(format: string | undefined): string {
  const f = (format ?? "").toLowerCase();
  if (f.includes("png")) return "png";
  if (f.includes("webp")) return "webp";
  return "jpg";
}
