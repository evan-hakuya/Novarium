import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { createAiClient } from "./ai";
import { createApi, type AppDeps } from "./app";
import { cleanupStaleUploads, STALE_UPLOAD_MS } from "./cleanup";
import * as schema from "./db/schema";
import { createFsStorage } from "./storage/fs";

// Node.js 入口（Docker 自部署）。数据全部放在 DATA_DIR 中。
const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(process.env.DATA_DIR ?? "./data");
const webDir = resolve(process.env.WEB_DIR ?? join(here, "../../web/dist"));
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? join(here, "../migrations"));
const port = Number(process.env.PORT ?? 8080);
// 只有放在反向代理后面时才设置：此时连接地址是代理的地址，来源 IP 取 X-Forwarded-For。
const trustProxy = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? "");

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
  // 设置 WORKERS_AI_ACCOUNT_ID 与 WORKERS_AI_TOKEN 后，经 REST 接口调用 Workers AI。
  ai: createAiClient({ accountId: process.env.WORKERS_AI_ACCOUNT_ID, token: process.env.WORKERS_AI_TOKEN }),
  ownerPassword: process.env.OWNER_PASSWORD || undefined,
  // better-sqlite3 是同步驱动：在一个事务中依次执行。
  batch: async (queries) => {
    sqlite.transaction(() => {
      for (const query of queries) (query as unknown as { run(): unknown }).run();
    })();
  },
  // 取 X-Forwarded-For 最右边的地址：它由紧挨着本服务的代理写入，客户端无法伪造。
  clientIp: (c) =>
    (trustProxy && c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim()) || getConnInfo(c).remote.address,
};
if (!deps.ownerPassword) {
  console.warn(JSON.stringify({ message: "OWNER_PASSWORD is not set; owner login is disabled" }));
}

// 启动时清理一次，之后每小时清理一次导入失败留下的孤立文件。
const runCleanup = () =>
  cleanupStaleUploads(deps).catch((error) =>
    console.error(JSON.stringify({ message: "stale upload cleanup failed", error: String(error) })),
  );
void runCleanup();
setInterval(runCleanup, STALE_UPLOAD_MS).unref();

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
