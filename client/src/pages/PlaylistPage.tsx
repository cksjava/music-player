import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilSimple, Play, Trash } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { TrackRow } from "../components/TrackRow";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";

export function PlaylistPage(): ReactElement {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const { data, error } = useQuery({
    queryKey: ["playlist", id, "tracks"],
    queryFn: async () => {
      const [pl, tr] = await Promise.all([
        musicApi.playlists().then((r) => r.playlists.find((x) => x.id === id)),
        musicApi.playlistTracks(id),
      ]);
      return { playlist: pl, tracks: tr.tracks };
    },
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (error) toast((error as Error).message);
  }, [error, toast]);

  useEffect(() => {
    if (data?.playlist) setName(data.playlist.name);
  }, [data?.playlist]);

  const { data: playerData } = usePlayerState();
  const { setQueue } = usePlayerActions();

  const rename = useMutation({
    mutationFn: () => musicApi.patchPlaylist(id, name.trim()),
    onSuccess: async () => {
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["playlist", id] });
      await qc.invalidateQueries({ queryKey: ["playlists"] });
    },
    onError: (e: Error) => toast(e.message),
  });

  const del = useMutation({
    mutationFn: () => musicApi.deletePlaylist(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["playlists"] });
      navigate("/playlists", { replace: true });
    },
    onError: (e: Error) => toast(e.message),
  });

  const removeTrack = useMutation({
    mutationFn: (tid: string) => musicApi.removePlaylistTrack(id, tid),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["playlist", id, "tracks"] });
    },
    onError: (e: Error) => toast(e.message),
  });

  const pl = data?.playlist;
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
        title={pl?.name ?? "Playlist"}
        subtitle={`${tracks.length} tracks`}
        backTo="/playlists"
        right={
          <div className="flex gap-1">
            {ids.length ? (
              <button
                type="button"
                onClick={() => void playAll()}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-lg transition hover:bg-violet-500"
                aria-label="Play playlist"
              >
                <Play weight="fill" size={20} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white"
              aria-label="Rename"
            >
              <PencilSimple size={20} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete this playlist?")) del.mutate();
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10"
              aria-label="Delete playlist"
            >
              <Trash size={20} />
            </button>
          </div>
        }
      />
      {editing ? (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet-500/50"
          />
          <button
            type="submit"
            className="rounded-xl bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Save
          </button>
        </form>
      ) : null}
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
              onRemove={() => removeTrack.mutate(t.id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
