import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Disc, MusicNotesSimple, Play, Shuffle } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { TrackRow } from "../components/TrackRow";
import { formatMs } from "../lib/format";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";

export function AlbumPage(): ReactElement {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data, error } = useQuery({
    queryKey: ["album", id],
    queryFn: () => musicApi.album(id),
    enabled: Boolean(id),
  });
  const { data: playerData } = usePlayerState();
  const { setQueue, play, appendQueue } = usePlayerActions();

  useEffect(() => {
    if (error) toast((error as Error).message);
  }, [error, toast]);

  const album = data?.album;
  const tracks = data?.tracks ?? [];
  const ids = tracks.map((t) => t.id);
  const [artworkFailed, setArtworkFailed] = useState(false);

  useEffect(() => {
    setArtworkFailed(false);
  }, [id]);

  const totalDuration = useMemo(
    () =>
      tracks.reduce((acc, t) => acc + (t.durationMs && t.durationMs > 0 ? t.durationMs : 0), 0),
    [tracks]
  );

  async function playAll(shuffle: boolean): Promise<void> {
    if (ids.length === 0) return;
    const order = shuffle ? [...ids].sort(() => Math.random() - 0.5) : ids;
    try {
      await setQueue(order, 0);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function playTrack(trackId: string): Promise<void> {
    const idx = ids.indexOf(trackId);
    try {
      if (idx >= 0) await setQueue(ids, idx);
      else await play(trackId);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      <PageHeader
        title={album?.title ?? "Album"}
        subtitle={album?.artistName ?? " "}
        backTo="/library"
        right={
          ids.length ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => void playAll(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 active:scale-95"
                aria-label="Play album"
              >
                <Play weight="fill" size={20} />
              </button>
              <button
                type="button"
                onClick={() => void playAll(true)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-zinc-200 transition hover:border-violet-500/40 hover:text-white active:scale-95"
                aria-label="Shuffle"
              >
                <Shuffle size={20} />
              </button>
            </div>
          ) : null
        }
      />
      {!album ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <section className="mb-5 rounded-3xl border border-white/[0.08] bg-zinc-900/45 p-4 shadow-xl shadow-black/20">
            <div className="flex items-center gap-4">
              <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-violet-600/40 to-fuchsia-700/25">
                {!artworkFailed ? (
                  <img
                    src={musicApi.albumArtworkUrl(album.id)}
                    alt={`${album.title} artwork`}
                    className="h-full w-full object-cover"
                    onError={() => setArtworkFailed(true)}
                  />
                ) : null}
                {artworkFailed ? (
                  <div className="flex h-full w-full items-center justify-center text-violet-200">
                    <Disc size={40} weight="duotone" />
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-bold text-white">{album.title}</h2>
                <p className="truncate text-sm text-zinc-400">
                  {album.artistName ?? "Unknown artist"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                  <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-zinc-300">
                    {tracks.length} tracks
                  </span>
                  {totalDuration > 0 ? (
                    <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-zinc-300">
                      {formatMs(totalDuration)}
                    </span>
                  ) : null}
                  {album.year ? (
                    <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-zinc-300">
                      {album.year}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
            <MusicNotesSimple size={16} className="text-violet-400" />
            Track list
          </section>
          <ul className="space-y-1">
            {tracks.map((t, i) => (
              <li key={t.id}>
                <TrackRow
                  track={t}
                  index={i}
                  showAlbum={false}
                  showActions={false}
                  active={playerData?.state.trackId === t.id}
                  onPlay={() => void playTrack(t.id)}
                  onQueue={() =>
                    void appendQueue([t.id]).catch((e) => toast((e as Error).message))
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
