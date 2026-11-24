import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSessionValue,
  isValidSession,
  requireOwner,
  setSessionCookie,
  verifyPassword,
} from "./auth";
import { createBookRoutes, type BatchQuery } from "./books";
import type { Db } from "./db";
import { createSourceRoutes, IMPORT_BASE, SOURCE_BASE } from "./source";
import type { StorageProvider } from "./storage/types";
import { createImportRoutes, createTokenRoutes, requireAccessToken } from "./tokens";

export type Runtime = "cloudflare" | "node";

export interface AppDeps {
  runtime: Runtime;
  db: Db;
  storage: StorageProvider;
  // 部署时设置的所有者密码；未设置时无法登录。
  ownerPassword: string | undefined;
  /** 原子地执行一组写入：全部成功或全部不生效。 */
  batch(queries: [BatchQuery, ...BatchQuery[]]): Promise<void>;
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

  api.get("/auth/session", async (c) => {
    const { ownerPassword } = c.get("deps");
    const authenticated = !!ownerPassword && (await isValidSession(ownerPassword, getCookie(c, SESSION_COOKIE)));
    return c.json({ authenticated, configured: !!ownerPassword });
  });

  api.post("/auth/login", async (c) => {
    const { ownerPassword } = c.get("deps");
    if (!ownerPassword) return c.json({ error: "owner_password_not_configured" }, 503);
    const body = await c.req.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!(await verifyPassword(ownerPassword, password))) {
      return c.json({ error: "invalid_password" }, 401);
    }
    setSessionCookie(c, await createSessionValue(ownerPassword));
    return c.json({ authenticated: true });
  });

  api.post("/auth/logout", (c) => {
    clearSessionCookie(c);
    return c.json({ authenticated: false });
  });

  // 所有者 API 都挂在 /api/admin 下。
  api.use("/admin/*", requireOwner<Env>((c) => c.get("deps").ownerPassword));
  api.route("/admin", createBookRoutes());
  api.route("/admin", createTokenRoutes());

  // 阅读客户端用的书源 API，凭访问令牌访问。
  const sourcePath = SOURCE_BASE.slice("/api".length);
  api.use(`${sourcePath}/*`, requireAccessToken<Env>());
  api.route(sourcePath, createSourceRoutes());
  api.route(IMPORT_BASE.slice("/api".length), createImportRoutes());

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
