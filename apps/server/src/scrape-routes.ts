import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { AppDeps } from "./app";
import { createDaoSearchSource } from "./daosearch";
import { settings } from "./db/schema";
import { ScrapeError, type ScrapeSource, type ScrapeSourceId } from "./scrape";

type Env = { Variables: { deps: AppDeps } };

/** DaoSearch API 密钥在 settings 表中的键（ADR 0006）。 */
const DAOSEARCH_KEY = "daosearch_key";

export interface ScrapeStatus {
  /** 是否已填写密钥。没有时后台不显示刮削功能。 */
  configured: boolean;
  source: ScrapeSourceId;
  /** 密钥的前后几位，例如「ds_l…9f3a」。未填写时为 null。 */
  keyHint: string | null;
}

/** 只显示密钥的前后几位；太短的密钥全部隐藏。 */
export function maskKey(key: string): string {
  return key.length >= 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "…";
}

async function readKey(db: AppDeps["db"]): Promise<string | null> {
  const row = await db.select().from(settings).where(eq(settings.key, DAOSEARCH_KEY)).get();
  return typeof row?.value === "string" && row.value ? row.value : null;
}

async function getScrapeStatus(db: AppDeps["db"]): Promise<ScrapeStatus> {
  const key = await readKey(db);
  return { configured: !!key, source: "daosearch", keyHint: key ? maskKey(key) : null };
}

/** 当前的刮削源；没有密钥时为 null。 */
export async function getScrapeSource(deps: AppDeps): Promise<ScrapeSource | null> {
  const key = await readKey(deps.db);
  return key ? createDaoSearchSource(key, deps.fetch) : null;
}

/** 把 ScrapeError 转成统一的响应：502 scrape_unavailable，带 kind 与 retryAfterSeconds。 */
export function scrapeErrorResponse(c: Context<Env>, error: unknown) {
  if (!(error instanceof ScrapeError)) throw error;
  // 只记录类型与状态，不记录密钥。
  console.warn(JSON.stringify({ message: "scrape request failed", kind: error.kind, detail: error.message.slice(0, 200) }));
  if (error.retryAfterSeconds !== undefined) c.header("retry-after", String(error.retryAfterSeconds));
  return c.json({ error: "scrape_unavailable", kind: error.kind, retryAfterSeconds: error.retryAfterSeconds }, 502);
}

// 刮削设置。挂在 /api/admin 下，受 session 保护。
export function createScrapeRoutes() {
  const app = new Hono<Env>();

  app.get("/settings/scrape", async (c) => c.json(await getScrapeStatus(c.get("deps").db)));

  app.put("/settings/scrape", async (c) => {
    const { db } = c.get("deps");
    const body = await c.req.json().catch(() => null);
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    if (!key || /\s/.test(key) || key.length > 200) return c.json({ error: "invalid_key" }, 400);
    const now = new Date();
    await db
      .insert(settings)
      .values({ key: DAOSEARCH_KEY, value: key, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: key, updatedAt: now } });
    return c.json(await getScrapeStatus(db));
  });

  app.delete("/settings/scrape", async (c) => {
    const { db } = c.get("deps");
    await db.delete(settings).where(eq(settings.key, DAOSEARCH_KEY));
    return c.json(await getScrapeStatus(db));
  });

  // 测试连接：DaoSearch 的 /limits/me 不消耗点数。
  app.post("/settings/scrape/check", async (c) => {
    const source = await getScrapeSource(c.get("deps"));
    if (!source) return c.json({ error: "scrape_not_configured" }, 409);
    try {
      return c.json({ ok: true, quota: await source.check() });
    } catch (error) {
      return scrapeErrorResponse(c, error);
    }
  });

  return app;
}
