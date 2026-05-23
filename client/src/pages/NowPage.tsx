import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ListIcon,
  PauseIcon,
  PlusIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  MinusIcon,
  SpeakerHighIcon,
  MusicNotesPlusIcon,
  SpeakerSlashIcon,
  SpeakerXIcon,
  XIcon,
} from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { AddToPlaylistDialog } from "../components/AddToPlaylistDialog";
import { BlitzLogo } from "../components/BlitzLogo";
import { formatMs } from "../lib/format";
import { cn } from "../lib/cn";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";

export function NowPage(): ReactElement {
  const toast = useToast();
  const { data, isLoading } = usePlayerState();
  const actions = usePlayerActions();
  const state = data?.state;
  const current = data?.current;

  const queueIds = state?.queue ?? [];
  const { data: queueTracks } = useQuery({
    queryKey: ["queue", queueIds.join(",")],
    queryFn: () => musicApi.tracksByIds(queueIds),
    select: (r) => r.tracks,
    enabled: queueIds.length > 0,
  });
  const queueTrackById = useMemo(
    () => new Map((queueTracks ?? []).map((t) => [t.id, t])),
    [queueTracks]
  );

  const [showQueue, setShowQueue] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  /** Shown after seek until server poll reports the new position (avoids thumb snapping back). */
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);
  const pos = scrub ?? pendingSeekMs ?? state?.positionMs ?? 0;
  const dur = state?.durationMs ?? current?.durationMs ?? 0;

  const playing = state?.status === "playing";
  const trackIdForPlaylist = state?.trackId ?? current?.id ?? null;
  const isCdTrack = Boolean(
    state?.trackId?.startsWith("cd:") || current?.id?.startsWith("cd:")
  );

  const cycleRepeat = useCallback(() => {
    const r = state?.repeat ?? "off";
    const next = r === "off" ? "all" : r === "all" ? "one" : "off";
    void actions.setRepeat(next);
  }, [actions, state?.repeat]);

  useEffect(() => {
    setScrub(null);
    setPendingSeekMs(null);
  }, [state?.trackId]);

  useEffect(() => {
    if (pendingSeekMs == null || state?.positionMs == null) return;
    if (Math.abs(state.positionMs - pendingSeekMs) < 1200) {
      setPendingSeekMs(null);
    }
  }, [pendingSeekMs, state?.positionMs]);

  useEffect(() => {
    setArtworkFailed(false);
  }, [current?.albumId]);

  const commitSeekFromRange = useCallback(
    (el: HTMLInputElement) => {
      const raw = Number(el.value);
      const max = dur > 0 ? dur : 0;
      const ms = max > 0 ? Math.min(max, Math.max(0, raw)) : Math.max(0, raw);
      setScrub(null);
      setPendingSeekMs(ms);
      void actions.seek(ms).catch(() => {
        setPendingSeekMs(null);
      });
    },
    [actions, dur]
  );

  const repeatIcon = useMemo(() => {
    if (state?.repeat === "one")
      return <RepeatOnceIcon size={22} weight="fill" className="text-violet-400" />;
    if (state?.repeat === "all")
      return <RepeatIcon size={22} weight="fill" className="text-violet-400" />;
    return <RepeatIcon size={22} />;
  }, [state?.repeat]);

  return (
    <div className="layout-now flex flex-col">
      <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] mx-auto flex layout-now-max items-start justify-between gap-2 px-4 sm:px-6">
        <BlitzLogo size="header" className="pointer-events-auto shrink-0 pt-0.5" />
        <div className="pointer-events-auto flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => {
            if (!trackIdForPlaylist) {
              toast("Play a track first, then add it to a playlist.", "info");
              return;
            }
            setShowAddToPlaylist(true);
          }}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900/80 px-3 py-2 text-zinc-300 shadow-lg shadow-black/30 backdrop-blur-xl transition hover:border-fuchsia-500/30 hover:text-white"
          aria-label="Add current track to playlist"
        >
          <MusicNotesPlusIcon size={20} className="text-fuchsia-300" weight="bold" />
          <span className="text-xs font-semibold text-zinc-200">Add</span>
        </button>
        <button
          type="button"
          onClick={() => setShowVolume(true)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/80 px-3 py-2 text-zinc-300 shadow-lg shadow-black/30 backdrop-blur-xl transition hover:border-violet-500/30 hover:text-white"
          aria-label="Show volume controls"
        >
          {state?.muted ? (
            <SpeakerXIcon size={20} weight="fill" />
          ) : (state?.volume ?? 0) === 0 ? (
            <SpeakerSlashIcon size={20} />
          ) : (
            <SpeakerHighIcon size={20} weight="fill" />
          )}
          <span className="text-xs font-semibold tabular-nums text-zinc-400">
            {Math.round(state?.volume ?? 0)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setShowQueue(true)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/80 px-3 py-2 text-zinc-300 shadow-lg shadow-black/30 backdrop-blur-xl transition hover:border-violet-500/30 hover:text-white"
          aria-label="Show queue"
        >
          <ListIcon size={20} />
          <span className="text-xs font-semibold text-zinc-400">{queueIds.length}</span>
        </button>
        </div>
      </div>

      <div className="relative mb-6 mt-1 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-zinc-800/80 to-zinc-950 shadow-2xl ring-1 ring-white/[0.04]">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse_at_30%_0%,var(--now-gradient-a),transparent 55%),radial-gradient(ellipse_at_100%_40%,var(--now-gradient-b),transparent 45%)",
          }}
        />
        <div className="relative flex flex-col items-center px-6 pb-7 pt-9">
          <div
            className={cn(
              "relative mb-7 h-[16.5rem] w-[16.5rem] rounded-full border border-white/10 bg-[conic-gradient(from_210deg_at_50%_50%,rgba(255,255,255,0.14),rgba(255,255,255,0.05),rgba(255,255,255,0.14))] p-4 shadow-[0_20px_55px_rgba(0,0,0,0.55)] ring-1 ring-white/10 sm:h-[19rem] sm:w-[19rem]",
              playing && "animate-[spin_18s_linear_infinite]"
            )}
          >
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-zinc-700/25 to-zinc-900/40" />
            <div className="relative flex h-full w-full items-center justify-center rounded-full border border-white/10 bg-zinc-900/35">
              <div className="relative h-[84%] w-[84%] overflow-hidden rounded-full border border-white/20 shadow-inner shadow-black/35">
                {!artworkFailed && current?.albumId ? (
                  <img
                    src={musicApi.albumArtworkUrl(current.albumId)}
                    alt={`${current.albumTitle ?? current.title} artwork`}
                    className="h-full w-full object-cover"
                    onError={() => setArtworkFailed(true)}
                  />
                ) : isCdTrack ? (
                  <img
                    src="/cd-scenery.jpg"
                    alt="Audio CD artwork"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500/35 to-fuchsia-600/20 text-5xl font-black tracking-tight text-white">
                    {(current?.albumTitle ?? current?.title ?? "♪").slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="absolute flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-zinc-900/90 shadow-[0_0_0_4px_rgba(0,0,0,0.45)]">
                <div className="h-4 w-4 rounded-full border border-white/20 bg-zinc-950" />
              </div>
            </div>
          </div>
          <h1 className="max-w-full text-center text-[1.85rem] font-bold leading-tight text-white sm:text-3xl">
            {current?.title ?? (isLoading ? "Connecting…" : "Nothing playing")}
          </h1>
          <p className="mt-2 max-w-full text-center text-sm text-violet-200/80">
            {[current?.artistName, current?.albumTitle].filter(Boolean).join(" · ") ||
              "Pick a track from your library"}
          </p>
          {state?.error ? (
            <p className="mt-3 max-w-full rounded-xl border border-red-500/30 bg-red-950/50 px-3 py-2 text-center text-xs text-red-200">
              {state.error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mb-5">
        <div className="flex items-center gap-3 text-xs font-medium tabular-nums text-zinc-500">
          <span className="w-9 shrink-0 text-left">{formatMs(pos)}</span>
          <input
            type="range"
            min={0}
            max={dur > 0 ? dur : 1}
            step={500}
            value={dur > 0 ? pos : 0}
            onInput={(e) => setScrub(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={(e) => commitSeekFromRange(e.currentTarget)}
            onPointerCancel={(e) => {
              setScrub(null);
              setPendingSeekMs(null);
              e.currentTarget.blur();
            }}
            onKeyUp={(e) => {
              if (e.key === "Enter") commitSeekFromRange(e.currentTarget);
            }}
            disabled={!dur || dur <= 0}
            className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-violet-500 disabled:opacity-40"
          />
          <span className="w-9 shrink-0 text-right">{formatMs(dur || null)}</span>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-center gap-4 sm:gap-6">
        <button
          type="button"
          onClick={() => void actions.setShuffle(!state?.shuffle)}
          className={cn(
            "rounded-full p-3 transition hover:bg-white/5",
            state?.shuffle ? "text-violet-400" : "text-zinc-500"
          )}
          aria-label="Shuffle"
        >
          <ShuffleIcon size={24} weight={state?.shuffle ? "fill" : "regular"} />
        </button>
        <button
          type="button"
          onClick={() => void actions.prev()}
          className="rounded-full p-3 text-zinc-300 transition hover:bg-white/5 hover:text-white"
          aria-label="Previous"
        >
          <SkipBackIcon size={32} weight="fill" />
        </button>
        <button
          type="button"
          onClick={() => void actions.toggle()}
          className="flex h-16 w-16 aspect-square items-center justify-center rounded-full bg-white text-zinc-950 shadow-xl shadow-violet-900/30 transition hover:scale-[1.02] active:scale-95"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <PauseIcon size={36} weight="fill" />
          ) : (
            <PlayIcon size={36} weight="fill" className="-ml-px" />
          )}
        </button>
        <button
          type="button"
          onClick={() => void actions.next()}
          className="rounded-full p-3 text-zinc-300 transition hover:bg-white/5 hover:text-white"
          aria-label="Next"
        >
          <SkipForwardIcon size={32} weight="fill" />
        </button>
        <button
          type="button"
          onClick={() => void cycleRepeat()}
          className="rounded-full p-3 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300"
          aria-label="Repeat mode"
        >
          {repeatIcon}
        </button>
      </div>

      {showQueue ? (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm"
          onClick={() => setShowQueue(false)}
        >
          <div
            className="absolute inset-0 mx-auto flex h-full w-full layout-now-max flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Queue ({queueIds.length})</h3>
              <button
                type="button"
                onClick={() => setShowQueue(false)}
                className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Close queue"
              >
                <XIcon size={20} />
              </button>
            </div>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-white/[0.05] bg-black/20 p-2">
              {queueIds.map((trackId, queueIndex) => {
                const t = queueTrackById.get(trackId);
                return (
                <li key={`${trackId}-${queueIndex}`}>
                  <button
                    type="button"
                    onClick={() => {
                      void actions.playIndex(queueIndex);
                      setShowQueue(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition",
                      state?.queueIndex === queueIndex
                        ? "bg-violet-500/15 text-white"
                        : "hover:bg-white/5"
                    )}
                  >
                    <span className="w-6 text-xs tabular-nums text-zinc-500">{queueIndex + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{t?.title ?? "Missing track"}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {t?.artistName ?? ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatMs(t?.durationMs ?? null)}
                    </span>
                  </button>
                </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <AddToPlaylistDialog
        open={showAddToPlaylist}
        trackId={trackIdForPlaylist}
        trackTitle={current?.title}
        onClose={() => setShowAddToPlaylist(false)}
      />

      {showVolume ? (
        <div
          className="fixed inset-0 z-[80]"
          onClick={() => setShowVolume(false)}
        >
          <div
            className="absolute bottom-24 right-4 w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-white/[0.08] bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Volume</h3>
              <button
                type="button"
                onClick={() => setShowVolume(false)}
                className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Close volume controls"
              >
                <XIcon size={20} />
              </button>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-zinc-900/50 px-3 py-2">
              <button
                type="button"
                onClick={() => void actions.setMuted(!state?.muted)}
                className="text-zinc-400 hover:text-white"
                aria-label={state?.muted ? "Unmute" : "Mute"}
              >
                {state?.muted ? (
                  <SpeakerXIcon size={22} weight="fill" />
                ) : (state?.volume ?? 0) === 0 ? (
                  <SpeakerSlashIcon size={22} />
                ) : (
                  <SpeakerHighIcon size={22} weight="fill" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void actions.setVolume(Math.max(0, Math.round(state?.volume ?? 0) - 5))}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Decrease volume"
              >
                <MinusIcon size={18} weight="bold" />
              </button>
              <input
                type="range"
                min={0}
                max={130}
                value={Math.round(state?.volume ?? 0)}
                onChange={(e) => void actions.setVolume(Number(e.target.value))}
                className="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-800 accent-fuchsia-500"
                aria-label="Volume"
              />
              <button
                type="button"
                onClick={() => void actions.setVolume(Math.min(130, Math.round(state?.volume ?? 0) + 5))}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Increase volume"
              >
                <PlusIcon size={18} weight="bold" />
              </button>
              <span className="w-10 text-right text-xs font-semibold tabular-nums text-zinc-500">
                {Math.round(state?.volume ?? 0)}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
