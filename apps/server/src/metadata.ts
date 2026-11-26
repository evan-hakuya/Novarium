import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { AppDeps } from "./app";
import type { BatchQuery } from "./books";
import { books, bookTags, chapters, pendingUploads, versions } from "./db/schema";
import { coverKey, currentOriginalKey, isUuid, versionTextKey } from "./storage/keys";

type Env = { Variables: { deps: AppDeps } };

export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 20;
export const MAX_INTRO_LENGTH = 5000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_AUTHOR_LENGTH = 100;
export const MAX_ALIASES = 20;
export const MAX_ALIAS_LENGTH = 200;
export const MAX_GENRE_LENGTH = 50;
export const SERIAL_STATUSES = ["ongoing", "completed"] as const;

/** 按文件头判断图片类型，不信任请求的 Content-Type。 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** 校验并规范化标签：去首尾空白、去重、去空。 */
export function parseTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((t) => typeof t === "string")) return null;
  const tags = [...new Set((value as string[]).map((t) => t.trim()).filter(Boolean))];
  if (tags.length > MAX_TAGS || tags.some((t) => [...t].length > MAX_TAG_LENGTH)) return null;
  return tags;
}

export async function getTags(db: AppDeps["db"], bookId: string): Promise<string[]> {
  const rows = await db.select({ tag: bookTags.tag }).from(bookTags).where(eq(bookTags.bookId, bookId)).orderBy(bookTags.tag);
  return rows.map((r) => r.tag);
}

/** 校验并规范化别名：去首尾空白、去重、去空。 */
export function parseAliases(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((t) => typeof t === "string")) return null;
  const aliases = [...new Set((value as string[]).map((t) => t.trim()).filter(Boolean))];
  // 别名与书名一样按 UTF-16 单位计数（刮削写入时的 clip 也是）；标签按码点计数。
  if (aliases.length > MAX_ALIASES || aliases.some((t) => t.length > MAX_ALIAS_LENGTH)) return null;
  return aliases;
}

/** 分类与子分类：字符串，空字符串表示清空。返回 undefined 表示无效。 */
function parseGenre(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > MAX_GENRE_LENGTH) return undefined;
  return value.trim() || null;
}

/**
 * 删除不再被引用的文件：先在批次中把它们登记为过期的待清理文件，批次提交后逐个删除。
 * 删除失败的文件由定时清理补删。
 */
export function staleFileEntries(db: AppDeps["db"], keys: string[]): BatchQuery[] {
  if (keys.length === 0) return [];
  return [
    db
      .insert(pendingUploads)
      .values(keys.map((key) => ({ key, createdAt: new Date(0) })))
      .onConflictDoUpdate({ target: pendingUploads.key, set: { createdAt: new Date(0) } }),
  ];
}

export async function deleteStaleFiles({ db, storage }: Pick<AppDeps, "db" | "storage">, keys: string[]) {
  for (const key of keys) {
    try {
      await storage.delete(key);
      await db.delete(pendingUploads).where(eq(pendingUploads.key, key));
    } catch (error) {
      console.error(JSON.stringify({ message: "stale file delete failed", key, error: String(error) }));
    }
  }
}

