import { Hono } from "hono";
import type { BatchItem } from "drizzle-orm/batch";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { parseProcessOptions, validateChapterIndex } from "@novarium/core/validate";
import type { AppDeps } from "./app";
import { books, chapters, pendingUploads, versions } from "./db/schema";
import { isUuid, originalKey, versionTextKey } from "./storage/keys";

/** 单个上传文件（原稿或版本正文）的上限。 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

type Env = { Variables: { deps: AppDeps } };

// 导入流程：
// 1. 浏览器自行生成书 ID 与版本 ID（UUID），在本地整理原稿。
// 2. PUT 原稿与版本正文，服务端以流的方式写入存储。
// 3. POST 书的元数据与章节索引；服务端核对两个文件的大小、校验索引，再原子写入数据库。
export function createBookRoutes() {
  const app = new Hono<Env>();

  app.put("/books/:bookId/original", async (c) => {
    const bookId = c.req.param("bookId");
    if (!isUuid(bookId)) return c.json({ error: "invalid_id" }, 400);
    const { db } = c.get("deps");
    if (await bookExists(db, bookId)) return c.json({ error: "book_exists" }, 409);
    return storeUpload(c, originalKey(bookId));
  });

  app.put("/books/:bookId/versions/:versionId/text", async (c) => {
    const { bookId, versionId } = c.req.param();
    if (!isUuid(bookId) || !isUuid(versionId)) return c.json({ error: "invalid_id" }, 400);
    const { db } = c.get("deps");
    const existing = await db.select({ id: versions.id }).from(versions).where(eq(versions.id, versionId)).get();
    if (existing) return c.json({ error: "version_exists" }, 409);
    return storeUpload(c, versionTextKey(bookId, versionId));
  });

  app.post("/books", async (c) => {
    const { db, storage, batch } = c.get("deps");
    const body = (await c.req.json().catch(() => null)) as CreateBookBody | null;
    if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);
    const { id, versionId, title, author = "", originalName, options } = body;
    if (typeof id !== "string" || !isUuid(id) || typeof versionId !== "string" || !isUuid(versionId)) {
      return c.json({ error: "invalid_id" }, 400);
    }
    if (typeof title !== "string" || !title.trim() || title.length > 200) return c.json({ error: "invalid_title" }, 400);
    if (typeof author !== "string" || author.length > 100) return c.json({ error: "invalid_author" }, 400);
    if (typeof originalName !== "string" || originalName.length > 255) return c.json({ error: "invalid_original_name" }, 400);
    const parsedOptions = parseProcessOptions(options);
    if (!parsedOptions.ok) return c.json({ error: "invalid_options", details: [parsedOptions.error] }, 400);
    if (await bookExists(db, id)) return c.json({ error: "book_exists" }, 409);

    const [originalSize, textSize] = await Promise.all([
      storage.size(originalKey(id)),
      storage.size(versionTextKey(id, versionId)),
    ]);
    if (originalSize === null) return c.json({ error: "original_missing" }, 400);
    if (textSize === null) return c.json({ error: "version_text_missing" }, 400);

    const errors = validateChapterIndex(body.chapters, textSize);
    if (errors.length > 0) return c.json({ error: "invalid_chapter_index", details: errors }, 400);
    const index = body.chapters as IndexEntry[];

    const now = new Date();
    await batch([
      db.insert(versions).values({
        id: versionId,
        bookId: id,
        options: parsedOptions.options,
        textSize,
        chapterCount: index.length,
        createdAt: now,
      }),
      insertChapters(db, versionId, index),
      db.insert(books).values({
        id,
        title: title.trim(),
        author: author.trim(),
        originalName,
        originalSize,
        currentVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      }),
      db.delete(pendingUploads).where(inArray(pendingUploads.key, [originalKey(id), versionTextKey(id, versionId)])),
    ]);
    return c.json({ id }, 201);
  });

  app.get("/books", async (c) => {
    const { db } = c.get("deps");
    const rows = await db
      .select({
        id: books.id,
        title: books.title,
        author: books.author,
        chapterCount: versions.chapterCount,
        textSize: versions.textSize,
        createdAt: books.createdAt,
      })
      .from(books)
      .innerJoin(versions, eq(versions.id, books.currentVersionId))
      .orderBy(desc(books.createdAt));
    return c.json({ books: rows });
  });

  app.get("/books/:bookId", async (c) => {
    const { db } = c.get("deps");
    const bookId = c.req.param("bookId");
    // 一条语句取书与当前版本，切换版本时不会读到新旧混合的数据。
    const row = await db
      .select({ book: books, version: { id: versions.id, options: versions.options, createdAt: versions.createdAt } })
      .from(books)
      .innerJoin(versions, eq(versions.id, books.currentVersionId))
      .where(eq(books.id, bookId))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    const list = await db
      .select({ order: chapters.ord, title: chapters.title, number: chapters.number, byteLength: chapters.byteLength })
      .from(chapters)
      .where(eq(chapters.versionId, row.version.id))
      .orderBy(chapters.ord);
    return c.json({ book: row.book, version: row.version, chapters: list });
  });

  // 原稿下载，重新整理时浏览器从这里取回原稿。
  app.get("/books/:bookId/original", async (c) => {
    const bookId = c.req.param("bookId");
    const { db, storage } = c.get("deps");
    const book = await db.select({ name: books.originalName }).from(books).where(eq(books.id, bookId)).get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const stream = await storage.get(originalKey(bookId));
    if (!stream) return c.json({ error: "original_missing" }, 500);
    return new Response(stream, { headers: { "content-type": "application/octet-stream" } });
  });

  // 重新整理：浏览器先 PUT 新版本正文，再提交章节索引。
  // 新版本的记录、章节索引与当前版本的切换在一个批次中原子完成；旧版本的记录同批删除。
  // 旧版本正文文件随后删除，并先登记为待清理文件，删除失败时由定时清理补上。
  app.post("/books/:bookId/versions", async (c) => {
    const { db, storage, batch } = c.get("deps");
    const bookId = c.req.param("bookId");
    const body = (await c.req.json().catch(() => null)) as { versionId?: unknown; options?: unknown; chapters?: unknown } | null;
    const versionId = body?.versionId;
    if (typeof versionId !== "string" || !isUuid(versionId)) return c.json({ error: "invalid_id" }, 400);
    const parsedOptions = parseProcessOptions(body?.options);
    if (!parsedOptions.ok) return c.json({ error: "invalid_options", details: [parsedOptions.error] }, 400);
    const book = await db.select({ currentVersionId: books.currentVersionId }).from(books).where(eq(books.id, bookId)).get();
    if (!book) return c.json({ error: "not_found" }, 404);
    if (await db.select({ id: versions.id }).from(versions).where(eq(versions.id, versionId)).get()) {
      return c.json({ error: "version_exists" }, 409);
    }
    const newKey = versionTextKey(bookId, versionId);
    const textSize = await storage.size(newKey);
    if (textSize === null) return c.json({ error: "version_text_missing" }, 400);
    const errors = validateChapterIndex(body?.chapters, textSize);
    if (errors.length > 0) return c.json({ error: "invalid_chapter_index", details: errors }, 400);
    const index = body!.chapters as IndexEntry[];

    const oldVersionId = book.currentVersionId;
    const oldKey = versionTextKey(bookId, oldVersionId);
    const now = new Date();
    await batch([
      db.insert(versions).values({
        id: versionId,
        bookId,
        options: parsedOptions.options,
        textSize,
        chapterCount: index.length,
        createdAt: now,
      }),
      insertChapters(db, versionId, index),
      db.update(books).set({ currentVersionId: versionId, updatedAt: now }).where(eq(books.id, bookId)),
      db.delete(chapters).where(eq(chapters.versionId, oldVersionId)),
      db.delete(versions).where(eq(versions.id, oldVersionId)),
      db.delete(pendingUploads).where(eq(pendingUploads.key, newKey)),
      // 立即视为过期，下次定时清理就会处理。
      db
        .insert(pendingUploads)
        .values({ key: oldKey, createdAt: new Date(0) })
        .onConflictDoUpdate({ target: pendingUploads.key, set: { createdAt: new Date(0) } }),
    ]);
    try {
      await storage.delete(oldKey);
      await db.delete(pendingUploads).where(eq(pendingUploads.key, oldKey));
    } catch (error) {
      console.error(JSON.stringify({ message: "old version text delete failed", key: oldKey, error: String(error) }));
    }
    return c.json({ versionId }, 201);
  });

  app.get("/books/:bookId/chapters/:order", async (c) => {
    const result = await readChapter(c.get("deps"), c.req.param("bookId"), c.req.param("order"));
    if (result === "not_found") return c.json({ error: "not_found" }, 404);
    if (result === "text_missing") return c.json({ error: "version_text_missing" }, 500);
    return c.json(result);
  });

  return app;
}

interface CreateBookBody {
  id?: unknown;
  versionId?: unknown;
  title?: unknown;
  author?: unknown;
  originalName?: unknown;
  options?: unknown;
  chapters?: unknown;
}

interface IndexEntry {
  order: number;
  title: string;
  number: number | null;
  byteOffset: number;
  byteLength: number;
}

export type BatchQuery = BatchItem<"sqlite">;

// 用 json_each 一条语句写入全部章节，避免逐行插入撞上 D1 的参数与查询次数上限。
// 列顺序必须与 chapters 表定义一致。
function insertChapters(db: AppDeps["db"], versionId: string, index: IndexEntry[]) {
  return db.insert(chapters).select(sql`
    select ${versionId},
           json_extract(value, '$.order'),
           json_extract(value, '$.title'),
           json_extract(value, '$.number'),
           json_extract(value, '$.byteOffset'),
           json_extract(value, '$.byteLength')
    from json_each(${JSON.stringify(index)})`);
}

/**
 * 按阅读顺序读取书的当前版本中的一章：只读这一章在正文文件中的字节范围。
 * 当前版本与章节在一条语句中取出，不会读到新旧版本混合的数据。
 * 刚好遇上切换版本、旧正文文件已删除时，重新取一次当前版本。
 */
