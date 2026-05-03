import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AudioCdTrack {
  trackNumber: number;
  title: string;
  durationMs: number | null;
}

export interface AudioCdInfo {
  device: string;
  present: boolean;
  tracks: AudioCdTrack[];
}

/** Same default as CD TOC queries (`readAudioCdInfo`) so mpv opens the same drive as cdparanoia. */
export function resolvedCdRomDevice(): string {
  return process.env.CDROM_DEVICE?.trim() || "/dev/sr0";
}

/**
 * mpv protocol: `cdda://[device]` — optional drive path only. Track selection is via per-file
 * `start=#N` / `end=#N` (chapters), not path segments.
 */
export function cddaMpvBaseUrl(device = resolvedCdRomDevice()): string {
  const d = device.trim();
  if (!d) return "cdda://";
  return d.startsWith("/") ? `cdda://${d}` : `cdda://${d}`;
}

export async function readAudioCdInfo(device: string): Promise<AudioCdInfo> {
  try {
    const { stdout, stderr } = await execFileAsync("cdparanoia", ["-d", device, "-Q"]);
    const text = `${stdout}\n${stderr}`;
    const tracks = parseCdParanoiaToc(text);
    return {
      device,
      present: tracks.length > 0,
      tracks,
    };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const text = `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`;
    const tracks = parseCdParanoiaToc(text);
    if (tracks.length > 0) {
      return { device, present: true, tracks };
    }
    return { device, present: false, tracks: [] };
  }
}

export async function ejectAudioCd(device: string): Promise<void> {
  await execFileAsync("eject", [device]);
}

function parseCdParanoiaToc(text: string): AudioCdTrack[] {
  const out: AudioCdTrack[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\.\s+\d+\s+\[(\d+):(\d+)\.(\d+)\]/);
    if (!m) continue;
    const trackNumber = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ff = Number(m[4]);
    const durationMs = mm * 60_000 + ss * 1_000 + Math.round((ff / 75) * 1_000);
    out.push({
      trackNumber,
      title: `Track ${String(trackNumber).padStart(2, "0")}`,
      durationMs,
    });
  }
  return out;
}
