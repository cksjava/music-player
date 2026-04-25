import type { ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, MusicNotesPlus } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { useToast } from "../context/ToastContext";

export function AddToPlaylistDialog(props: {
  open: boolean;
  trackId: string | null;
  trackTitle?: string | null;
  onClose: () => void;
}): ReactElement | null {
  const { open, trackId, trackTitle, onClose } = props;
  const qc = useQueryClient();
  const toast = useToast();

  const playlistsQ = useQuery({
    queryKey: ["playlists"],
    queryFn: () => musicApi.playlists(),
    enabled: open,
  });

  const addTrack = useMutation({
    mutationFn: (playlistId: string) =>
      musicApi.addPlaylistTracks(playlistId, trackId ? [trackId] : []),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["playlists"] });
      await qc.invalidateQueries({ queryKey: ["playlist"] });
      toast("Track added to playlist", "info");
      onClose();
    },
    onError: (e: Error) => toast(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute inset-0 mx-auto flex h-full w-full max-w-lg flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-300">
            <MusicNotesPlus size={18} className="text-violet-400" />
            Add to playlist
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Close add to playlist dialog"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 truncate text-sm text-zinc-400">
          {trackTitle ? `Track: ${trackTitle}` : "Choose a playlist"}
        </p>

        {playlistsQ.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-zinc-800/70" />
        ) : (playlistsQ.data?.playlists ?? []).length === 0 ? (
          <p className="rounded-xl bg-black/20 px-3 py-6 text-center text-sm text-zinc-500">
            No playlists yet. Create one in the Playlists tab.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 p-2">
            {(playlistsQ.data?.playlists ?? []).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={!trackId || addTrack.isPending}
                  onClick={() => addTrack.mutate(p.id)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-zinc-300 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="text-[11px] text-zinc-500">Add</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
