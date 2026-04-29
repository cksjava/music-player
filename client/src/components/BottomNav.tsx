import type { ReactElement } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Disc, GearSix, MagnifyingGlass, MusicNotes, Playlist } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { useLibrarySearch } from "../context/LibrarySearchContext";

const items = [
  { to: "/library", label: "Library", Icon: Disc },
  { to: "/playlists", label: "Playlists", Icon: Playlist },
  { to: "/cd", label: "CD", Icon: Disc },
  { to: "/now", label: "Now", Icon: MusicNotes },
  { to: "/settings", label: "System", Icon: GearSix },
] as const;

export function BottomNav(): ReactElement {
  const { pathname } = useLocation();
  const { open: openLibrarySearch } = useLibrarySearch();

  return (
    <nav
      className="safe-pb fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.06] bg-zinc-950/85 backdrop-blur-2xl"
      aria-label="Primary"
    >
      <div className="mx-auto flex layout-chrome-inner items-stretch justify-around px-1 pt-1">
        {pathname === "/library" ? (
          <button
            type="button"
            onClick={openLibrarySearch}
            className="flex min-h-[3.25rem] min-w-[3rem] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 transition-colors hover:text-zinc-300"
            aria-label="Search albums"
          >
            <MagnifyingGlass size={26} />
            <span>Search</span>
          </button>
        ) : null}
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex min-h-[3.25rem] min-w-[4rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                isActive
                  ? "text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={26}
                  weight={isActive ? "fill" : "regular"}
                  className={cn(isActive && "drop-shadow-[0_0_12px_rgba(167,139,250,0.45)]")}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
