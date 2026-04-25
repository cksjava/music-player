import type { ReactElement } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

type Tone = "default" | "danger";

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  tone?: Tone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactElement | null {
  const {
    open,
    title,
    message,
    confirmLabel,
    tone = "default",
    busy = false,
    onConfirm,
    onCancel,
  } = props;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="absolute inset-0 mx-auto flex h-full w-full max-w-lg items-center px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full rounded-2xl border border-white/[0.08] bg-zinc-950 p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-200">{title}</h3>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl p-2 text-zinc-400 transition hover:bg-white/5 hover:text-white"
              aria-label="Close confirmation dialog"
            >
              <X size={18} />
            </button>
          </div>
          <p className="mb-4 text-sm text-zinc-400">{message}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-white/[0.1] bg-zinc-800/70 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-40",
                tone === "danger"
                  ? "bg-red-600 hover:bg-red-500"
                  : "bg-violet-600 hover:bg-violet-500"
              )}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
