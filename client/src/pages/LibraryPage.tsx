import type { ReactElement, RefObject } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DiscIcon, MagnifyingGlassIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { cn } from "../lib/cn";
import { useToast } from "../context/ToastContext";

type Tab = "albums" | "artists";

/** Per request; server caps at MAX_LIBRARY_PAGE. Search uses the same q on every page (full DB). */
const PAGE_SIZE = 48;

function useLoadMoreOnIntersect(
  rootRef: RefObject<HTMLElement | null>,
  fetchNextPage: () => unknown,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled || !hasNextPage) return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage
        ) {
          void fetchNextPage();
        }
      },
      { rootMargin: "320px", threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [
    enabled,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    rootRef,
  ]);
}

export function LibraryPage(): ReactElement {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("albums");
  const [q, setQ] = useState("");
  const [artworkErrors, setArtworkErrors] = useState<Record<string, boolean>>({});
  const dq = useDeferredValue(q.trim());

  const albumsSentinelRef = useRef<HTMLDivElement>(null);
  const artistsSentinelRef = useRef<HTMLDivElement>(null);

  const albumsQ = useInfiniteQuery({
    queryKey: ["albums", dq, "paged"],
    queryFn: ({ pageParam }) =>
      musicApi.albums({
        q: dq || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.albums.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: tab === "albums",
  });

  const artistsQ = useInfiniteQuery({
    queryKey: ["artists", dq, "paged"],
    queryFn: ({ pageParam }) =>
      musicApi.artists({
        q: dq || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.artists.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: tab === "artists",
  });

  const albums = useMemo(
    () => albumsQ.data?.pages.flatMap((p) => p.albums) ?? [],
    [albumsQ.data]
  );
  const artists = useMemo(
    () => artistsQ.data?.pages.flatMap((p) => p.artists) ?? [],
    [artistsQ.data]
  );

  useLoadMoreOnIntersect(
    albumsSentinelRef,
    albumsQ.fetchNextPage,
    Boolean(albumsQ.hasNextPage),
    albumsQ.isFetchingNextPage,
    tab === "albums"
  );

  useLoadMoreOnIntersect(
    artistsSentinelRef,
    artistsQ.fetchNextPage,
    Boolean(artistsQ.hasNextPage),
    artistsQ.isFetchingNextPage,
    tab === "artists"
  );

  useEffect(() => {
    const err = albumsQ.error ?? artistsQ.error;
    if (err) toast((err as Error).message);
  }, [albumsQ.error, artistsQ.error, toast]);

  const albumsInitialLoading = albumsQ.isPending && albums.length === 0;
  const artistsInitialLoading = artistsQ.isPending && artists.length === 0;

  return (
    <div className="layout-page">
      <PageHeader title="Library" subtitle="Albums & artists on this Pi" />
      <div className="mb-6 flex items-center gap-3">
        <div className="flex shrink-0 rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-1">
          <button
            type="button"
            onClick={() => setTab("albums")}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition",
              tab === "albums"
                ? "bg-white/[0.08] text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
            )}
            aria-label="Show albums"
          >
            <DiscIcon size={20} weight={tab === "albums" ? "fill" : "regular"} />
          </button>
          <button
            type="button"
            onClick={() => setTab("artists")}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition",
              tab === "artists"
                ? "bg-white/[0.08] text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300"
            )}
            aria-label="Show artists"
          >
            <UsersThreeIcon size={20} weight={tab === "artists" ? "fill" : "regular"} />
          </button>
        </div>
        <label className="flex min-h-[3rem] min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/60 px-4 py-3 shadow-inner ring-1 ring-black/20 focus-within:border-violet-500/40 focus-within:ring-violet-500/20">
          <MagnifyingGlassIcon className="shrink-0 text-zinc-500" size={22} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search albums, artists..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
        </label>
      </div>

      {tab === "albums" ? (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {albumsInitialLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <li
                    key={i}
                    className="aspect-square animate-pulse rounded-2xl bg-zinc-800/80"
                  />
                ))
              : albums.map((a) => (
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
                              setArtworkErrors((prev) => ({
                                ...prev,
                                [a.id]: true,
                              }))
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
          {!albumsInitialLoading && albumsQ.hasNextPage ? (
            <div
              ref={albumsSentinelRef}
              className="col-span-full mt-4 flex min-h-10 items-center justify-center py-2 text-xs text-zinc-500"
              aria-hidden
            >
              {albumsQ.isFetchingNextPage ? "Loading more…" : "\u00a0"}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <ul className="space-y-2">
            {artistsInitialLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <li key={i} className="h-16 animate-pulse rounded-2xl bg-zinc-800/80" />
                ))
              : artists.map((ar) => (
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
          {!artistsInitialLoading && artistsQ.hasNextPage ? (
            <div
              ref={artistsSentinelRef}
              className="mt-4 flex min-h-10 items-center justify-center py-2 text-xs text-zinc-500"
              aria-hidden
            >
              {artistsQ.isFetchingNextPage ? "Loading more…" : "\u00a0"}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
