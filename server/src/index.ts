import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { openDatabase } from "./db.js";
import { registerRoutes } from "./routes.js";
import { PlayerService } from "./services/player.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3847;
const dbPath = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, "library.db")
  : join(__dirname, "..", "data", "library.db");

const db = openDatabase(dbPath);
const player = new PlayerService(db);

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

registerRoutes(app, db, player);

const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
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
