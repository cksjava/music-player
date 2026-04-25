export interface PlayerState {
  status: "idle" | "loading" | "playing" | "paused" | "stopped" | "error";
  trackId: string | null;
  positionMs: number;
  durationMs: number | null;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: "off" | "one" | "all";
  queue: string[];
  queueIndex: number;
  error: string | null;
  audioDevice: string | null;
}

export interface Track {
  id: string;
  path: string;
  title: string;
  discNumber: number | null;
  trackNumber: number | null;
  durationMs: number | null;
  albumId: string | null;
  albumTitle: string | null;
  artistId: string | null;
  artistName: string | null;
  sourceId: string | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  playlistPosition?: number;
}

export interface Album {
  id: string;
  title: string;
  artistId: string | null;
  artistName: string | null;
  year: number | null;
  artworkPath: string | null;
  sourceId: string | null;
  trackCount?: number;
}

export interface Artist {
  id: string;
  name: string;
  trackCount?: number;
  albumCount?: number;
}

export interface Source {
  id: string;
  path: string;
  label: string;
  kind: "folder" | "cd";
  enabled: boolean;
  createdAt: number;
  lastScanAt: number | null;
}

export interface Playlist {
  id: string;
  name: string;
  position: number;
  createdAt: number;
  trackCount?: number;
}

export interface AudioDevice {
  id: string;
  name: string;
}

export interface AudioCdTrack {
  trackNumber: number;
  title: string;
  durationMs: number | null;
}

export interface AudioCdInfo {
  device: string;
  present: boolean;
  tracks: AudioCdTrack[];
}

export interface ErrorLogEntry {
  id: string;
  time: number;
  scope: string;
  message: string;
  detail?: string;
}

export interface FsDirectoryEntry {
  name: string;
  path: string;
}

export interface FsBrowseResponse {
  current: string;
  parent: string | null;
  directories: FsDirectoryEntry[];
}

export interface UpdateStatus {
  status: "idle" | "running" | "ok" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  step: string | null;
  message: string | null;
  beforeCommit: string | null;
  afterCommit: string | null;
}

export interface AppVersion {
  commit: string | null;
  time: number;
}
