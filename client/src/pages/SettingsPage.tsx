import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Broom,
  ArrowsClockwise,
  DownloadSimple,
  FolderOpen,
  HardDrives,
  Palette,
  CaretUp,
  Power,
  PauseCircle,
  Plus,
  Moon,
  SpeakerHigh,
  Sun,
  WarningCircle,
  Trash,
  X,
  Scroll,
} from "@phosphor-icons/react";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";
import { useTheme } from "../context/ThemeContext";
import { cn } from "../lib/cn";

type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  action: () => void;
} | null;

const UPDATE_TOTAL_STEPS = 4;

function getFriendlyUpdateProgress(
  update: {
    status: "idle" | "running" | "ok" | "error";
    step: string | null;
    message: string | null;
  } | null | undefined
): { current: number; label: string } {
  if (!update || update.status === "idle") {
    return { current: 0, label: "Ready to update" };
  }
  if (update.status === "ok") {
    return { current: UPDATE_TOTAL_STEPS, label: "Update complete" };
  }

  const stepToProgress: Record<string, number> = {
    initializing: 1,
    "stop-playback": 1,
    "git-pull": 2,
    "npm-ci": 3,
    "toolcheck-tsc": 3,
    "npm-build": 4,
    "manual-restart-required": 4,
    done: 4,
  };
  const current = Math.min(
    UPDATE_TOTAL_STEPS,
    Math.max(1, stepToProgress[update.step ?? ""] ?? 1)
  );

  if (update.status === "error") {
    return { current, label: "Update failed (check logs)" };
  }
  return { current, label: "Updating app..." };
}

