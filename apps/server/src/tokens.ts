import { Hono, type Context, type MiddlewareHandler } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import type { AppDeps } from "./app";
import { accessTokens } from "./db/schema";
import { buildBookSource, IMPORT_BASE } from "./source";

type Env = { Variables: { deps: AppDeps } };

// 访问令牌的明文形如 `nvr_<43 位 base64url>`。
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

/** 客户端访问本服务用的地址。反向代理后面时按 X-Forwarded-* 还原。 */
export function publicOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  return `${proto || url.protocol.replace(":", "")}://${host || url.host}`;
}

/** 一个访问令牌的书源：书源 JSON 与网络导入地址。 */
function bookSourceFor(c: Context, token: string, name: string) {
  const origin = publicOrigin(c);
  return {
    bookSource: buildBookSource({ origin, token, name }),
    importUrl: `${origin}${IMPORT_BASE}/${token}`,
  };
}

/** 按明文查找访问令牌；不存在或已撤销时返回 null。 */
async function findActiveToken(db: AppDeps["db"], token: string | undefined) {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const row = await db
    .select({
      id: accessTokens.id,
      name: accessTokens.name,
      lastUsedAt: accessTokens.lastUsedAt,
      revokedAt: accessTokens.revokedAt,
    })
    .from(accessTokens)
    .where(eq(accessTokens.tokenHash, await hashToken(token)))
    .get();
  return row && !row.revokedAt ? row : null;
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
        viewable: sql<number>`${accessTokens.token} is not null`,
      })
      .from(accessTokens)
      // 同一毫秒创建的令牌按插入顺序排列。
      .orderBy(desc(accessTokens.createdAt), desc(sql`rowid`));
    return c.json({ tokens: rows.map((row) => ({ ...row, viewable: !!row.viewable })) });
  });

  app.post("/tokens", async (c) => {
    const { db } = c.get("deps");
    const body = await c.req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 50) return c.json({ error: "invalid_name" }, 400);
    const token = generateToken();
    const row = {
      id: crypto.randomUUID(),
      name,
      token,
      tokenHash: await hashToken(token),
      createdAt: new Date(),
    };
    await db.insert(accessTokens).values(row);
    return c.json(
      {
        token: { id: row.id, name, createdAt: row.createdAt, lastUsedAt: null, revokedAt: null, viewable: true },
        ...bookSourceFor(c, token, name),
      },
      201,
    );
  });

  app.get("/tokens/:id/book-source", async (c) => {
    const { db } = c.get("deps");
    const row = await db.select().from(accessTokens).where(eq(accessTokens.id, c.req.param("id"))).get();
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.revokedAt) return c.json({ error: "token_revoked" }, 409);
    if (!row.token) return c.json({ error: "token_not_viewable" }, 409);
    return c.json(bookSourceFor(c, row.token, row.name));
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

  // 删除记录。未撤销的令牌删除后同样立即失效。
  app.delete("/tokens/:id", async (c) => {
    const { db } = c.get("deps");
    const deleted = await db
      .delete(accessTokens)
      .where(eq(accessTokens.id, c.req.param("id")))
      .returning({ id: accessTokens.id });
    if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ deleted: true });
  });

  return app;
}

/**
 * 网络导入：阅读客户端从这个地址下载书源。访问令牌在路径中，因为导入请求无法自带请求头。
 * 只有导入用到这个地址；读书的请求仍然只在请求头中带访问令牌。
 */
export function createImportRoutes() {
  const app = new Hono<Env>();
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    const row = await findActiveToken(c.get("deps").db, token);
    if (!row) return c.json({ error: "not_found" }, 404);
    c.header("cache-control", "no-store");
    return c.json([bookSourceFor(c, token, row.name).bookSource]);
  });
  return app;
}

// 书源 API 的鉴权：请求头 `Authorization: Bearer <访问令牌>`。
export function requireAccessToken<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const { db } = c.get("deps");
    const row = await findActiveToken(db, match?.[1]);
    if (!row) return c.json({ error: "unauthorized" }, 401);
    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await db.update(accessTokens).set({ lastUsedAt: new Date(now) }).where(eq(accessTokens.id, row.id));
    }
    await next();
  };
}
