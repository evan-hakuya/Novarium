import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { AppDeps } from "./app";
import type { BatchQuery } from "./books";
import { createDaoSearchSource, DAOSEARCH_USER_AGENT } from "./daosearch";
import { books, bookTags, settings } from "./db/schema";
import {
  deleteStaleFiles,
  getTags,
  MAX_AUTHOR_LENGTH,
  MAX_COVER_BYTES,
  MAX_ALIAS_LENGTH,
  MAX_ALIASES,
  MAX_GENRE_LENGTH,
  MAX_INTRO_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  sniffImageType,
  staleFileEntries,
} from "./metadata";
import { ScrapeError, type ScrapeCandidate, type ScrapedBook, type ScrapeSource, type ScrapeSourceId } from "./scrape";
import { createDbScrapeCache } from "./scrape-cache";
import { coverKey } from "./storage/keys";

type Env = { Variables: { deps: AppDeps } };

/** DaoSearch API 密钥在 settings 表中的键（ADR 0006）。 */
const DAOSEARCH_KEY = "daosearch_key";
/** 下载封面的超时。 */
const COVER_TIMEOUT_MS = 15_000;

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
  return key ? createDaoSearchSource(key, deps.fetch, { cache: createDbScrapeCache(deps.db) }) : null;
}

/** 把 ScrapeError 转成统一的响应：502 scrape_unavailable，带 kind 与 retryAfterSeconds。 */
export function scrapeErrorResponse(c: Context<Env>, error: unknown) {
  if (!(error instanceof ScrapeError)) throw error;
  // 只记录类型与状态，不记录密钥。
  console.warn(JSON.stringify({ message: "scrape request failed", kind: error.kind, detail: error.message.slice(0, 200) }));
  if (error.retryAfterSeconds !== undefined) c.header("retry-after", String(error.retryAfterSeconds));
  return c.json({ error: "scrape_unavailable", kind: error.kind, retryAfterSeconds: error.retryAfterSeconds }, 502);
}

/** 作者与现有作者一致的候选排在前面，其余保持刮削源给出的顺序。 */
export function rankByAuthor(results: ScrapeCandidate[], author: string): ScrapeCandidate[] {
  const own = author.trim();
  if (!own) return results;
  return [...results.filter((r) => r.author?.trim() === own), ...results.filter((r) => r.author?.trim() !== own)];
}

/** 把刮削到的值合并进现有列表：现有值全部保留，跳过重复与过长的值，总数不超过上限。 */
function mergeList(existing: string[], scraped: string[], max: number, tooLong: (value: string) => boolean): string[] {
  const merged = [...existing];
  for (const raw of scraped) {
    const value = raw.trim();
    if (merged.length >= max) break;
    if (!value || tooLong(value) || merged.includes(value)) continue;
    merged.push(value);
  }
  return merged;
}

/** 标签合并，规则见 mergeList。 */
export const mergeTags = (existing: string[], scraped: string[]) =>
  mergeList(existing, scraped, MAX_TAGS, (tag) => [...tag].length > MAX_TAG_LENGTH);

/** 别名合并，规则见 mergeList。 */
export const mergeAliases = (existing: string[], scraped: string[]) =>
  mergeList(existing, scraped, MAX_ALIASES, (alias) => alias.length > MAX_ALIAS_LENGTH);

/** 平台标记与其他平台的书最多保存的条数。 */
const MAX_LIST_ITEMS = 20;

