import type { ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { Pause, Play, SkipForward } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { formatMs } from "../lib/format";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";

export function MiniPlayer(): ReactElement | null {
  const location = useLocation();
  const { data } = usePlayerState();
  const { toggle, next } = usePlayerActions();

  if (location.pathname === "/now") return null;

  const current = data?.current;
  const state = data?.state;
  if (!current && state?.status !== "error") return null;

  const playing = state?.status === "playing";
  const progress =
    state?.durationMs && state.durationMs > 0
      ? Math.min(1, state.positionMs / state.durationMs)
      : 0;

  return (
    <div className="fixed bottom-[calc(3.25rem+max(env(safe-area-inset-bottom),0px))] left-0 right-0 z-40 px-3">
      <Link
        to="/now"
        className={cn(
          "mx-auto flex layout-chrome-inner items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/90 p-2.5 shadow-xl shadow-black/40 backdrop-blur-xl transition hover:border-violet-500/25 hover:bg-zinc-900"
        )}
      >
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet-600/40 to-fuchsia-600/30 ring-1 ring-white/10">
          <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-white/90">
            {(current?.albumTitle ?? current?.title ?? "?").slice(0, 1)}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {current?.title ?? (state?.error ? "Playback" : "—")}
          </p>
          <p className="truncate text-xs text-zinc-400">
            {state?.error
              ? state.error
              : [current?.artistName, current?.albumTitle].filter(Boolean).join(" · ") ||
                " "}
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 pr-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void toggle();
            }}
            className="flex h-11 w-11 aspect-square items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg transition hover:bg-zinc-100 active:scale-95"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause weight="fill" size={22} />
            ) : (
              <Play weight="fill" size={22} />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void next();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/5 hover:text-white active:scale-95"
            aria-label="Next track"
          >
            <SkipForward size={22} />
          </button>
        </div>
      </Link>
      <p className="mt-1 text-center text-[10px] font-medium tabular-nums text-zinc-600">
        {formatMs(state?.positionMs)} / {formatMs(state?.durationMs ?? null)}
      </p>
    </div>
  );
}