export async function readChapter(
  { db, storage }: Pick<AppDeps, "db" | "storage">,
  bookId: string,
  orderParam: string,
): Promise<{ order: number; title: string; content: string } | "not_found" | "text_missing"> {
  const order = Number(orderParam);
  if (!/^\d+$/.test(orderParam) || !Number.isSafeInteger(order)) return "not_found";
  for (let attempt = 0; attempt < 2; attempt++) {
    const chapter = await db
      .select({
        versionId: chapters.versionId,
        ord: chapters.ord,
        title: chapters.title,
        byteOffset: chapters.byteOffset,
        byteLength: chapters.byteLength,
      })
      .from(chapters)
      .innerJoin(books, eq(books.currentVersionId, chapters.versionId))
      .where(and(eq(books.id, bookId), eq(chapters.ord, order)))
      .get();
    if (!chapter) return "not_found";
    if (chapter.byteLength === 0) return { order: chapter.ord, title: chapter.title, content: "" };
    const stream = await storage.get(versionTextKey(bookId, chapter.versionId), {
      offset: chapter.byteOffset,
      length: chapter.byteLength,
    });
    if (stream) return { order: chapter.ord, title: chapter.title, content: await new Response(stream).text() };
  }
  return "text_missing";
}

async function bookExists(db: AppDeps["db"], id: string) {
  return !!(await db.select({ id: books.id }).from(books).where(eq(books.id, id)).get());
}

async function storeUpload(c: import("hono").Context<Env>, key: string) {
  const length = Number(c.req.header("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0) return c.json({ error: "content_length_required" }, 411);
  if (length > MAX_UPLOAD_BYTES) return c.json({ error: "too_large", maxBytes: MAX_UPLOAD_BYTES }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty_body" }, 400);
  const { db, storage } = c.get("deps");
  // 先记录再写入：写入中断或之后没有提交时，定时清理能找到这个文件。
  await db
    .insert(pendingUploads)
    .values({ key, createdAt: new Date() })
    .onConflictDoUpdate({ target: pendingUploads.key, set: { createdAt: new Date() } });
  await storage.put(key, body);
  const size = await storage.size(key);
  if (size !== length) {
    await storage.delete(key);
    await db.delete(pendingUploads).where(eq(pendingUploads.key, key));
    return c.json({ error: "incomplete_upload" }, 400);
  }
  return c.json({ size }, 201);
}
