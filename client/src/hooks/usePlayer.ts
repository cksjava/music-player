import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { musicApi } from "../api/client";
import type { PlayerState, Track } from "../types";

export const playerQueryKey = ["player", "state"] as const;

export function usePlayerState(): ReturnType<
  typeof useQuery<{ state: PlayerState; current: (Track & { path: string }) | null }>
> {
  return useQuery({
    queryKey: playerQueryKey,
    queryFn: () => musicApi.playerState(),
    refetchInterval: (q) =>
      q.state.data?.state.status === "playing" ? 900 : false,
  });
}

export function usePlayerActions(): {
  play: (trackId?: string) => Promise<void>;
  toggle: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setVolume: (v: number) => Promise<void>;
  setMuted: (m: boolean) => Promise<void>;
  setShuffle: (s: boolean) => Promise<void>;
  setRepeat: (r: "off" | "one" | "all") => Promise<void>;
  setQueue: (ids: string[], start?: number) => Promise<void>;
  appendQueue: (ids: string[]) => Promise<void>;
  playIndex: (i: number) => Promise<void>;
  setDevice: (d: string | null) => Promise<void>;
  playCd: (trackNumber?: number) => Promise<void>;
  stopCd: () => Promise<void>;
  pending: boolean;
} {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: async (fn: () => Promise<{ state: PlayerState }>) => {
      await fn();
      await qc.invalidateQueries({ queryKey: playerQueryKey });
    },
  });
  return {
    play: async (trackId?: string) => {
      await run.mutateAsync(() => musicApi.play(trackId));
    },
    toggle: async () => {
      await run.mutateAsync(() => musicApi.toggle());
    },
    pause: async () => {
      await run.mutateAsync(() => musicApi.pause());
    },
    stop: async () => {
      await run.mutateAsync(() => musicApi.stop());
    },
    seek: async (ms: number) => {
      await run.mutateAsync(() => musicApi.seek(ms));
    },
    next: async () => {
      await run.mutateAsync(() => musicApi.next());
    },
    prev: async () => {
      await run.mutateAsync(() => musicApi.prev());
    },
    setVolume: async (v: number) => {
      await run.mutateAsync(() => musicApi.volume(v));
    },
    setMuted: async (m: boolean) => {
      await run.mutateAsync(() => musicApi.mute(m));
    },
    setShuffle: async (s: boolean) => {
      await run.mutateAsync(() => musicApi.shuffle(s));
    },
    setRepeat: async (r: "off" | "one" | "all") => {
      await run.mutateAsync(() => musicApi.repeat(r));
    },
    setQueue: async (ids: string[], start = 0) => {
      await run.mutateAsync(() => musicApi.setQueue(ids, start));
    },
    appendQueue: async (ids: string[]) => {
      await run.mutateAsync(() => musicApi.appendQueue(ids));
    },
    playIndex: async (i: number) => {
      await run.mutateAsync(() => musicApi.playQueueIndex(i));
    },
    setDevice: async (d: string | null) => {
      await run.mutateAsync(() => musicApi.setDevice(d));
    },
    playCd: async (trackNumber?: number) => {
      await run.mutateAsync(() => musicApi.cdPlay(trackNumber));
    },
    stopCd: async () => {
      await run.mutateAsync(() => musicApi.cdStop());
    },
    pending: run.isPending,
  };
}
