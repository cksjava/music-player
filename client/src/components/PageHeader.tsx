import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { CaretLeft } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

export function PageHeader(props: {
  title: string;
  subtitle?: string;
  backTo?: string;
  right?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 -mx-4 mb-4 border-b border-white/[0.06] bg-zinc-950/80 px-4 pb-3 pt-1 backdrop-blur-xl sm:-mx-6 sm:px-6",
        props.className
      )}
    >
      <div className="mx-auto flex max-w-2xl items-start gap-3">
        {props.backTo ? (
          <Link
            to={props.backTo}
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Back"
          >
            <CaretLeft size={22} />
          </Link>
        ) : (
          <span className="w-2 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
            {props.title}
          </h1>
          {props.subtitle ? (
            <p className="mt-0.5 truncate text-sm text-zinc-500">{props.subtitle}</p>
          ) : null}
        </div>
        {props.right ? <div className="shrink-0 pt-1">{props.right}</div> : null}
      </div>
    </header>
  );
}
