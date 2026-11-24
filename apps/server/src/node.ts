import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApi, type AppDeps } from "./app";
import * as schema from "./db/schema";
import { createFsStorage } from "./storage/fs";

// Node.js 入口（Docker 自部署）。数据全部放在 DATA_DIR 中。
const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const webDir = resolve(process.env.WEB_DIR ?? join(here, "../../web/dist"));
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? join(here, "../migrations"));
const port = Number(process.env.PORT ?? 8080);

mkdirSync(dataDir, { recursive: true });
const sqlite = new Database(join(dataDir, "novarium.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });
migrate(db, { migrationsFolder: migrationsDir });

const deps: AppDeps = {
  runtime: "node",
  db,
  storage: createFsStorage(join(dataDir, "books")),
  ownerPassword: process.env.OWNER_PASSWORD || undefined,
};
if (!deps.ownerPassword) {
  console.warn(JSON.stringify({ message: "OWNER_PASSWORD is not set; owner login is disabled" }));
}

const app = new Hono();
app.route("/", createApi(() => deps));
// 未匹配的 API 路径返回 404，不落到下面的 SPA 回退。
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
if (existsSync(webDir)) {
  app.use("*", serveStatic({ root: webDir }));
  // SPA：未命中的非 API 路径都返回 index.html。
  app.get("*", serveStatic({ root: webDir, path: "index.html" }));
} else {
  console.warn(JSON.stringify({ message: "web assets not found", webDir }));
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(JSON.stringify({ message: "novarium listening", port: info.port, dataDir }));
});
