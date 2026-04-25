export type SourceKind = "folder" | "cd";

export interface Source {
  id: string;
  path: string;
  label: string;
  kind: SourceKind;
  enabled: boolean;
  createdAt: number;
  lastScanAt: number | null;
}

export interface Artist {
  id: string;
  name: string;
}

export interface Album {
  id: string;
  title: string;
  artistId: string | null;
  artistName: string | null;
  year: number | null;
  artworkPath: string | null;
  sourceId: string | null;
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
}

export interface Playlist {
  id: string;
  name: string;
  position: number;
  createdAt: number;
}

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
