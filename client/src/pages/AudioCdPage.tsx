import type { ReactElement } from "react";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DiscIcon, EjectSimpleIcon, StopIcon, PlayIcon } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { musicApi } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { formatMs } from "../lib/format";
import { usePlayerActions, usePlayerState } from "../hooks/usePlayer";
import { useToast } from "../context/ToastContext";
import { playerQueryKey } from "../hooks/usePlayer";

export function AudioCdPage(): ReactElement {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const actions = usePlayerActions();
  const { data: playerData } = usePlayerState();
  const state = playerData?.state;
  const isCdPlaying = Boolean(state?.trackId?.startsWith("cd:")) && state?.status !== "stopped";

  const cdQ = useQuery({
    queryKey: ["audio-cd"],
    queryFn: () => musicApi.cdInfo(),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (cdQ.error) toast((cdQ.error as Error).message);
  }, [cdQ.error, toast]);

  const onPlayStop = async (): Promise<void> => {
    try {
      if (isCdPlaying) {
        await actions.stopCd();
      } else {
        await actions.playCd(1);
        await qc.invalidateQueries({ queryKey: ["audio-cd"] });
        await qc.invalidateQueries({ queryKey: playerQueryKey });
        navigate("/now");
      }
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const onEject = async (): Promise<void> => {
    try {
      await musicApi.cdEject();
      await qc.invalidateQueries({ queryKey: ["audio-cd"] });
      await qc.invalidateQueries({ queryKey: playerQueryKey });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const tracks = cdQ.data?.tracks ?? [];

  return (
    <div className="layout-page">
      <PageHeader title="Audio CD" subtitle="Play or eject the disc in your drive" />
      <div className="mb-5 rounded-2xl border border-white/[0.06] bg-zinc-900/55 p-4">
        <div className="mb-4 flex items-center gap-3 text-zinc-300">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
            <DiscIcon size={24} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {cdQ.data?.present ? "Audio CD detected" : "No audio CD detected"}
            </p>
            <p className="text-xs text-zinc-500">
              Device: <span className="font-mono">{cdQ.data?.device ?? "/dev/sr0"}</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void onPlayStop()}
            disabled={actions.pending || !cdQ.data?.present}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isCdPlaying ? <StopIcon size={20} weight="fill" /> : <PlayIcon size={20} weight="fill" />}
            {isCdPlaying ? "Stop" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => void onEject()}
            disabled={actions.pending || !cdQ.data?.present}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-zinc-800/70 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-700/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <EjectSimpleIcon size={20} weight="fill" />
            Eject
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Track List ({tracks.length})
        </h2>
        {cdQ.isLoading ? (
          <p className="rounded-xl bg-black/20 px-3 py-6 text-center text-sm text-zinc-500">
            Reading disc…
          </p>
        ) : tracks.length === 0 ? (
          <p className="rounded-xl bg-black/20 px-3 py-6 text-center text-sm text-zinc-500">
            Insert an audio CD to see tracks.
          </p>
        ) : (
          <ul className="space-y-1">
            {tracks.map((t) => (
              <li
                key={t.trackNumber}
                className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-black/15 px-3 py-2.5"
              >
                <span className="w-8 text-xs font-semibold tabular-nums text-zinc-500">
                  {String(t.trackNumber).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{t.title}</span>
                <span className="text-xs tabular-nums text-zinc-500">{formatMs(t.durationMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
