import type { ReactElement } from "react";
import { useDeferredValue, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Disc, MagnifyingGlass, UsersThree } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { cn } from "../lib/cn";
import { useToast } from "../context/ToastContext";

type Tab = "albums" | "artists";

export function LibraryPage(): ReactElement {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("albums");
  const [q, setQ] = useState("");
  const [artworkErrors, setArtworkErrors] = useState<Record<string, boolean>>({});
  const dq = useDeferredValue(q.trim());

  const albumsQ = useQuery({
    queryKey: ["albums", dq],
    queryFn: () => musicApi.albums({ q: dq || undefined, limit: 120 }),
    enabled: tab === "albums",
  });

  const artistsQ = useQuery({
    queryKey: ["artists", dq],
    queryFn: () => musicApi.artists({ q: dq || undefined, limit: 120 }),
    enabled: tab === "artists",
  });

  useEffect(() => {
    const err = albumsQ.error ?? artistsQ.error;
    if (err) toast((err as Error).message);
  }, [albumsQ.error, artistsQ.error, toast]);

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      <PageHeader title="Library" subtitle="Albums & artists on this Pi" />
      <div className="mb-5 flex rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-1">
        <button
          type="button"
          onClick={() => setTab("albums")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition",
            tab === "albums"
              ? "bg-white/[0.08] text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Disc size={20} weight={tab === "albums" ? "fill" : "regular"} />
          Albums
        </button>
        <button
          type="button"
          onClick={() => setTab("artists")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition",
            tab === "artists"
              ? "bg-white/[0.08] text-white shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <UsersThree size={20} weight={tab === "artists" ? "fill" : "regular"} />
          Artists
        </button>
      </div>
      <label className="mb-6 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/60 px-4 py-3 shadow-inner ring-1 ring-black/20 focus-within:border-violet-500/40 focus-within:ring-violet-500/20">
        <MagnifyingGlass className="shrink-0 text-zinc-500" size={22} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search albums, artists…"
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </label>

      {tab === "albums" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {albumsQ.isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="aspect-square animate-pulse rounded-2xl bg-zinc-800/80"
                />
              ))
            : (albumsQ.data?.albums ?? []).map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/library/album/${a.id}`}
                    className="block overflow-hidden rounded-2xl border border-white/[0.06] bg-zinc-900/60 shadow-lg transition hover:border-violet-500/30 hover:shadow-violet-500/10"
                  >
                    <div className="aspect-square bg-gradient-to-br from-violet-600/35 via-zinc-800 to-fuchsia-900/30 p-4">
                      {!artworkErrors[a.id] ? (
                        <img
                          src={musicApi.albumArtworkUrl(a.id)}
                          alt={`${a.title} artwork`}
                          className="h-full w-full rounded-xl object-cover ring-1 ring-white/10"
                          loading="lazy"
                          onError={() =>
                            setArtworkErrors((prev) => ({ ...prev, [a.id]: true }))
                          }
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-xl bg-black/20 text-3xl font-bold text-white/90 ring-1 ring-white/10">
                          {a.title.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="p-3 pt-2">
                      <p className="truncate text-sm font-semibold text-white">{a.title}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {a.artistName ?? "Various"}{" "}
                        {a.trackCount != null ? `· ${a.trackCount} tracks` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {artistsQ.isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="h-16 animate-pulse rounded-2xl bg-zinc-800/80" />
              ))
            : (artistsQ.data?.artists ?? []).map((ar) => (
                <li key={ar.id}>
                  <Link
                    to={`/library/artist/${ar.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-zinc-900/50 px-4 py-3 transition hover:border-violet-500/25 hover:bg-zinc-900"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/30 to-indigo-600/20 text-sm font-bold text-white ring-1 ring-white/10">
                      {ar.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-white">{ar.name}</p>
                      <p className="text-xs text-zinc-500">
                        {ar.trackCount ?? 0} tracks · {ar.albumCount ?? 0} albums
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
        </ul>
      )}
    </div>
  );
}
