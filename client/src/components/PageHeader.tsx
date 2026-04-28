import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { CaretLeft } from "@phosphor-icons/react";
import { BlitzLogo } from "./BlitzLogo";
import { cn } from "../lib/cn";

export function PageHeader(props: {
  title?: string;
  subtitle?: string;
  backTo?: string;
  right?: ReactNode;
  className?: string;
}): ReactElement {
  const titleText = props.title?.trim() ?? "";
  const showTitleBlock = Boolean(titleText || props.subtitle);
  const showRightColumn = showTitleBlock || props.right != null;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 -mx-4 mb-4 border-b border-white/[0.06] bg-zinc-950/80 px-4 pb-3 pt-1 backdrop-blur-xl sm:-mx-6 sm:px-6",
        props.className
      )}
    >
      <div className="mx-auto flex w-full layout-max items-start justify-between gap-3">
        <div className="flex shrink-0 items-start gap-2">
          <BlitzLogo size="header" className="shrink-0 pt-0.5" />
          {props.backTo ? (
            <Link
              to={props.backTo}
              className="mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/5 hover:text-white sm:mt-2 sm:h-12 sm:w-12"
              aria-label="Back"
            >
              <CaretLeft size={24} />
            </Link>
          ) : null}
        </div>
        {showRightColumn ? (
          <div className="flex min-w-0 flex-1 items-start justify-end gap-3">
            {showTitleBlock ? (
              <div className="min-w-0 flex-1 text-right">
                {titleText ? (
                  <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
                    {titleText}
                  </h1>
                ) : null}
                {props.subtitle ? (
                  <p
                    className={cn(
                      "truncate text-sm text-zinc-500",
                      titleText ? "mt-0.5" : ""
                    )}
                  >
                    {props.subtitle}
                  </p>
                ) : null}
              </div>
            ) : null}
            {props.right ? <div className="shrink-0 pt-1">{props.right}</div> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
