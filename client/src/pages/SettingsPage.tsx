import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Broom,
  ArrowsClockwise,
  FolderOpen,
  HardDrives,
  CaretUp,
  PauseCircle,
  Plus,
  SpeakerHigh,
  WarningCircle,
  Trash,
  X,
} from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";
import { cn } from "../lib/cn";

export function SettingsPage(): ReactElement {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: playerData } = usePlayerState();
  const { setDevice, stop } = usePlayerActions();

  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPath, setPickerPath] = useState("");

  const sourcesQ = useQuery({
    queryKey: ["sources"],
    queryFn: () => musicApi.sources(),
  });

  const devicesQ = useQuery({
    queryKey: ["devices"],
    queryFn: () => musicApi.devices(),
  });

  const logsQ = useQuery({
    queryKey: ["error-logs"],
    queryFn: () => musicApi.errorLogs(120),
    refetchInterval: 5_000,
  });

  const pickerQ = useQuery({
    queryKey: ["fs-directories", pickerPath],
    queryFn: () => musicApi.browseDirectories(pickerPath || undefined),
    enabled: showPicker,
  });

  useEffect(() => {
    const e = sourcesQ.error ?? devicesQ.error ?? logsQ.error ?? pickerQ.error;
    if (e) toast((e as Error).message);
  }, [sourcesQ.error, devicesQ.error, logsQ.error, pickerQ.error, toast]);

  const addSource = useMutation({
    mutationFn: () =>
      musicApi.addSource({
        path: path.trim(),
        label: label.trim() || undefined,
        kind: "folder",
      }),
    onSuccess: async () => {
      setPath("");
      setLabel("");
      await qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err: Error) => toast(err.message),
  });

  const pollScanJob = async (jobId: string): Promise<void> => {
    const started = Date.now();
    // Poll in background so scan requests return immediately.
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const { job: latest } = await musicApi.scanJob(jobId);
      if (latest.status === "done") {
        await qc.invalidateQueries({ queryKey: ["sources"] });
        await qc.invalidateQueries({ queryKey: ["albums"] });
        await qc.invalidateQueries({ queryKey: ["artists"] });
        await qc.invalidateQueries({ queryKey: ["tracks"] });
        const result = latest.result ?? { added: 0, updated: 0, removed: 0 };
        toast(
          `Indexed +${result.added} · updated ${result.updated} · removed ${result.removed}`,
          "info"
        );
        break;
      }
      if (latest.status === "error") {
        throw new Error(latest.error ?? "Scan failed");
      }
      if (Date.now() - started > 1000 * 60 * 20) {
        toast("Scan still running. You can continue using the app.", "info");
        break;
      }
    }
  };

  const scan = useMutation({
    mutationFn: (id: string) => musicApi.scanSource(id),
    onSuccess: ({ job, alreadyRunning }) => {
      if (alreadyRunning) {
        toast("Scan already running for this source. Tracking progress...", "info");
      } else {
        toast("Scan queued. Indexing continues in background.", "info");
      }
      void pollScanJob(job.id).catch((err: Error) => toast(err.message));
    },
    onError: (err: Error) => toast(err.message),
  });

  const toggleSource = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      musicApi.patchSource(id, { enabled }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err: Error) => toast(err.message),
  });

  const removeSource = useMutation({
    mutationFn: (id: string) => musicApi.deleteSource(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err: Error) => toast(err.message),
  });

  const devices = devicesQ.data?.devices ?? [];
  const currentDev = playerData?.state.audioDevice ?? "";

  const resetLibrary = useMutation({
    mutationFn: () =>
      musicApi.resetLibrary({ stopPlayback: true }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      toast("Library cleared. Sources kept for quick re-scan.", "info");
    },
    onError: (err: Error) => toast(err.message),
  });

  const clearLogs = useMutation({
    mutationFn: () => musicApi.clearErrorLogs(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["error-logs"] });
      toast("Error logs cleared", "info");
    },
    onError: (err: Error) => toast(err.message),
  });

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      <PageHeader
        title="System"
        subtitle="Library folders, output, and rescans"
      />

      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          <HardDrives size={18} className="text-violet-400" />
          Audio output
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-zinc-400">
          Pick the IQAudio DAC or another ALSA device on the Pi. On macOS you will see
          CoreAudio devices from mpv.
        </p>
        <div className="space-y-2">
          {devicesQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-zinc-800/80" />
          ) : (
            devices.map((d) => {
              const active =
                d.id === currentDev ||
                (!currentDev && d.id === "auto") ||
                (currentDev === "" && d.id === "auto");
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() =>
                    void setDevice(d.id === "auto" ? null : d.id).catch((e) =>
                      toast((e as Error).message)
                    )
                  }
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                    active
                      ? "border-violet-500/50 bg-violet-500/10 text-white"
                      : "border-white/[0.06] bg-zinc-900/50 text-zinc-300 hover:border-white/10"
                  )}
                >
                  <SpeakerHigh
                    size={22}
                    weight={active ? "fill" : "regular"}
                    className={cn(active ? "text-violet-400" : "text-zinc-500")}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.name || d.id}</p>
                    <p className="truncate font-mono text-[11px] text-zinc-500">{d.id}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          <FolderOpen size={18} className="text-fuchsia-400" />
          Music folders
        </h2>
        <form
          className="mb-4 space-y-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!path.trim()) return;
            addSource.mutate();
          }}
        >
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/mnt/ssd/Music or full path"
            className="w-full rounded-xl border border-white/[0.08] bg-zinc-950/60 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
          />
          <button
            type="button"
            onClick={() => {
              setPickerPath(path.trim());
              setShowPicker(true);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-900/70 py-2.5 text-sm font-semibold text-zinc-200 transition hover:border-violet-500/30 hover:text-white"
          >
            <FolderOpen size={18} />
            Browse folders
          </button>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full rounded-xl border border-white/[0.08] bg-zinc-950/60 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-500/40"
          />
          <button
            type="submit"
            disabled={addSource.isPending || !path.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-bold text-white shadow-lg shadow-violet-900/25 transition hover:opacity-95 disabled:opacity-40"
          >
            <Plus size={20} weight="bold" />
            Add folder source
          </button>
        </form>

        <ul className="space-y-2">
          {(sourcesQ.data?.sources ?? []).map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-zinc-900/50 p-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{s.label}</p>
                <p className="truncate font-mono text-xs text-zinc-500">{s.path}</p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  {s.lastScanAt
                    ? `Last scan ${new Date(s.lastScanAt).toLocaleString()}`
                    : "Never scanned"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => scan.mutate(s.id)}
                  disabled={!s.enabled || scan.isPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-violet-500/30 hover:text-white disabled:opacity-40"
                >
                  <ArrowsClockwise
                    size={18}
                    className={scan.isPending ? "animate-spin" : ""}
                  />
                  Scan
                </button>
                <button
                  type="button"
                  onClick={() =>
                    toggleSource.mutate({ id: s.id, enabled: !s.enabled })
                  }
                  className={cn(
                    "rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wide",
                    s.enabled
                      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                      : "bg-zinc-800 text-zinc-500 ring-1 ring-white/5"
                  )}
                >
                  {s.enabled ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Remove this source and its indexed tracks?")) {
                      removeSource.mutate(s.id);
                    }
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-red-500/20 p-2 text-red-400 hover:bg-red-500/10"
                  aria-label="Delete source"
                >
                  <Trash size={20} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          <Broom size={18} className="text-amber-400" />
          Maintenance
        </h2>
        <div className="space-y-2 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3">
          <button
            type="button"
            onClick={() =>
              void stop()
                .then(() => toast("Playback stopped", "info"))
                .catch((e) => toast((e as Error).message))
            }
            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-violet-500/30 hover:text-white"
          >
            <PauseCircle size={22} className="text-violet-300" />
            <span className="font-semibold">Stop playback now</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLogs(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-4 py-3 text-left text-sm text-zinc-200 transition hover:border-rose-500/30 hover:text-white"
          >
            <WarningCircle size={22} className="text-rose-300" />
            <span className="font-semibold">Show error logs</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (confirm("Clear indexed tracks/albums/artists/playlists and keep sources?")) {
                resetLibrary.mutate();
              }
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-100 transition hover:bg-amber-500/15"
          >
            <Broom size={20} className="text-amber-300" />
            <span className="font-semibold">Clean library (keep source folders)</span>
          </button>
        </div>
      </section>

      {showLogs ? (
        <div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
          onClick={() => setShowLogs(false)}
        >
          <div
            className="absolute inset-0 mx-auto flex h-full w-full max-w-2xl flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-300">
                <WarningCircle size={18} className="text-rose-400" />
                Error logs
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => clearLogs.mutate()}
                  disabled={clearLogs.isPending}
                  className="rounded-lg border border-white/[0.1] bg-zinc-800/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-300 transition hover:text-white disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowLogs(false)}
                  className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                  aria-label="Close error logs"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              Playback, CD and runtime failures are listed here.
            </p>
            {logsQ.isLoading ? (
              <div className="h-28 animate-pulse rounded-xl bg-zinc-800/70" />
            ) : (logsQ.data?.logs ?? []).length === 0 ? (
              <p className="rounded-xl bg-black/20 px-3 py-6 text-center text-sm text-zinc-500">
                No errors logged.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {(logsQ.data?.logs ?? []).map((l) => (
                  <li
                    key={l.id}
                    className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5"
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="rounded-md bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-300">
                        {l.scope}
                      </span>
                      <span className="text-[11px] text-zinc-500">
                        {new Date(l.time).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-zinc-100">{l.message}</p>
                    {l.detail ? (
                      <p className="mt-1 break-words font-mono text-xs text-zinc-400">
                        {l.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {showPicker ? (
        <div
          className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm"
          onClick={() => setShowPicker(false)}
        >
          <div
            className="absolute inset-0 mx-auto flex h-full w-full max-w-2xl flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-300">
                <FolderOpen size={18} className="text-fuchsia-400" />
                Select source folder
              </h2>
              <button
                type="button"
                onClick={() => setShowPicker(false)}
                className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                aria-label="Close folder picker"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-3 rounded-xl border border-white/[0.08] bg-zinc-900/60 px-3 py-2">
              <p className="truncate font-mono text-xs text-zinc-300">
                {pickerQ.data?.current ?? "Loading..."}
              </p>
            </div>

            <div className="mb-3 flex gap-2">
              <button
                type="button"
                disabled={!pickerQ.data?.parent}
                onClick={() => {
                  if (pickerQ.data?.parent) setPickerPath(pickerQ.data.parent);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.1] bg-zinc-800/70 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:text-white disabled:opacity-40"
              >
                <CaretUp size={14} />
                Up
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pickerQ.data?.current) {
                    setPath(pickerQ.data.current);
                    if (!label.trim()) {
                      const parts = pickerQ.data.current.split("/").filter(Boolean);
                      setLabel(parts[parts.length - 1] ?? "");
                    }
                    setShowPicker(false);
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-500/35 bg-fuchsia-500/15 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/25"
              >
                Use this folder
              </button>
            </div>

            {pickerQ.isLoading ? (
              <div className="h-28 animate-pulse rounded-xl bg-zinc-800/70" />
            ) : (
              <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/20 p-2">
                {(pickerQ.data?.directories ?? []).map((d) => (
                  <li key={d.path}>
                    <button
                      type="button"
                      onClick={() => setPickerPath(d.path)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-zinc-300 transition hover:bg-white/5 hover:text-white"
                    >
                      <FolderOpen size={16} className="text-fuchsia-400" />
                      <span className="truncate">{d.name}</span>
                    </button>
                  </li>
                ))}
                {(pickerQ.data?.directories.length ?? 0) === 0 ? (
                  <li className="px-2 py-6 text-center text-sm text-zinc-500">
                    No subdirectories found.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
