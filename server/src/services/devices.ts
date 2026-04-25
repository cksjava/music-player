import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AudioDevice {
  id: string;
  name: string;
}

export async function listMpvAudioDevices(): Promise<AudioDevice[]> {
  try {
    const { stderr } = await execFileAsync("mpv", [
      "--no-config",
      "--audio-device=help",
    ]);
    return parseMpvAudioDeviceHelp(stderr || "");
  } catch (e) {
    const err = e as { stderr?: string };
    const text = err.stderr ?? String(e);
    return parseMpvAudioDeviceHelp(text);
  }
}

function parseMpvAudioDeviceHelp(text: string): AudioDevice[] {
  const lines = text.split(/\r?\n/);
  const out: AudioDevice[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*['"]([^'"]+)['"]\s*(.*)$/);
    if (m) {
      const id = m[1].trim();
      const rest = m[2].trim();
      if (id && id !== "auto") {
        out.push({ id, name: rest || id });
      }
    }
  }
  if (!out.some((d) => d.id === "auto")) {
    out.unshift({ id: "auto", name: "Automatic (mpv default)" });
  }
  return out;
}
