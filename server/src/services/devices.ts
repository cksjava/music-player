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