// 书的元数据（书名、作者、简介、标签、封面）与删除。挂在 /api/admin 下，受 session 保护。
export function createMetadataRoutes() {
  const app = new Hono<Env>();

  app.patch("/books/:bookId", async (c) => {
    const { db, batch } = c.get("deps");
    const bookId = c.req.param("bookId");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
    const set: Partial<typeof books.$inferInsert> = {};
    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.length > MAX_TITLE_LENGTH) return c.json({ error: "invalid_title" }, 400);
      set.title = body.title.trim();
    }
    if ("author" in body) {
      if (typeof body.author !== "string" || body.author.length > MAX_AUTHOR_LENGTH) return c.json({ error: "invalid_author" }, 400);
      set.author = body.author.trim();
    }
    if ("intro" in body) {
      if (typeof body.intro !== "string" || body.intro.length > MAX_INTRO_LENGTH) return c.json({ error: "invalid_intro" }, 400);
      set.intro = body.intro.trim();
    }
    let tags: string[] | null = null;
    if ("tags" in body) {
      tags = parseTags(body.tags);
      if (!tags) return c.json({ error: "invalid_tags" }, 400);
    }
    for (const key of ["genre", "subgenre"] as const) {
      if (!(key in body)) continue;
      const genre = parseGenre(body[key]);
      if (genre === undefined) return c.json({ error: `invalid_${key}` }, 400);
      set[key] = genre;
    }
    if ("serialStatus" in body) {
      const status = body.serialStatus;
      if (status !== null && !SERIAL_STATUSES.includes(status as (typeof SERIAL_STATUSES)[number])) {
        return c.json({ error: "invalid_serial_status" }, 400);
      }
      set.serialStatus = status as string | null;
    }
    if ("aliases" in body) {
      const aliases = parseAliases(body.aliases);
      if (!aliases) return c.json({ error: "invalid_aliases" }, 400);
      set.aliases = aliases;
    }
    if (!(await db.select({ id: books.id }).from(books).where(eq(books.id, bookId)).get())) {
      return c.json({ error: "not_found" }, 404);
    }
    const queries: BatchQuery[] = [db.update(books).set({ ...set, updatedAt: new Date() }).where(eq(books.id, bookId))];
    if (tags) {
      queries.push(db.delete(bookTags).where(eq(bookTags.bookId, bookId)));
      if (tags.length > 0) queries.push(db.insert(bookTags).values(tags.map((tag) => ({ bookId, tag }))));
    }
    await batch(queries as [BatchQuery, ...BatchQuery[]]);
    return c.json({ ok: true });
  });

  app.put("/books/:bookId/cover", async (c) => {
    const { db, storage, batch } = c.get("deps");
    const bookId = c.req.param("bookId");
    const book = await db.select({ coverKey: books.coverKey }).from(books).where(eq(books.id, bookId)).get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const length = Number(c.req.header("content-length"));
    if (length > MAX_COVER_BYTES) return c.json({ error: "cover_too_large", maxBytes: MAX_COVER_BYTES }, 413);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0) return c.json({ error: "empty_body" }, 400);
    if (bytes.byteLength > MAX_COVER_BYTES) return c.json({ error: "cover_too_large", maxBytes: MAX_COVER_BYTES }, 413);
    const type = sniffImageType(bytes);
    if (!type) return c.json({ error: "unsupported_image" }, 415);
    const key = coverKey(bookId, crypto.randomUUID());
    await storage.put(key, bytes);
    const stale = book.coverKey ? [book.coverKey] : [];
    await batch([
      db.update(books).set({ coverKey: key, coverType: type, updatedAt: new Date() }).where(eq(books.id, bookId)),
      ...staleFileEntries(db, stale),
    ]);
    await deleteStaleFiles(c.get("deps"), stale);
    return c.json({ coverKey: key }, 201);
  });

  app.delete("/books/:bookId/cover", async (c) => {
    const { db, batch } = c.get("deps");
    const bookId = c.req.param("bookId");
    const book = await db.select({ coverKey: books.coverKey }).from(books).where(eq(books.id, bookId)).get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const stale = book.coverKey ? [book.coverKey] : [];
    await batch([
      db.update(books).set({ coverKey: null, coverType: null, updatedAt: new Date() }).where(eq(books.id, bookId)),
      ...staleFileEntries(db, stale),
    ]);
    await deleteStaleFiles(c.get("deps"), stale);
    return c.json({ ok: true });
  });

  app.get("/books/:bookId/cover", (c) => serveCover(c.get("deps"), c.req.param("bookId")));

  // 删除书：数据库记录在一个批次中删除，原稿、版本正文与封面随后删除。
  app.delete("/books/:bookId", async (c) => {
    const { db, batch } = c.get("deps");
    const bookId = c.req.param("bookId");
    if (!isUuid(bookId)) return c.json({ error: "not_found" }, 404);
    const book = await db
      .select({ id: books.id, originalKey: books.originalKey, coverKey: books.coverKey })
      .from(books)
      .where(eq(books.id, bookId))
      .get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const versionIds = (await db.select({ id: versions.id }).from(versions).where(eq(versions.bookId, bookId))).map((v) => v.id);
    const stale = [currentOriginalKey(book), ...versionIds.map((v) => versionTextKey(bookId, v))];
    if (book.coverKey) stale.push(book.coverKey);
    const queries: BatchQuery[] = [
      db.delete(books).where(eq(books.id, bookId)),
      db.delete(bookTags).where(eq(bookTags.bookId, bookId)),
      db.delete(versions).where(eq(versions.bookId, bookId)),
      ...staleFileEntries(db, stale),
    ];
    if (versionIds.length > 0) queries.push(db.delete(chapters).where(inArray(chapters.versionId, versionIds)));
    await batch(queries as [BatchQuery, ...BatchQuery[]]);
    await deleteStaleFiles(c.get("deps"), stale);
    return c.json({ deleted: true });
  });

  return app;
}

/** 返回一本书的封面图片。 */
export async function serveCover({ db, storage }: Pick<AppDeps, "db" | "storage">, bookId: string): Promise<Response> {
  const book = await db.select({ coverKey: books.coverKey, coverType: books.coverType }).from(books).where(eq(books.id, bookId)).get();
  if (!book?.coverKey) return Response.json({ error: "not_found" }, { status: 404 });
  const stream = await storage.get(book.coverKey);
  if (!stream) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(stream, {
    headers: { "content-type": book.coverType ?? "application/octet-stream", "cache-control": "private, max-age=3600" },
  });
}
