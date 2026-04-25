import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Playlist, Plus } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../context/ToastContext";

export function PlaylistsPage(): ReactElement {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data, error } = useQuery({
    queryKey: ["playlists"],
    queryFn: () => musicApi.playlists(),
  });

  const create = useMutation({
    mutationFn: () => musicApi.createPlaylist(name.trim() || "New playlist"),
    onSuccess: async () => {
      setName("");
      await qc.invalidateQueries({ queryKey: ["playlists"] });
    },
    onError: (e: Error) => toast(e.message),
  });

  useEffect(() => {
    if (error) toast((error as Error).message);
  }, [error, toast]);

  const playlists = data?.playlists ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      <PageHeader title="Playlists" subtitle="Curated queues for any mood" />
      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist name"
          className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-4 py-3 text-sm text-white outline-none ring-1 ring-black/30 placeholder:text-zinc-600 focus:border-violet-500/50 focus:ring-violet-500/20"
        />
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-500 disabled:opacity-40"
        >
          <Plus size={20} weight="bold" />
          Create
        </button>
      </form>
      <ul className="space-y-2">
        {playlists.map((p) => (
          <li key={p.id}>
            <Link
              to={`/playlists/${p.id}`}
              className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-zinc-900/50 px-4 py-3.5 transition hover:border-violet-500/25 hover:bg-zinc-900"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-600/25 to-violet-600/25 text-violet-300 ring-1 ring-white/10">
                <Playlist size={24} weight="duotone" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{p.name}</p>
                <p className="text-xs text-zinc-500">{p.trackCount ?? 0} tracks</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
