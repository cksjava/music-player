import type { ReactElement } from "react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Play, Disc } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { TrackRow } from "../components/TrackRow";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";

export function ArtistPage(): ReactElement {
  const { id = "" } = useParams();
  const toast = useToast();
  const { data, error } = useQuery({
    queryKey: ["artist", id],
    queryFn: () => musicApi.artist(id),
    enabled: Boolean(id),
  });
  const { data: playerData } = usePlayerState();
  const { setQueue, appendQueue } = usePlayerActions();

  useEffect(() => {
    if (error) toast((error as Error).message);
  }, [error, toast]);

  const artist = data?.artist;
  const albums = data?.albums ?? [];
  const tracks = data?.tracks ?? [];
  const ids = tracks.map((t) => t.id);

  async function playAll(): Promise<void> {
    if (ids.length === 0) return;
    try {
      await setQueue(ids, 0);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      <PageHeader
        title={artist?.name ?? "Artist"}
        subtitle={`${tracks.length} tracks`}
        backTo="/library"
        right={
          ids.length ? (
            <button
              type="button"
              onClick={() => void playAll()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 active:scale-95"
              aria-label="Play all"
            >
              <Play weight="fill" size={20} />
            </button>
          ) : null
        }
      />
      {albums.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
            Albums
          </h2>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {albums.map((a) => (
              <li key={a.id} className="shrink-0">
                <Link
                  to={`/library/album/${a.id}`}
                  className="flex w-36 flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-zinc-900/60 transition hover:border-violet-500/30"
                >
                  <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-indigo-600/30 to-violet-800/20">
                    <Disc className="text-white/40" size={36} weight="duotone" />
                  </div>
                  <p className="truncate px-2 py-2 text-xs font-medium text-zinc-200">{a.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Tracks</h2>
      <ul className="space-y-1">
        {tracks.map((t, i) => (
          <li key={t.id}>
            <TrackRow
              track={t}
              index={i}
              active={playerData?.state.trackId === t.id}
              onPlay={() =>
                void (async () => {
                  const idx = ids.indexOf(t.id);
                  try {
                    await setQueue(ids, Math.max(0, idx));
                  } catch (e) {
                    toast((e as Error).message);
                  }
                })()
              }
              onQueue={() =>
                void appendQueue([t.id])
                  .then(() => toast("Added to queue", "info"))
                  .catch((e) => toast((e as Error).message))
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
