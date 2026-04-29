import type { ReactElement, RefObject } from "react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { useLibrarySearch } from "../context/LibrarySearchContext";
import { useToast } from "../context/ToastContext";

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

export function LibrarySearchOverlay(): ReactElement | null {
  const toast = useToast();
  const { isOpen, close } = useLibrarySearch();
  const [q, setQ] = useState("");
  const [artworkErrors, setArtworkErrors] = useState<Record<string, boolean>>(
    {}
  );
  const dq = useDeferredValue(q.trim());
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQ("");
      setArtworkErrors({});
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const albumsQ = useInfiniteQuery({
    queryKey: ["albums", dq, "overlay"],
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
    enabled: isOpen,
  });

  const albums = useMemo(
    () => albumsQ.data?.pages.flatMap((p) => p.albums) ?? [],
    [albumsQ.data]
  );

  useLoadMoreOnIntersect(
    sentinelRef,
    albumsQ.fetchNextPage,
    Boolean(albumsQ.hasNextPage),
    albumsQ.isFetchingNextPage,
    isOpen
  );

  useEffect(() => {
    if (albumsQ.error) toast((albumsQ.error as Error).message);
  }, [albumsQ.error, toast]);

  const initialLoading = albumsQ.isPending && albums.length === 0;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-zinc-950/98 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Search albums"
    >
      <div className="shrink-0 border-b border-white/[0.06] pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="layout-chrome-inner mx-auto flex items-center gap-2 px-3 pb-3">
          <label className="flex min-h-[3rem] flex-1 items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/60 px-4 py-2 shadow-inner ring-1 ring-black/20 focus-within:border-violet-500/40 focus-within:ring-violet-500/20">
            <MagnifyingGlass className="shrink-0 text-zinc-500" size={22} />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search albums…"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            onClick={close}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-zinc-900/60 text-zinc-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close search"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      <div className="layout-chrome-inner mx-auto min-h-0 w-full flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+max(env(safe-area-inset-bottom),0px))] pt-4">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {initialLoading
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
                    onClick={close}
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
                      <p className="truncate text-sm font-semibold text-white">
                        {a.title}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {a.artistName ?? "Various"}{" "}
                        {a.trackCount != null ? `· ${a.trackCount} tracks` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
        </ul>
        {!initialLoading && albumsQ.hasNextPage ? (
          <div
            ref={sentinelRef}
            className="col-span-full mt-4 flex min-h-10 items-center justify-center py-2 text-xs text-zinc-500"
            aria-hidden
          >
            {albumsQ.isFetchingNextPage ? "Loading more…" : "\u00a0"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