export function SettingsPage(): ReactElement {
  const toast = useToast();
  const { theme, mode, setTheme, setMode, themeOptions } = useTheme();
  const qc = useQueryClient();
  const { data: playerData } = usePlayerState();
  const { setDevice, stop } = usePlayerActions();

  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [showUpdateLog, setShowUpdateLog] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPath, setPickerPath] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

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

  const updateLogQ = useQuery({
    queryKey: ["update-process-log"],
    queryFn: () => musicApi.updateProcessLog(),
    enabled: showUpdateLog,
  });

  const pickerQ = useQuery({
    queryKey: ["fs-directories", pickerPath],
    queryFn: () => musicApi.browseDirectories(pickerPath || undefined),
    enabled: showPicker,
  });

  const updateStatusQ = useQuery({
    queryKey: ["update-status"],
    queryFn: () => musicApi.updateStatus(),
    refetchInterval: 2_000,
  });

  useEffect(() => {
    const e =
      sourcesQ.error ??
      devicesQ.error ??
      logsQ.error ??
      pickerQ.error ??
      updateStatusQ.error ??
      updateLogQ.error;
    if (e) toast((e as Error).message);
  }, [
    sourcesQ.error,
    devicesQ.error,
    logsQ.error,
    pickerQ.error,
    updateStatusQ.error,
    updateLogQ.error,
    toast,
  ]);

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

  const shutdownDevice = useMutation({
    mutationFn: () => musicApi.shutdownDevice(),
    onSuccess: () => {
      toast("Shutdown requested. The Raspberry Pi will power off shortly.", "info");
    },
    onError: (err: Error) => toast(err.message),
  });

  const restartApp = useMutation({
    mutationFn: () => musicApi.restartApp(),
    onSuccess: () => {
      toast("App restart requested. Wait a few seconds and refresh.", "info");
    },
    onError: (err: Error) => toast(err.message),
  });

  const updateApp = useMutation({
    mutationFn: () => musicApi.updateApp(),
    onSuccess: () => {
      toast("Update requested (git pull + build). Restart app after it completes.", "info");
      void qc.invalidateQueries({ queryKey: ["update-status"] });
    },
    onError: (err: Error) => toast(err.message),
  });

  const updateStatus = updateStatusQ.data?.update;
  const updateProgress = getFriendlyUpdateProgress(updateStatus);
  const updatePercent = Math.round((updateProgress.current / UPDATE_TOTAL_STEPS) * 100);
  const isUpdateIdle = !updateStatus || updateStatus.status === "idle";

  return (
    <div className="layout-page">
      <PageHeader
        title="System"
        subtitle="Library folders, output, and rescans"
      />

      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
          <Palette size={18} className="text-violet-400" />
          Appearance
        </h2>
        <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-4">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Theme
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {themeOptions.map((option) => {
                const active = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setTheme(option.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition",
                      active
                        ? "border-violet-500/50 bg-violet-500/15 text-white"
                        : "border-white/[0.08] bg-zinc-900/60 text-zinc-300 hover:border-violet-500/30 hover:text-white"
                    )}
                  >
                    <p className="text-sm font-semibold">{option.label}</p>
                    <p className="text-xs text-zinc-500">{option.fontLabel}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Mode
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("light")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
                  mode === "light"
                    ? "border-violet-500/50 bg-violet-500/15 text-white"
                    : "border-white/[0.08] bg-zinc-900/60 text-zinc-300 hover:border-violet-500/30 hover:text-white"
                )}
              >
                <Sun size={18} />
                Light
              </button>
              <button
                type="button"
                onClick={() => setMode("dark")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
                  mode === "dark"
                    ? "border-violet-500/50 bg-violet-500/15 text-white"
                    : "border-white/[0.08] bg-zinc-900/60 text-zinc-300 hover:border-violet-500/30 hover:text-white"
                )}
              >
                <Moon size={18} />
                Dark
              </button>
            </div>
          </div>
        </div>
      </section>

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
                    setPendingConfirm({
                      title: "Remove source",
                      message: "Remove this source and its indexed tracks?",
                      confirmLabel: "Remove",
                      tone: "danger",
                      action: () => removeSource.mutate(s.id),
                    });
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
        <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-2.5">
          <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() =>
              void stop()
                .then(() => toast("Playback stopped", "info"))
                .catch((e) => toast((e as Error).message))
            }
            className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 px-3 py-2.5 text-left text-[13px] font-medium text-zinc-200 transition hover:border-violet-500/30 hover:text-white"
          >
            <PauseCircle size={18} className="text-violet-300" />
            <span>Stop Playback</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLogs(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 px-3 py-2.5 text-left text-[13px] font-medium text-zinc-200 transition hover:border-rose-500/30 hover:text-white"
          >
            <WarningCircle size={18} className="text-rose-300" />
            <span>Error Logs</span>
          </button>
          <button
            type="button"
            onClick={() => setShowUpdateLog(true)}
            className="col-span-2 flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 px-3 py-2.5 text-left text-[13px] font-medium text-zinc-200 transition hover:border-indigo-500/30 hover:text-white"
          >
            <Scroll size={18} className="text-indigo-300" />
            <span>Update process log</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingConfirm({
                title: "Restart app",
                message: "Restart the music player service now?",
                confirmLabel: "Restart",
                action: () => restartApp.mutate(),
              });
            }}
            disabled={restartApp.isPending}
            className="flex w-full items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2.5 text-left text-[13px] font-medium text-sky-100 transition hover:bg-sky-500/15 disabled:opacity-50"
          >
            <ArrowsClockwise size={17} className="text-sky-300" />
            <span>Restart App</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingConfirm({
                title: "Update app",
                message:
                  "Run git pull, install dependencies, and build now? You can restart the app after update completes.",
                confirmLabel: "Update",
                action: () => updateApp.mutate(),
              });
            }}
            disabled={updateApp.isPending}
            className="flex w-full items-center gap-2 rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3 py-2.5 text-left text-[13px] font-medium text-indigo-100 transition hover:bg-indigo-500/15 disabled:opacity-50"
          >
            <DownloadSimple size={17} className="text-indigo-300" />
            <span>Update App</span>
          </button>
          <div className="col-span-2 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-[11px] text-indigo-100/90">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="font-semibold">{updateProgress.label}</p>
              {!isUpdateIdle ? (
                <p className="font-mono text-[11px] text-zinc-300">
                  Step {updateProgress.current}/{UPDATE_TOTAL_STEPS}
                </p>
              ) : null}
            </div>
            {!isUpdateIdle ? (
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800/80">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    updateStatus?.status === "error" ? "bg-rose-400" : "bg-indigo-400"
                  )}
                  style={{ width: `${updatePercent}%` }}
                />
              </div>
            ) : null}
            <p className={cn("mt-2 text-[11px]", isUpdateIdle ? "text-zinc-500" : "text-zinc-300")}>
              {isUpdateIdle
                ? "Click Update app to fetch latest changes and rebuild."
                : updateStatus?.status === "error"
                  ? "Could not finish update. Open error logs for details."
                  : updateStatus?.status === "ok"
                    ? (updateStatus?.message ?? "App is up to date.")
                    : "Update may take up to a minute on Raspberry Pi."}
            </p>
            {(updateStatus?.beforeCommit || updateStatus?.afterCommit) && (
              <p className="mt-1 font-mono text-[10px] text-zinc-400">
                {updateStatus.beforeCommit ?? "?"} {" -> "} {updateStatus.afterCommit ?? "?"}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setPendingConfirm({
                title: "Clean library",
                message: "Clear indexed tracks, albums, artists and playlists while keeping sources?",
                confirmLabel: "Clean",
                action: () => resetLibrary.mutate(),
              });
            }}
            className="flex w-full items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-left text-[13px] font-medium text-amber-100 transition hover:bg-amber-500/15"
          >
            <Broom size={17} className="text-amber-300" />
            <span>Clean Library</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingConfirm({
                title: "Shut down device",
                message:
                  "Shut down this Raspberry Pi now? You will need to power it on manually.",
                confirmLabel: "Shut down",
                tone: "danger",
                action: () => shutdownDevice.mutate(),
              });
            }}
            disabled={shutdownDevice.isPending}
            className="flex w-full items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-left text-[13px] font-medium text-red-100 transition hover:bg-red-500/15 disabled:opacity-50"
          >
            <Power size={17} className="text-red-300" />
            <span>Shut Down</span>
          </button>
          </div>
        </div>
      </section>

      {showLogs ? (
        <div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
          onClick={() => setShowLogs(false)}
        >
          <div
            className="absolute inset-0 mx-auto flex h-full w-full layout-max flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
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

      {showUpdateLog ? (
        <div
          className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm"
          onClick={() => setShowUpdateLog(false)}
        >
          <div
            className="absolute inset-0 mx-auto flex h-full w-full layout-max flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-zinc-300">
                <Scroll size={18} className="text-indigo-400" />
                Update process log
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void qc.invalidateQueries({ queryKey: ["update-process-log"] })}
                  disabled={updateLogQ.isFetching}
                  className="rounded-lg border border-white/[0.1] bg-zinc-800/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-300 transition hover:text-white disabled:opacity-40"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowUpdateLog(false)}
                  className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white"
                  aria-label="Close update log"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <p className="mb-2 break-all font-mono text-[10px] text-zinc-500">
              {updateLogQ.data?.path ?? "…"}
            </p>
            {updateLogQ.data?.truncated ? (
              <p className="mb-2 text-[11px] text-amber-200/90">
                Log is large; only the most recent portion is shown.
              </p>
            ) : null}
            {updateLogQ.isLoading ? (
              <div className="h-28 animate-pulse rounded-xl bg-zinc-800/70" />
            ) : updateLogQ.data?.missing ? (
              <p className="rounded-xl bg-black/20 px-3 py-6 text-center text-sm text-zinc-500">
                No update log yet. Run &quot;Update app&quot; to create{" "}
                <span className="font-mono text-zinc-400">update-process.log</span>.
              </p>
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                {updateLogQ.data?.content ?? ""}
              </pre>
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
            className="absolute inset-0 mx-auto flex h-full w-full layout-max flex-col border-x border-white/[0.08] bg-zinc-950 p-4 shadow-2xl"
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

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Confirm"}
        tone={pendingConfirm?.tone ?? "default"}
        busy={
          addSource.isPending ||
          scan.isPending ||
          toggleSource.isPending ||
          removeSource.isPending ||
          resetLibrary.isPending ||
          shutdownDevice.isPending ||
          restartApp.isPending ||
          updateApp.isPending
        }
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          pendingConfirm?.action();
          setPendingConfirm(null);
        }}
      />
    </div>
  );
}
