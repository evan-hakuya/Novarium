import { describe, expect, it, beforeEach, vi } from "vitest";
import { mergeTags, rankByAuthor } from "./scrape-routes";
import type { ScrapedBook } from "./scrape";
import { addBook, createTestApp, ownerCookieHeader } from "./test-app";

// 刮削对话框的搜索与写入。DaoSearch 用假的 fetch 模拟。

const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const daoBook = (id: string, author: string) => ({
  source: "qidian",
  source_book_id: id,
  url: `https://daosearch.io/qidian/book/${id}/x`,
  title: { en: null, zh: `书${id}` },
  author: { en: null, zh: author },
  cover_url: `https://img.example/${id}.png`,
  synopsis_zh: `简介${id}`,
  tags: [{ en: null, zh: "悬疑" }, { en: null, zh: "新标签" }],
  word_count: 1000,
  status: "ongoing",
  released: null,
});

const candidate = (ref: string, author: string | null) => ({ ref, author }) as ScrapedBook;

describe("刮削写入的纯函数", () => {
  it("作者一致的候选排在前面，其余保持顺序", () => {
    const list = [candidate("a", "甲"), candidate("b", "乙"), candidate("c", " 乙 "), candidate("d", null)];
    expect(rankByAuthor(list, "乙").map((r) => r.ref)).toEqual(["b", "c", "a", "d"]);
    expect(rankByAuthor(list, "").map((r) => r.ref)).toEqual(["a", "b", "c", "d"]);
  });

  it("标签合并：保留现有标签，去重，跳过过长的，最多 20 个", () => {
    expect(mergeTags(["悬疑", "自己加的"], [" 悬疑 ", "克苏鲁", "", "很".repeat(21)])).toEqual(["悬疑", "自己加的", "克苏鲁"]);
    const full = Array.from({ length: 19 }, (_, i) => `t${i}`);
    expect(mergeTags(full, ["x", "y"])).toEqual([...full, "x"]);
  });
});

describe("刮削接口", () => {
  let app: ReturnType<typeof createTestApp>;
  let cookie: string;
  let requests: { url: string; authorization: string | null }[];
  let coverResponse: () => Response;

  const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    if (url.includes("/search?")) return Response.json({ data: [{ source: "qidian", source_book_id: "1" }, { source: "qidian", source_book_id: "2" }] });
    if (url.includes("/books?ids=")) {
      return Response.json({ data: [daoBook("1", "别人"), daoBook("2", "无名氏")].map((book) => ({ status: "found", book })) });
    }
    if (url.includes("/books/qidian/2")) return Response.json({ data: daoBook("2", "无名氏") });
    if (url.startsWith("https://img.example/")) return coverResponse();
    return Response.json({ error: { code: "not_found", status: 404 } }, { status: 404 });
  }) as typeof fetch;

  const call = (method: string, path: string, body?: unknown) =>
    app.fetchApi(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const detail = async () =>
    ((await (await call("GET", `/api/admin/books/${BOOK_ID}`)).json()) as { book: Record<string, unknown> & { tags: string[] } }).book;

  beforeEach(async () => {
    requests = [];
    coverResponse = () => new Response(PNG);
    app = createTestApp({ fetch: fakeFetch });
    cookie = await ownerCookieHeader();
    await addBook(app.deps, BOOK_ID, "归藏试读", "无名氏", [["第一章", "正文\n"]]);
    await call("PATCH", `/api/admin/books/${BOOK_ID}`, { tags: ["悬疑", "自己加的"] });
  });

  it("没有密钥时搜索与写入返回 409，不请求 DaoSearch", async () => {
    expect((await call("GET", `/api/admin/books/${BOOK_ID}/scrape/search?q=x`)).status).toBe(409);
    expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: [] })).status).toBe(409);
    expect(requests).toHaveLength(0);
  });

  describe("已填写密钥", () => {
    beforeEach(async () => {
      await call("PUT", "/api/admin/settings/scrape", { key: "ds_test_0123456789abcdef" });
    });

    it("搜索：作者与这本书一致的候选在前", async () => {
      const res = await call("GET", `/api/admin/books/${BOOK_ID}/scrape/search?q=${encodeURIComponent("归藏")}`);
      expect(res.status).toBe(200);
      const { results } = (await res.json()) as { results: ScrapedBook[] };
      expect(results.map((r) => [r.ref, r.author])).toEqual([["qidian/2", "无名氏"], ["qidian/1", "别人"]]);
      expect(results[0]).toMatchObject({ wordCount: 1000, status: "ongoing" });
    });

    it("搜索：空关键词与不存在的书", async () => {
      expect((await call("GET", `/api/admin/books/${BOOK_ID}/scrape/search?q=%20`)).status).toBe(400);
      expect((await call("GET", `/api/admin/books/22222222-2222-4222-8222-222222222222/scrape/search?q=x`)).status).toBe(404);
    });

    it("写入勾选的字段：标签合并、下载封面、记下刮削来源；封面请求不带密钥", async () => {
      const res = await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: ["intro", "tags", "cover"] });
      expect(res.status).toBe(200);
      const book = await detail();
      expect(book).toMatchObject({
        title: "归藏试读",
        author: "无名氏",
        intro: "简介2",
        coverType: "image/png",
        scrapeSource: "daosearch",
        scrapeRef: "qidian/2",
        scrapeUrl: "https://daosearch.io/qidian/book/2/x",
      });
      expect(book.scrapedAt).toBeTruthy();
      expect([...book.tags].sort()).toEqual(["悬疑", "新标签", "自己加的"].sort());
      const cover = await app.fetchApi(`/api/admin/books/${BOOK_ID}/cover`, { headers: { cookie } });
      expect(new Uint8Array(await cover.arrayBuffer())).toEqual(PNG);
      const coverRequest = requests.find((r) => r.url.startsWith("https://img.example/"));
      expect(coverRequest?.authorization).toBeNull();
    });

    it("只勾选书名时只改书名，仍记下刮削来源", async () => {
      await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: ["title"] });
      const book = await detail();
      expect(book).toMatchObject({ title: "书2", intro: "", coverKey: null, scrapeRef: "qidian/2" });
      expect([...book.tags].sort()).toEqual(["悬疑", "自己加的"].sort());
    });

    it("封面不是图片时整次写入失败，书不变", async () => {
      coverResponse = () => new Response("<html>");
      const res = await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: ["title", "cover"] });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "cover_download_failed" });
      expect(await detail()).toMatchObject({ title: "归藏试读", coverKey: null, scrapeRef: null });
    });

    it("拒绝无效的请求体；DaoSearch 找不到作品时返回 not_found", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: ["bogus"] })).status).toBe(400);
      expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { fields: [] })).status).toBe(400);
      const res = await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/404", fields: ["title"] });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "scrape_unavailable", kind: "not_found" });
      vi.restoreAllMocks();
    });
  });
});
