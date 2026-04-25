import type { ReactElement } from "react";
import { MusicNotesPlus, Play, Trash } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { formatMs } from "../lib/format";
import type { Track } from "../types";

export function TrackRow(props: {
  track: Track;
  index?: number;
  active?: boolean;
  showAlbum?: boolean;
  showActions?: boolean;
  onPlay: () => void;
  onAddToPlaylist?: () => void;
  onRemove?: () => void;
  className?: string;
}): ReactElement {
  const {
    track,
    index,
    active,
    showAlbum = true,
    showActions = true,
    onPlay,
    onAddToPlaylist,
    onRemove,
    className,
  } = props;
  const subtitle = showAlbum
    ? [track.artistName, track.albumTitle].filter(Boolean).join(" · ")
    : (track.artistName ?? "");
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl px-2 py-2 transition",
        active ? "bg-violet-500/15 ring-1 ring-violet-500/30" : "hover:bg-white/[0.04]",
        className
      )}
    >
      {index != null ? (
        <span className="w-7 shrink-0 text-center text-xs font-semibold tabular-nums text-zinc-500">
          {track.trackNumber ?? index + 1}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col items-start text-left">
        <span className="flex w-full items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
            {track.title}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
            {formatMs(track.durationMs)}
          </span>
        </span>
        <span className="block w-full truncate text-xs text-zinc-500">
          {subtitle || " "}
        </span>
      </div>
      {showActions ? (
      <div className="flex shrink-0 items-center gap-0.5">
        {onRemove ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
            aria-label="Remove"
          >
            <Trash size={20} />
          </button>
        ) : null}
        {onAddToPlaylist ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToPlaylist();
            }}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"
            aria-label="Add to playlist"
          >
            <MusicNotesPlus size={21} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className="rounded-lg p-2 text-violet-400 hover:bg-violet-500/15"
          aria-label="Play"
        >
          <Play size={22} weight="fill" />
        </button>
      </div>
      ) : null}
    </div>
  );
}
