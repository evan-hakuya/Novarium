import { Hono, type MiddlewareHandler } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import type { AppDeps } from "./app";
import { accessTokens } from "./db/schema";
import { buildBookSource } from "./source";

type Env = { Variables: { deps: AppDeps } };

// 访问令牌的明文形如 `nvr_<43 位 base64url>`，数据库只存它的 SHA-256。
const TOKEN_PREFIX = "nvr_";
/** 最近使用时间的写入间隔，避免每次读章节都写库。 */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return TOKEN_PREFIX + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// 所有者管理访问令牌。挂在 /api/admin 下，受 session 保护。
export function createTokenRoutes() {
  const app = new Hono<Env>();

  app.get("/tokens", async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select({
        id: accessTokens.id,
        name: accessTokens.name,
        createdAt: accessTokens.createdAt,
        lastUsedAt: accessTokens.lastUsedAt,
        revokedAt: accessTokens.revokedAt,
      })
      .from(accessTokens)
      // 同一毫秒创建的令牌按插入顺序排列。
      .orderBy(desc(accessTokens.createdAt), desc(sql`rowid`));
    return c.json({ tokens: rows });
  });

  // 明文令牌与书源 JSON 只在这里返回一次。
  app.post("/tokens", async (c) => {
    const { db } = c.get("deps");
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 50) return c.json({ error: "invalid_name" }, 400);
    const token = generateToken();
    const row = {
      id: crypto.randomUUID(),
      name,
      tokenHash: await hashToken(token),
      createdAt: new Date(),
    };
    await db.insert(accessTokens).values(row);
    // 浏览器同源 POST 会带 Origin，它就是所有者访问书库用的公开地址。
    const origin = c.req.header("origin") || new URL(c.req.url).origin;
    return c.json(
      {
        token: { id: row.id, name, createdAt: row.createdAt, lastUsedAt: null, revokedAt: null },
        bookSource: buildBookSource({ origin, token, name }),
      },
      201,
    );
  });

  app.post("/tokens/:id/revoke", async (c) => {
    const { db } = c.get("deps");
    const id = c.req.param("id");
    const row = await db
      .select({ revokedAt: accessTokens.revokedAt })
      .from(accessTokens)
      .where(eq(accessTokens.id, id))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    if (!row.revokedAt) await db.update(accessTokens).set({ revokedAt: new Date() }).where(eq(accessTokens.id, id));
    return c.json({ revoked: true });
  });

  return app;
}

// 书源 API 的鉴权：请求头 `Authorization: Bearer <访问令牌>`。
export function requireAccessToken<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const token = match?.[1];
    if (!token || !token.startsWith(TOKEN_PREFIX)) return c.json({ error: "unauthorized" }, 401);
    const { db } = c.get("deps");
    const row = await db
      .select({ id: accessTokens.id, lastUsedAt: accessTokens.lastUsedAt, revokedAt: accessTokens.revokedAt })
      .from(accessTokens)
      .where(eq(accessTokens.tokenHash, await hashToken(token)))
      .get();
    if (!row || row.revokedAt) return c.json({ error: "unauthorized" }, 401);
    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await db.update(accessTokens).set({ lastUsedAt: new Date(now) }).where(eq(accessTokens.id, row.id));
    }
    await next();
  };
}
