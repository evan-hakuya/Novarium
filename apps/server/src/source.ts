import { Hono } from "hono";
import { desc, eq, or, sql } from "drizzle-orm";
import type { AppDeps } from "./app";
import { readChapter } from "./books";
import { bookTags, books, chapters, versions } from "./db/schema";
import { serveCover } from "./metadata";

type Env = { Variables: { deps: AppDeps } };

/** 书源 API 的路径前缀。书源 JSON 与 API 返回的链接都用相对路径，由阅读客户端按书源地址补全。 */
export const SOURCE_BASE = "/api/source";
/** 书源网络导入地址的路径前缀，后接访问令牌。 */
export const IMPORT_BASE = "/api/book-sources";
/** 封面地址的路径前缀，后接书 ID 与封面上传 ID（见 ADR 0005）。 */
export const COVER_BASE = "/api/covers";
const SEARCH_PAGE_SIZE = 20;

const bookUrl = (id: string) => `${SOURCE_BASE}/books/${id}`;

/** 书库中用到的全部标签，按名称排序。生成书源时用来列出发现页入口。 */
export async function listTags(db: AppDeps["db"]): Promise<string[]> {
  const rows = await db.selectDistinct({ tag: bookTags.tag }).from(bookTags).orderBy(bookTags.tag);
  return rows.map((r) => r.tag);
}

/**
 * 发现页入口：「全部」加上每个标签一个入口。入口在生成书源时固定，
 * 标签有变化时重新导入书源即可更新。
 */
function exploreEntries(tags: string[]) {
  const url = (tag: string) => `${SOURCE_BASE}/explore?tag=${encodeURIComponent(tag)}&page={{page}}`;
  return [{ title: "全部", url: url("") }, ...tags.map((tag) => ({ title: tag, url: url(tag) }))];
}

/**
 * 为一个访问令牌生成 Legado 书源。访问令牌放在 `header` 中，
 * Legado 会把它附加到这个书源发出的每个请求（搜索、详情、目录、正文）。
 */
