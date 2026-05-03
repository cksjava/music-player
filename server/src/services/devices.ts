import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AudioDevice {
  id: string;
  name: string;
}

export async function listMpvAudioDevices(): Promise<AudioDevice[]> {
  try {
    const { stdout, stderr } = await execFileAsync("mpv", [
      "--no-config",
      "--audio-device=help",
    ]);
    // mpv prints the device list on stdout on Linux/macOS; stderr may only contain warnings.
    return parseMpvAudioDeviceHelp(`${stdout ?? ""}\n${stderr ?? ""}`);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const text = `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`;
    return parseMpvAudioDeviceHelp(text);
  }
}

function parseMpvAudioDeviceHelp(text: string): AudioDevice[] {
  const lines = text.split(/\r?\n/);
  const out: AudioDevice[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^\s*['"]([^'"]+)['"]\s*(.*)$/);
    if (m) {
      const id = m[1].trim();
      const rest = m[2].trim();
      if (id && id !== "auto" && !seen.has(id)) {
        seen.add(id);
        out.push({ id, name: rest.replace(/^\((.*)\)$/, "$1").trim() || id });
      }
    }
  }
  if (!seen.has("auto")) {
    out.unshift({ id: "auto", name: "Automatic (mpv default)" });
  }
  return out;
}

/**
 * mpv lists many ALSA aliases per physical card (hw, plughw, surround…). Group by the
 * human-readable name and prefer plughw (sample-rate conversion) over raw hw when names match.
 */
export function dedupeAudioDevicesForUi(devices: AudioDevice[]): AudioDevice[] {
  const auto = devices.find((d) => d.id === "auto");
  const rest = devices.filter((d) => d.id !== "auto");
  const normName = (name: string): string =>
    name.replace(/\s+/g, " ").trim().toLowerCase();

  const groups = new Map<string, AudioDevice[]>();
  for (const d of rest) {
    const key = normName(d.name);
    const list = groups.get(key) ?? [];
    list.push(d);
    groups.set(key, list);
  }

  const rankId = (id: string): number => {
    if (/plughw/i.test(id)) return 0;
    if (/^alsa\/default$/i.test(id)) return 1;
    if (/^alsa\/dmix/i.test(id)) return 2;
    if (/^alsa\/surround/i.test(id)) return 3;
    if (/^alsa\/hw/i.test(id)) return 4;
    return 5;
  };

  const firstIdx = new Map<string, number>();
  rest.forEach((d, i) => {
    if (!firstIdx.has(d.id)) firstIdx.set(d.id, i);
  });

  const picked: AudioDevice[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      picked.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((a, b) => rankId(a.id) - rankId(b.id));
    picked.push(sorted[0]);
  }

  picked.sort((a, b) => (firstIdx.get(a.id) ?? 0) - (firstIdx.get(b.id) ?? 0));

  const out: AudioDevice[] = [];
  if (auto) out.push(auto);
  out.push(...picked);
  return out;
}
