import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";

export type MpvEvent = Record<string, unknown> & { event?: string };

export class MpvIpc extends EventEmitter {
  private socket: Socket | null = null;
  private proc: ChildProcess | null = null;
  private buffer = "";
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly socketPath: string) {
    super();
  }

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  async start(extraArgs: string[] = []): Promise<void> {
    await this.stop();
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }
    const args = [
      "--no-video",
      "--really-quiet",
      "--idle=yes",
      "--no-terminal",
      `--input-ipc-server=${this.socketPath}`,
      ...extraArgs,
    ];
    this.proc = spawn("mpv", args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    this.proc.stderr?.on("data", (d) =>
      this.emit("mpv-stderr", d.toString())
    );
    this.proc.on("error", (err) => this.emit("mpv-exit-error", err));
    this.proc.on("exit", (code) => {
      this.emit("mpv-exit", code);
      this.teardownSocket();
      this.proc = null;
    });
    await waitForFile(this.socketPath, 8000);
    await this.connectSocket();
    await this.command("observe_property", 1, "time-pos");
    await this.command("observe_property", 2, "duration");
    await this.command("observe_property", 3, "pause");
    await this.command("observe_property", 5, "eof-reached");
    await this.command("observe_property", 6, "metadata");
    await this.command("observe_property", 7, "volume");
    await this.command("observe_property", 8, "mute");
  }

  private async connectSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = createConnection(this.socketPath);
      this.socket = s;
      s.setEncoding("utf8");
      s.on("data", (chunk) => this.onData(chunk));
      s.on("error", reject);
      s.on("connect", () => resolve());
    });
  }

  private onData(chunk: string | Buffer): void {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: MpvEvent;
      try {
        msg = JSON.parse(line) as MpvEvent;
      } catch {
        continue;
      }
      if (typeof msg.request_id === "number" && this.pending.has(msg.request_id)) {
        const p = this.pending.get(msg.request_id)!;
        this.pending.delete(msg.request_id);
        const err = msg.error as string | undefined;
        if (err && err !== "success") {
          p.reject(new Error(err));
        } else {
          p.resolve(msg.data);
        }
      } else if (msg.event) {
        this.emit("event", msg);
      }
    }
  }

  async command(...args: unknown[]): Promise<unknown> {
    if (!this.socket) throw new Error("mpv socket not connected");
    const id = ++this.requestId;
    const payload = JSON.stringify({ command: args, request_id: id }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async getProp(name: string): Promise<unknown> {
    return this.command("get_property", name);
  }

  async setProp(name: string, value: unknown): Promise<unknown> {
    return this.command("set_property", name, value);
  }

  private teardownSocket(): void {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("mpv disconnected"));
    }
    this.pending.clear();
  }

  async stop(): Promise<void> {
    this.teardownSocket();
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
      await new Promise<void>((r) => setTimeout(r, 400));
      if (this.proc && this.proc.exitCode === null) {
        this.proc.kill("SIGKILL");
      }
    }
    this.proc = null;
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
    }
  }
}

function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (existsSync(path)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("mpv IPC socket did not appear in time"));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
