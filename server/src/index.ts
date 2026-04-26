import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openDatabase } from "./db.js";
import { registerRoutes } from "./routes.js";
import { PlayerService } from "./services/player.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3847;
const defaultDataDir = join(__dirname, "..", "data");
const preferredDataDir = process.env.DATA_DIR?.trim() || defaultDataDir;
const db = (() => {
  try {
    return openDatabase(join(preferredDataDir, "library.db"));
  } catch (err) {
    if (preferredDataDir !== defaultDataDir) {
      console.warn(
        `[startup] Could not open DATA_DIR at "${preferredDataDir}". Falling back to "${defaultDataDir}".`,
        err
      );
      process.env.DATA_DIR = defaultDataDir;
      return openDatabase(join(defaultDataDir, "library.db"));
    }
    throw err;
  }
})();
const player = new PlayerService(db);

const app = express();
const appCommit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
})();
if (appCommit) process.env.APP_COMMIT = appCommit;
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  next();
});

registerRoutes(app, db, player);

const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, max-age=0");
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.sendFile(join(clientDist, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  console.log(`Music server listening on http://0.0.0.0:${PORT}`);
});

void player.ensureStarted().catch(() => {
  /* mpv may be missing in dev; player reports error state */
});

async function shutdown(): Promise<void> {
  await player.shutdown();
  server.close();
  db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