/** 截到最多 max 个 UTF-16 单位，不切断代理对。与元数据接口的 length 校验一致。 */
function clip(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** 读取响应体，超过 max 字节时停止并返回 null。 */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** 下载刮削源的封面。不带刮削源密钥：封面可能在其他站点上。沿用封面上传的大小与格式校验。 */
async function downloadCover(doFetch: typeof fetch, url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await doFetch(url, { headers: { "user-agent": DAOSEARCH_USER_AGENT }, signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (!res.ok || Number(res.headers.get("content-length")) > MAX_COVER_BYTES) return null;
    const bytes = await readCapped(res, MAX_COVER_BYTES);
    if (!bytes || bytes.byteLength === 0) return null;
    const type = sniffImageType(bytes);
    return type ? { bytes, type } : null;
  } catch {
    return null;
  }
}

const FIELDS = [
  "title",
  "author",
  "intro",
  "tags",
  "cover",
  "genre",
  "subgenre",
  "status",
  "aliases",
  "authorEn",
  "wordCount",
  "released",
  "updatedAt",
  "facets",
  "mature",
  "sourceUrl",
  "alsoOn",
] as const;
type Field = (typeof FIELDS)[number];

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

  // 刮削对话框的候选列表。不绑定某本书，导入时刮削（#74）也用它。q 可以是书名、作者，或书页链接；author 用于把作者一致的候选排在前面。
  app.get("/scrape/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const author = (c.req.query("author") ?? "").slice(0, MAX_AUTHOR_LENGTH);
    if (!q || q.length > 200) return c.json({ error: "invalid_query" }, 400);
    const source = await getScrapeSource(c.get("deps"));
    if (!source) return c.json({ error: "scrape_not_configured" }, 409);
    try {
      return c.json({ results: rankByAuthor(await source.search(q), author) });
    } catch (error) {
      return scrapeErrorResponse(c, error);
    }
  });

  // 所有者点击某个候选后才读取它的详情。
  app.get("/scrape/books", async (c) => {
    const ref = (c.req.query("ref") ?? "").trim();
    if (!ref || ref.length > 200) return c.json({ error: "invalid_ref" }, 400);
    const source = await getScrapeSource(c.get("deps"));
    if (!source) return c.json({ error: "scrape_not_configured" }, 409);
    try {
      return c.json({ book: await source.getBook(ref) });
    } catch (error) {
      return scrapeErrorResponse(c, error);
    }
  });

  // 写入所有者勾选的字段，并记下刮削来源。服务端按作品 ID 重新读取，不信任浏览器传来的值。
  app.post("/books/:bookId/scrape", async (c) => {
    const deps = c.get("deps");
    const { db, batch } = deps;
    const bookId = c.req.param("bookId");
    const body = (await c.req.json().catch(() => null)) as { ref?: unknown; fields?: unknown } | null;
    const fields = Array.isArray(body?.fields) ? body.fields : null;
    if (typeof body?.ref !== "string" || !fields || !fields.every((f) => FIELDS.includes(f as Field))) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const chosen = new Set(fields as Field[]);
    const current = await db.select({ coverKey: books.coverKey, aliases: books.aliases }).from(books).where(eq(books.id, bookId)).get();
    if (!current) return c.json({ error: "not_found" }, 404);
    const source = await getScrapeSource(deps);
    if (!source) return c.json({ error: "scrape_not_configured" }, 409);

    let scraped: ScrapedBook;
    try {
      scraped = await source.getBook(body.ref);
    } catch (error) {
      return scrapeErrorResponse(c, error);
    }

    const now = new Date();
    const set: Partial<typeof books.$inferInsert> = {
      scrapeSource: source.id,
      scrapeRef: scraped.ref,
      scrapeUrl: scraped.url,
      scrapedAt: now,
      updatedAt: now,
    };
    const title = scraped.title?.trim();
    if (chosen.has("title") && title) set.title = clip(title, MAX_TITLE_LENGTH);
    if (chosen.has("author") && scraped.author?.trim()) set.author = clip(scraped.author.trim(), MAX_AUTHOR_LENGTH);
    if (chosen.has("intro") && scraped.intro?.trim()) set.intro = clip(scraped.intro.trim(), MAX_INTRO_LENGTH);
    if (chosen.has("genre") && scraped.genre?.trim()) set.genre = clip(scraped.genre.trim(), MAX_GENRE_LENGTH);
    if (chosen.has("subgenre") && scraped.subgenre?.trim()) set.subgenre = clip(scraped.subgenre.trim(), MAX_GENRE_LENGTH);
    if (chosen.has("status") && scraped.status) set.serialStatus = scraped.status;
    if (chosen.has("aliases") && scraped.aliases.length > 0) set.aliases = mergeAliases(current.aliases, scraped.aliases);
    if (chosen.has("authorEn") && scraped.authorEn?.trim()) set.authorEn = clip(scraped.authorEn.trim(), MAX_AUTHOR_LENGTH);
    if (chosen.has("wordCount") && scraped.wordCount !== null) set.sourceWordCount = scraped.wordCount;
    if (chosen.has("released") && scraped.released) set.released = scraped.released;
    const updatedAt = scraped.updatedAt ? new Date(scraped.updatedAt) : null;
    if (chosen.has("updatedAt") && updatedAt && !Number.isNaN(updatedAt.getTime())) set.sourceUpdatedAt = updatedAt;
    if (chosen.has("facets") && scraped.facets.length > 0) set.facets = scraped.facets.slice(0, MAX_LIST_ITEMS);
    if (chosen.has("mature") && scraped.mature !== null) set.mature = scraped.mature;
    if (chosen.has("sourceUrl") && scraped.sourceUrl) set.sourceUrl = scraped.sourceUrl;
    if (chosen.has("alsoOn") && scraped.alsoOn.length > 0) set.alsoOn = scraped.alsoOn.slice(0, MAX_LIST_ITEMS);

    const queries: BatchQuery[] = [];
    let stale: string[] = [];
    if (chosen.has("cover") && scraped.coverUrl) {
      const cover = await downloadCover(deps.fetch ?? fetch, scraped.coverUrl);
      if (!cover) return c.json({ error: "cover_download_failed" }, 502);
      const key = coverKey(bookId, crypto.randomUUID());
      await deps.storage.put(key, cover.bytes);
      set.coverKey = key;
      set.coverType = cover.type;
      stale = current.coverKey ? [current.coverKey] : [];
      queries.push(...staleFileEntries(db, stale));
    }
    if (chosen.has("tags") && scraped.tags.length > 0) {
      const existing = await getTags(db, bookId);
      const added = mergeTags(existing, scraped.tags).slice(existing.length);
      if (added.length > 0) queries.push(db.insert(bookTags).values(added.map((tag) => ({ bookId, tag }))));
    }
    await batch([db.update(books).set(set).where(eq(books.id, bookId)), ...queries]);
    await deleteStaleFiles(deps, stale);
    return c.json({ ok: true });
  });

  return app;
}
