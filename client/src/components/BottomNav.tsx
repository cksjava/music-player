import type { ReactElement } from "react";
import { NavLink } from "react-router-dom";
import { DiscIcon, GearSixIcon, MusicNotesIcon, PlaylistIcon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

const items = [
  { to: "/library", label: "Library", Icon: DiscIcon },
  { to: "/playlists", label: "Playlists", Icon: PlaylistIcon },
  { to: "/cd", label: "CD", Icon: DiscIcon },
  { to: "/now", label: "Now", Icon: MusicNotesIcon },
  { to: "/settings", label: "System", Icon: GearSixIcon },
] as const;

export function BottomNav(): ReactElement {
  return (
    <nav
      className="safe-pb fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.06] bg-zinc-950/85 backdrop-blur-2xl"
      aria-label="Primary"
    >
      <div className="mx-auto flex layout-chrome-inner items-stretch justify-around px-1 pt-1">
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
