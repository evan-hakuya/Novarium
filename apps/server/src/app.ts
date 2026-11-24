import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Db } from "./db";
import type { StorageProvider } from "./storage/types";

export type Runtime = "cloudflare" | "node";

export interface AppDeps {
  runtime: Runtime;
  db: Db;
  storage: StorageProvider;
}

type Env = { Variables: { deps: AppDeps } };

// 两个部署目标共用的 API。平台相关的依赖由入口文件注入。
export function createApi(getDeps: (c: { env: unknown }) => AppDeps) {
  const api = new Hono<Env>().basePath("/api");

  api.use(async (c, next) => {
    c.set("deps", getDeps(c));
    await next();
  });

  api.get("/health", async (c) => {
    const { runtime, db, storage } = c.get("deps");
    const checks = {
      db: await check(async () => {
        await db.run(sql`select 1`);
      }),
      storage: await check(async () => {
        await storage.exists("health-check");
      }),
    };
    const ok = checks.db === "ok" && checks.storage === "ok";
    return c.json({ ok, runtime, checks }, ok ? 200 : 503);
  });

  api.notFound((c) => c.json({ error: "not_found" }, 404));

  return api;
}

async function check(fn: () => Promise<void>): Promise<"ok" | "error"> {
  try {
    await fn();
    return "ok";
  } catch (error) {
    console.error(JSON.stringify({ message: "health check failed", error: String(error) }));
    return "error";
  }
}
