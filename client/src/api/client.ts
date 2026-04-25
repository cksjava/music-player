import type {
  Album,
  Artist,
  AudioCdInfo,
  AudioDevice,
  ErrorLogEntry,
  FsBrowseResponse,
  PlayerState,
  Playlist,
  Source,
  Track,
} from "../types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: unknown };
      if (j.error) msg = typeof j.error === "string" ? j.error : JSON.stringify(j.error);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const musicApi = {
  health: () => api<{ ok: boolean }>("/api/health"),

  playerState: () =>
    api<{ state: PlayerState; current: (Track & { path: string }) | null }>(
      "/api/player/state"
    ),

  play: (trackId?: string) =>
    api<{ state: PlayerState }>("/api/player/play", {
      method: "POST",
      body: JSON.stringify({ trackId }),
    }),

  pause: () =>
    api<{ state: PlayerState }>("/api/player/pause", { method: "POST" }),

  toggle: () =>
    api<{ state: PlayerState }>("/api/player/toggle", { method: "POST" }),

  stop: () =>
    api<{ state: PlayerState }>("/api/player/stop", { method: "POST" }),

  seek: (ms: number) =>
    api<{ state: PlayerState }>("/api/player/seek", {
      method: "POST",
      body: JSON.stringify({ ms }),
    }),

  next: () =>
    api<{ state: PlayerState }>("/api/player/next", { method: "POST" }),

  prev: () =>
    api<{ state: PlayerState }>("/api/player/prev", { method: "POST" }),

  volume: (volume: number) =>
    api<{ state: PlayerState }>("/api/player/volume", {
      method: "POST",
      body: JSON.stringify({ volume }),
    }),

  mute: (muted: boolean) =>
    api<{ state: PlayerState }>("/api/player/mute", {
      method: "POST",
      body: JSON.stringify({ muted }),
    }),

  shuffle: (shuffle: boolean) =>
    api<{ state: PlayerState }>("/api/player/shuffle", {
      method: "POST",
      body: JSON.stringify({ shuffle }),
    }),

  repeat: (repeat: "off" | "one" | "all") =>
    api<{ state: PlayerState }>("/api/player/repeat", {
      method: "POST",
      body: JSON.stringify({ repeat }),
    }),

  setQueue: (trackIds: string[], startIndex?: number) =>
    api<{ state: PlayerState }>("/api/player/queue", {
      method: "POST",
      body: JSON.stringify({ trackIds, startIndex }),
    }),

  appendQueue: (trackIds: string[]) =>
    api<{ state: PlayerState }>("/api/player/queue/append", {
      method: "POST",
      body: JSON.stringify({ trackIds }),
    }),

  playQueueIndex: (index: number) =>
    api<{ state: PlayerState }>("/api/player/queue/play-index", {
      method: "POST",
      body: JSON.stringify({ index }),
    }),

  setDevice: (device: string | null) =>
    api<{ state: PlayerState }>("/api/player/device", {
      method: "POST",
      body: JSON.stringify({ device }),
    }),

  devices: () => api<{ devices: AudioDevice[] }>("/api/devices"),

  cdInfo: () => api<AudioCdInfo>("/api/cd"),

  cdPlay: (trackNumber?: number) =>
    api<{ state: PlayerState; cd: AudioCdInfo }>("/api/cd/play", {
      method: "POST",
      body: JSON.stringify({ trackNumber }),
    }),

  cdStop: () => api<{ state: PlayerState }>("/api/cd/stop", { method: "POST" }),

  cdEject: () => api<{ ok: boolean }>("/api/cd/eject", { method: "POST" }),

  errorLogs: (limit = 120) => api<{ logs: ErrorLogEntry[] }>(`/api/errors?limit=${limit}`),

  clearErrorLogs: () => api<{ ok: boolean }>("/api/errors", { method: "DELETE" }),

  browseDirectories: (path?: string) => {
    const sp = new URLSearchParams();
    if (path) sp.set("path", path);
    const q = sp.toString();
    return api<FsBrowseResponse>(`/api/fs/directories${q ? `?${q}` : ""}`);
  },

  tracks: (params: { q?: string; albumId?: string; artistId?: string; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.albumId) sp.set("albumId", params.albumId);
    if (params.artistId) sp.set("artistId", params.artistId);
    if (params.limit != null) sp.set("limit", String(params.limit));
    if (params.offset != null) sp.set("offset", String(params.offset));
    const q = sp.toString();
    return api<{ tracks: Track[]; total: number }>(`/api/tracks${q ? `?${q}` : ""}`);
  },

  track: (id: string) => api<Track>(`/api/tracks/${id}`),

  tracksByIds: (ids: string[]) => {
    if (ids.length === 0) return Promise.resolve({ tracks: [] as Track[] });
    const q = encodeURIComponent(ids.join(","));
    return api<{ tracks: Track[] }>(`/api/tracks/by-ids?ids=${q}`);
  },

  albums: (params?: { q?: string; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.limit != null) sp.set("limit", String(params.limit));
    if (params?.offset != null) sp.set("offset", String(params.offset));
    const q = sp.toString();
    return api<{ albums: Album[]; total: number }>(`/api/albums${q ? `?${q}` : ""}`);
  },

  album: (id: string) =>
    api<{ album: Album; tracks: Track[] }>(`/api/albums/${id}`),

  albumArtworkUrl: (id: string) => `/api/albums/${id}/artwork`,

  artists: (params?: { q?: string; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.limit != null) sp.set("limit", String(params.limit));
    if (params?.offset != null) sp.set("offset", String(params.offset));
    const q = sp.toString();
    return api<{ artists: Artist[]; total: number }>(`/api/artists${q ? `?${q}` : ""}`);
  },

  artist: (id: string) =>
    api<{ artist: Artist; albums: Album[]; tracks: Track[] }>(`/api/artists/${id}`),

  sources: () => api<{ sources: Source[] }>("/api/sources"),

  addSource: (body: { path: string; label?: string; kind?: "folder" | "cd" }) =>
    api<Source>("/api/sources", { method: "POST", body: JSON.stringify(body) }),

  patchSource: (id: string, body: { label?: string; enabled?: boolean }) =>
    api<Source>(`/api/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteSource: (id: string) =>
    api<{ ok: boolean }>(`/api/sources/${id}`, { method: "DELETE" }),

  scanSource: (id: string) =>
    api<{
      job: {
        id: string;
        sourceId: string;
        status: "queued" | "running" | "done" | "error";
        createdAt: number;
        startedAt: number | null;
        finishedAt: number | null;
        result: { added: number; updated: number; removed: number; errors: string[] } | null;
        error: string | null;
      };
      alreadyRunning: boolean;
    }>(
      `/api/sources/${id}/scan`,
      { method: "POST" }
    ),

  scanJob: (jobId: string) =>
    api<{
      job: {
        id: string;
        sourceId: string;
        status: "queued" | "running" | "done" | "error";
        createdAt: number;
        startedAt: number | null;
        finishedAt: number | null;
        result: { added: number; updated: number; removed: number; errors: string[] } | null;
        error: string | null;
      };
    }>(`/api/scan-jobs/${jobId}`),

  resetLibrary: (body?: { keepSources?: boolean; stopPlayback?: boolean }) =>
    api<{ ok: boolean; keepSources: boolean; playbackStopped: boolean }>(
      "/api/admin/library/reset",
      { method: "POST", body: JSON.stringify(body ?? {}) }
    ),

  shutdownDevice: () =>
    api<{ ok: boolean; message: string }>("/api/admin/system/shutdown", {
      method: "POST",
    }),

  restartApp: () =>
    api<{ ok: boolean; message: string }>("/api/admin/system/restart-app", {
      method: "POST",
    }),

  updateApp: () =>
    api<{ ok: boolean; message: string }>("/api/admin/system/update-app", {
      method: "POST",
    }),

  playlists: () => api<{ playlists: Playlist[] }>("/api/playlists"),

  createPlaylist: (name: string) =>
    api<Playlist>("/api/playlists", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  patchPlaylist: (id: string, name: string) =>
    api<Playlist>(`/api/playlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deletePlaylist: (id: string) =>
    api<{ ok: boolean }>(`/api/playlists/${id}`, { method: "DELETE" }),

  playlistTracks: (id: string) =>
    api<{ tracks: Track[] }>(`/api/playlists/${id}/tracks`),

  addPlaylistTracks: (id: string, trackIds: string[], position?: number) =>
    api<{ ok: boolean }>(`/api/playlists/${id}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackIds, position }),
    }),

  removePlaylistTrack: (playlistId: string, trackId: string) =>
    api<{ ok: boolean }>(`/api/playlists/${playlistId}/tracks/${trackId}`, {
      method: "DELETE",
    }),
};
