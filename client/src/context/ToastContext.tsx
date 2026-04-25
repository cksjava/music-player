import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "../lib/cn";

type Toast = { id: number; message: string; kind: "error" | "info" };

const ToastCtx = createContext<(msg: string, kind?: "error" | "info") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, kind: "error" | "info" = "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5200);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-stretch gap-2 p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:items-end"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl",
              t.kind === "error"
                ? "border-red-500/25 bg-red-950/90 text-red-50"
                : "border-zinc-700/80 bg-zinc-900/95 text-zinc-100"
            )}
          >
            <p className="min-w-0 flex-1 text-sm leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="shrink-0 rounded-lg p-1 text-current opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size={20} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): (msg: string, kind?: "error" | "info") => void {
  return useContext(ToastCtx);
}
