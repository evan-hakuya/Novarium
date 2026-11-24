import { Hono } from "hono";
import type { BatchItem } from "drizzle-orm/batch";
import { and, desc, eq, sql } from "drizzle-orm";
import { validateChapterIndex } from "@novarium/core/validate";
import type { AppDeps } from "./app";
import { books, chapters, versions } from "./db/schema";
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
    if (!options || typeof options !== "object") return c.json({ error: "invalid_options" }, 400);
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
        options,
        textSize,
        chapterCount: index.length,
        createdAt: now,
      }),
      // 用 json_each 一条语句写入全部章节，避免逐行插入撞上 D1 的参数与查询次数上限。
      // 列顺序必须与 chapters 表定义一致。
      db.insert(chapters).select(sql`
        select ${versionId},
               json_extract(value, '$.order'),
               json_extract(value, '$.title'),
               json_extract(value, '$.number'),
               json_extract(value, '$.byteOffset'),
               json_extract(value, '$.byteLength')
        from json_each(${JSON.stringify(index)})`),
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
    const book = await db.select().from(books).where(eq(books.id, c.req.param("bookId"))).get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const list = await db
      .select({ order: chapters.ord, title: chapters.title, number: chapters.number, byteLength: chapters.byteLength })
      .from(chapters)
      .where(eq(chapters.versionId, book.currentVersionId))
      .orderBy(chapters.ord);
    return c.json({ book, chapters: list });
  });

  app.get("/books/:bookId/chapters/:order", async (c) => {
    const { db, storage } = c.get("deps");
    const order = Number(c.req.param("order"));
    if (!Number.isSafeInteger(order) || order < 0) return c.json({ error: "not_found" }, 404);
    const book = await db.select().from(books).where(eq(books.id, c.req.param("bookId"))).get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const chapter = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.versionId, book.currentVersionId), eq(chapters.ord, order)))
      .get();
    if (!chapter) return c.json({ error: "not_found" }, 404);
    let content = "";
    if (chapter.byteLength > 0) {
      const stream = await storage.get(versionTextKey(book.id, book.currentVersionId), {
        offset: chapter.byteOffset,
        length: chapter.byteLength,
      });
      if (!stream) return c.json({ error: "version_text_missing" }, 500);
      content = await new Response(stream).text();
    }
    return c.json({ order: chapter.ord, title: chapter.title, content });
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

async function bookExists(db: AppDeps["db"], id: string) {
  return !!(await db.select({ id: books.id }).from(books).where(eq(books.id, id)).get());
}

async function storeUpload(c: import("hono").Context<Env>, key: string) {
  const length = Number(c.req.header("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0) return c.json({ error: "content_length_required" }, 411);
  if (length > MAX_UPLOAD_BYTES) return c.json({ error: "too_large", maxBytes: MAX_UPLOAD_BYTES }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty_body" }, 400);
  const { storage } = c.get("deps");
  await storage.put(key, body);
  const size = await storage.size(key);
  if (size !== length) {
    await storage.delete(key);
    return c.json({ error: "incomplete_upload" }, 400);
  }
  return c.json({ size }, 201);
}
