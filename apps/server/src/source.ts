import { Hono } from "hono";
import { desc, eq, or, sql } from "drizzle-orm";
import type { AppDeps } from "./app";
import { readChapter } from "./books";
import { books, chapters, versions } from "./db/schema";

type Env = { Variables: { deps: AppDeps } };

/** 书源 API 的路径前缀。书源 JSON 与 API 返回的链接都用相对路径，由阅读客户端按书源地址补全。 */
export const SOURCE_BASE = "/api/source";
const SEARCH_PAGE_SIZE = 20;

const bookUrl = (id: string) => `${SOURCE_BASE}/books/${id}`;

/**
 * 为一个访问令牌生成 Legado 书源。访问令牌放在 `header` 中，
 * Legado 会把它附加到这个书源发出的每个请求（搜索、详情、目录、正文）。
 */
export function buildBookSource({ origin, token, name }: { origin: string; token: string; name: string }) {
  return {
    bookSourceUrl: origin,
    bookSourceName: `Novarium 归藏（${name}）`,
    bookSourceGroup: "Novarium",
    bookSourceType: 0,
    bookSourceComment: "Novarium 归藏书库。访问令牌在请求头中，请勿分享这份书源。",
    enabled: true,
    enabledExplore: false,
    enabledCookieJar: false,
    header: JSON.stringify({ Authorization: `Bearer ${token}` }),
    lastUpdateTime: Date.now(),
    weight: 0,
    customOrder: 0,
    searchUrl: `${SOURCE_BASE}/search?q={{key}}&page={{page}}`,
    ruleSearch: {
      bookList: "$.books[*]",
      name: "$.title",
      author: "$.author",
      intro: "$.intro",
      lastChapter: "$.lastChapter",
      bookUrl: "$.url",
    },
    ruleBookInfo: {
      name: "$.title",
      author: "$.author",
      intro: "$.intro",
      lastChapter: "$.lastChapter",
      tocUrl: "$.tocUrl",
    },
    ruleToc: {
      chapterList: "$.chapters[*]",
      chapterName: "$.title",
      chapterUrl: "$.url",
    },
    ruleContent: {
      content: "$.content",
    },
  };
}

// 阅读客户端用的只读 API。挂在 /api/source 下，受访问令牌保护。
export function createSourceRoutes() {
  const app = new Hono<Env>();

  const lastChapter = sql<string | null>`(
    select ${chapters.title} from ${chapters}
    where ${chapters.versionId} = ${books.currentVersionId}
    order by ${chapters.ord} desc limit 1)`;

  const summaryFields = {
    id: books.id,
    title: books.title,
    author: books.author,
    chapterCount: versions.chapterCount,
    lastChapter,
  };

  const toSummary = (row: { id: string; title: string; author: string; chapterCount: number; lastChapter: string | null }) => ({
    title: row.title,
    author: row.author,
    intro: `共 ${row.chapterCount} 章`,
    lastChapter: row.lastChapter ?? "",
    url: bookUrl(row.id),
  });

  // 按书名或作者做包含匹配，不区分大小写。
  app.get("/search", async (c) => {
    const { db } = c.get("deps");
    const q = (c.req.query("q") ?? "").trim();
    const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
    if (!q) return c.json({ books: [] });
    const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const rows = await db
      .select(summaryFields)
      .from(books)
      .innerJoin(versions, eq(versions.id, books.currentVersionId))
      .where(or(sql`${books.title} like ${pattern} escape '\\'`, sql`${books.author} like ${pattern} escape '\\'`))
      .orderBy(desc(books.createdAt))
      .limit(SEARCH_PAGE_SIZE)
      .offset((page - 1) * SEARCH_PAGE_SIZE);
    return c.json({ books: rows.map(toSummary) });
  });

  app.get("/books/:bookId", async (c) => {
    const { db } = c.get("deps");
    const row = await db
      .select(summaryFields)
      .from(books)
      .innerJoin(versions, eq(versions.id, books.currentVersionId))
      .where(eq(books.id, c.req.param("bookId")))
      .get();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ...toSummary(row), tocUrl: `${bookUrl(row.id)}/toc` });
  });

  app.get("/books/:bookId/toc", async (c) => {
    const { db } = c.get("deps");
    const bookId = c.req.param("bookId");
    const book = await db
      .select({ versionId: books.currentVersionId })
      .from(books)
      .where(eq(books.id, bookId))
      .get();
    if (!book) return c.json({ error: "not_found" }, 404);
    const list = await db
      .select({ order: chapters.ord, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.versionId, book.versionId))
      .orderBy(chapters.ord);
    return c.json({
      chapters: list.map((ch) => ({ title: ch.title, url: `${bookUrl(bookId)}/chapters/${ch.order}` })),
    });
  });

  app.get("/books/:bookId/chapters/:order", async (c) => {
    const result = await readChapter(c.get("deps"), c.req.param("bookId"), c.req.param("order"));
    if (result === "not_found") return c.json({ error: "not_found" }, 404);
    if (result === "text_missing") return c.json({ error: "version_text_missing" }, 500);
    return c.json({ title: result.title, content: result.content });
  });

  return app;
}