export function buildBookSource({
  origin,
  token,
  name,
  tags,
}: {
  origin: string;
  token: string;
  name: string;
  tags: string[];
}) {
  const bookListRule = {
    bookList: "$.books[*]",
    name: "$.title",
    author: "$.author",
    kind: "$.kind",
    intro: "$.intro",
    lastChapter: "$.lastChapter",
    coverUrl: "$.coverUrl",
    bookUrl: "$.url",
  };
  return {
    bookSourceUrl: origin,
    bookSourceName: `Novarium 归藏（${name}）`,
    bookSourceGroup: "Novarium",
    bookSourceType: 0,
    bookSourceComment: "Novarium 归藏书库。访问令牌在请求头中，请勿分享这份书源。",
    enabled: true,
    enabledExplore: true,
    enabledCookieJar: false,
    header: JSON.stringify({ Authorization: `Bearer ${token}` }),
    lastUpdateTime: Date.now(),
    weight: 0,
    customOrder: 0,
    searchUrl: `${SOURCE_BASE}/search?q={{key}}&page={{page}}`,
    ruleSearch: bookListRule,
    exploreUrl: JSON.stringify(exploreEntries(tags)),
    ruleExplore: bookListRule,
    ruleBookInfo: {
      name: "$.title",
      author: "$.author",
      kind: "$.kind",
      intro: "$.intro",
      lastChapter: "$.lastChapter",
      coverUrl: "$.coverUrl",
      tocUrl: "$.tocUrl",
    },
    ruleToc: {
      chapterList: "$.chapters[*]",
      chapterName: "$.title",
      chapterUrl: "$.url",
      isVolume: "$.isVolume",
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

  const tags = sql<string>`(
    select json_group_array(tag) from (
      select ${bookTags.tag} as tag from ${bookTags} where ${bookTags.bookId} = ${books.id} order by tag))`;

  const summaryFields = {
    id: books.id,
    title: books.title,
    author: books.author,
    intro: books.intro,
    coverKey: books.coverKey,
    tags,
    chapterCount: versions.chapterCount,
    lastChapter,
  };

  const toSummary = (row: {
    id: string;
    title: string;
    author: string;
    intro: string;
    coverKey: string | null;
    tags: string;
    chapterCount: number;
    lastChapter: string | null;
  }) => ({
    title: row.title,
    author: row.author,
    intro: row.intro || `共 ${row.chapterCount} 章`,
    // Legado 的分类字段，多个值用逗号分隔。
    kind: (JSON.parse(row.tags) as string[]).join(","),
    lastChapter: row.lastChapter ?? "",
    // 地址含封面的上传 ID：换封面后地址随之改变，阅读客户端不会用缓存的旧图。
    coverUrl: row.coverKey ? `${COVER_BASE}/${row.id}/${row.coverKey.split("/").pop()}` : "",
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

  // 发现页：列出带某个标签的书；tag 为空时列出全部书。新导入的书在前。
  app.get("/explore", async (c) => {
    const { db } = c.get("deps");
    const tag = (c.req.query("tag") ?? "").trim();
    const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
    const hasTag = sql`exists (select 1 from ${bookTags} where ${bookTags.bookId} = ${books.id} and ${bookTags.tag} = ${tag})`;
    const rows = await db
      .select(summaryFields)
      .from(books)
      .innerJoin(versions, eq(versions.id, books.currentVersionId))
      .where(tag ? hasTag : undefined)
      .orderBy(desc(books.createdAt), books.id)
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
    // 一条语句按当前版本取目录，切换版本时不会读到新旧混合的目录。
    const list = await db
      .select({ order: chapters.ord, title: chapters.title, volume: chapters.volume })
      .from(chapters)
      .innerJoin(books, eq(books.currentVersionId, chapters.versionId))
      .where(eq(books.id, bookId))
      .orderBy(chapters.ord);
    if (list.length === 0) return c.json({ error: "not_found" }, 404);
    // 每卷第一章前插入一个卷条目，Legado 显示为卷标题。
    // 卷条目也给出各不相同的链接：客户端按链接去重，不支持 isVolume 的客户端（如 reader）会把卷当作空章节显示。
    const toc: { title: string; url: string; isVolume: boolean }[] = [];
    let currentVolume: string | null = null;
    for (const ch of list) {
      if (ch.volume && ch.volume !== currentVolume) {
        toc.push({ title: ch.volume, url: `${bookUrl(bookId)}/volumes/${ch.order}`, isVolume: true });
      }
      currentVolume = ch.volume;
      toc.push({ title: ch.title, url: `${bookUrl(bookId)}/chapters/${ch.order}`, isVolume: false });
    }
    return c.json({ chapters: toc });
  });

  // 卷条目没有正文。只有不支持 isVolume 的客户端会请求这里。
  app.get("/books/:bookId/volumes/:order", (c) => c.json({ title: "", content: "" }));

  app.get("/books/:bookId/chapters/:order", async (c) => {
    const result = await readChapter(c.get("deps"), c.req.param("bookId"), c.req.param("order"));
    if (result === "not_found") return c.json({ error: "not_found" }, 404);
    if (result === "text_missing") return c.json({ error: "version_text_missing" }, 500);
    return c.json({ title: result.title, content: result.content });
  });

  return app;
}

/**
 * 封面图片，不需要访问令牌。阅读客户端加载图片时不一定带书源的请求头（例如 reader 的图片代理），
 * 所以封面地址本身就是凭证：上传 ID 是随机 UUID，只有它与当前封面一致时才返回图片。
 */
export function createCoverRoutes() {
  const app = new Hono<Env>();
  app.get("/:bookId/:uploadId", async (c) => {
    const { bookId, uploadId } = c.req.param();
    const { db } = c.get("deps");
    const book = await db.select({ coverKey: books.coverKey }).from(books).where(eq(books.id, bookId)).get();
    if (!book?.coverKey || book.coverKey.split("/").pop() !== uploadId) return c.json({ error: "not_found" }, 404);
    return serveCover(c.get("deps"), bookId);
  });
  return app;
}
