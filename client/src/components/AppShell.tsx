import type { ReactElement } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { cn } from "../lib/cn";
import { BottomNav } from "./BottomNav";
import { MiniPlayer } from "./MiniPlayer";

export function AppShell(): ReactElement {
  const { pathname } = useLocation();
  const mainPb =
    pathname === "/now"
      ? "pb-[calc(4rem+max(env(safe-area-inset-bottom),0px))]"
      : "pb-[calc(10.5rem+max(env(safe-area-inset-bottom),0px))]";

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950">
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-90"
        aria-hidden
      >
        <div className="absolute -left-32 top-0 h-80 w-80 rounded-full bg-violet-600/20 blur-[100px]" />
        <div className="absolute -right-24 top-40 h-72 w-72 rounded-full bg-fuchsia-600/15 blur-[90px]" />
        <div className="absolute bottom-20 left-1/3 h-64 w-64 rounded-full bg-indigo-600/10 blur-[80px]" />
      </div>
      <main
        className={cn(
          "flex-1 pt-[max(0.75rem,env(safe-area-inset-top))]",
          mainPb
        )}
      >
        <Outlet />
      </main>
      <MiniPlayer />
      <BottomNav />
    </div>
  );
}
