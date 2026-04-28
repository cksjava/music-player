import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { Lightning } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

const SIZE_STYLES = {
  /** Page headers & Now Playing — same wordmark everywhere */
  header: {
    box: "h-14 w-14 sm:h-16 sm:w-16",
    icon: 32,
    text: "text-xl sm:text-2xl",
    sub: "text-[11px] font-medium leading-tight text-zinc-400 sm:text-xs sm:text-zinc-500",
    gap: "gap-2.5 sm:gap-3",
  },
} as const;

export type BlitzLogoProps = {
  className?: string;
  /** Defaults to header (same scale as Library and other screens). */
  size?: keyof typeof SIZE_STYLES;
  /** Destination when used as a link. Pass `null` for a non-interactive wordmark only. */
  to?: string | null;
};

export function BlitzLogo(props: BlitzLogoProps): ReactElement {
  const { className, to } = props;
  const sz = SIZE_STYLES[props.size ?? "header"];
  const href = to === undefined ? "/library" : to;

  const mark = (
    <>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg border border-violet-400/35 bg-gradient-to-br from-violet-500/25 to-fuchsia-600/15 shadow-inner shadow-black/20",
          sz.box
        )}
        aria-hidden
      >
        <Lightning
          size={sz.icon}
          weight="fill"
          className="text-violet-300 drop-shadow-[0_0_10px_rgba(167,139,250,0.35)]"
        />
      </span>
      <span className="flex min-w-0 flex-col justify-center font-['Poppins',sans-serif]">
        <span className={cn("font-bold leading-tight tracking-tight text-zinc-100", sz.text)}>Blitz</span>
        <span className={cn("mt-0.5", sz.sub)}>Music player</span>
      </span>
    </>
  );

  const rowClass = cn(
    "inline-flex items-center",
    sz.gap,
    href && "transition-opacity hover:opacity-90 active:opacity-80",
    className
  );

  if (href) {
    return (
      <Link
        to={href}
        className={cn(
          rowClass,
          "outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        )}
        aria-label="Blitz Music player — go to library"
      >
        {mark}
      </Link>
    );
  }

  return (
    <span className={rowClass} aria-label="Blitz Music player">
      {mark}
    </span>
  );
}
