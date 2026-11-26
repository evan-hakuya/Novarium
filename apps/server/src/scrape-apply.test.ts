import { describe, expect, it, beforeEach, vi } from "vitest";
import { mergeTags, rankByAuthor } from "./scrape-routes";
import type { ScrapeCandidate, ScrapedBook } from "./scrape";
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
  released: { date: "2019-05", precision: "month", estimated: true },
  genre: { en: null, zh: "玄幻" },
  subgenre: { en: null, zh: "异世大陆" },
  other_names: [{ name: "旧名", name_translated: null }, { name: "自己加的别名", name_translated: null }],
  updated_at: "2025-08-14T01:00:00Z",
  facets: [{ key: "signed", label: "Signed", value: "true", value_label: "Signed" }],
  mature: true,
  source_url: `https://www.qidian.com/book/${id}/`,
  also_on: [{ source: "zongheng", source_book_id: "9", url: "https://daosearch.io/zongheng/book/9/x" }],
  metrics: [{ key: "monthly_votes", label: "Monthly votes", value: Number(id) * 100, period: "month" }],
  rankings: [],
  source_comment_count: 12,
  booklist_count: null,
  pace: null,
  availability: { state: "available", since: null },
  refreshed_at: "2026-11-24T10:25:11Z",
});

const candidate = (ref: string, author: string | null) => ({ ref, author }) as ScrapeCandidate;

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
    if (url.includes("/search?")) return Response.json({ data: [daoBook("1", "别人"), daoBook("2", "无名氏")] });
    if (url.endsWith("/sources")) return Response.json({ data: [{ source: "qidian", score_scale: null, metrics: [{ key: "monthly_votes", zh: "月票" }] }] });
    if (url.includes("/books/qidian/2")) return Response.json({ data: daoBook("2", "无名氏") });
    // 作品 ID 被合并：fetch 跟随 301 后拿到新 ID 的作品。
    if (url.includes("/books/qidian/old2")) return Response.json({ data: daoBook("2", "无名氏") });
    // 源站资料被删掉的作品：只读字段都为空；别名里有书名。
    if (url.includes("/books/qidian/3")) {
      return Response.json({
        data: {
          ...daoBook("3", "无名氏"),
          other_names: [{ name: "书2", name_translated: null }, { name: "别名3", name_translated: null }],
          word_count: null,
          released: null,
          updated_at: null,
          facets: [],
          mature: null,
          source_url: null,
          also_on: [],
        },
      });
    }
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

  it("没有密钥时搜索、详情与写入返回 409，不请求 DaoSearch", async () => {
    expect((await call("GET", "/api/admin/scrape/search?q=x")).status).toBe(409);
    expect((await call("GET", "/api/admin/scrape/books?ref=qidian/2")).status).toBe(409);
    expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: [] })).status).toBe(409);
    expect(requests).toHaveLength(0);
  });

  describe("已填写密钥", () => {
    beforeEach(async () => {
      await call("PUT", "/api/admin/settings/scrape", { key: "ds_test_0123456789abcdef" });
    });

    it("搜索：作者一致的候选在前，只返回候选字段，只请求一次 DaoSearch", async () => {
      const res = await call("GET", `/api/admin/scrape/search?q=${encodeURIComponent("归藏")}&author=${encodeURIComponent("无名氏")}`);
      expect(res.status).toBe(200);
      const { results } = (await res.json()) as { results: ScrapeCandidate[] };
      expect(results.map((r) => [r.ref, r.author])).toEqual([["qidian/2", "无名氏"], ["qidian/1", "别人"]]);
      expect(results[0]).not.toHaveProperty("wordCount");
      expect(requests).toHaveLength(1);
    });

    it("搜索与详情：空参数返回 400", async () => {
      expect((await call("GET", "/api/admin/scrape/search?q=%20")).status).toBe(400);
      expect((await call("GET", "/api/admin/scrape/books?ref=")).status).toBe(400);
    });

    it("相同的搜索与详情命中缓存；写入时读取详情也命中缓存", async () => {
      const q = `/api/admin/scrape/search?q=${encodeURIComponent("归藏")}`;
      await call("GET", q);
      await call("GET", q);
      const res = await call("GET", "/api/admin/scrape/books?ref=qidian/2");
      expect(res.status).toBe(200);
      const { book } = (await res.json()) as { book: ScrapedBook };
      expect(book).toMatchObject({ ref: "qidian/2", intro: "简介2", wordCount: 1000, status: "ongoing" });
      await call("GET", "/api/admin/scrape/books?ref=qidian/2");
      await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: ["title"] });
      expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/api/v1/search", "/api/v1/books/qidian/2", "/api/v1/sources"]);
    });

    it("每次刮削都整体替换快照，不论勾选了哪些项", async () => {
      await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: [] });
      expect((await detail()).snapshot).toMatchObject({
        metrics: [{ key: "monthly_votes", label: "月票", value: 200, period: "month" }],
        commentCount: 12,
        availability: { state: "available", since: null },
      });
      await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/3", fields: [] });
      expect((await detail()).snapshot).toMatchObject({ metrics: [{ value: 300 }] });
    });

    it("作品 ID 被合并时，记下新的作品 ID", async () => {
      expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/old2", fields: [] })).status).toBe(200);
      expect(await detail()).toMatchObject({ scrapeRef: "qidian/2" });
    });

    it("作品不存在时提示 not_found，保留现有数据与快照", async () => {
      await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields: ["title"] });
      const before = await detail();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/404", fields: ["title"] });
      vi.restoreAllMocks();
      expect(await res.json()).toEqual({ error: "scrape_unavailable", kind: "not_found" });
      const after = await detail();
      expect(after).toMatchObject({ title: "书2", scrapeRef: "qidian/2", snapshot: before.snapshot, scrapedAt: before.scrapedAt });
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
      expect(book).toMatchObject({ genre: null, sourceWordCount: null, aliases: [], mature: null });
    });

    it("写入描述字段：别名合并进现有别名，只读字段取刮削结果", async () => {
      await call("PATCH", `/api/admin/books/${BOOK_ID}`, { aliases: ["自己加的别名"] });
      const fields = ["genre", "subgenre", "status", "aliases", "authorEn", "wordCount", "released", "sourceUpdatedAt", "facets", "mature", "sourceUrl", "alsoOn"];
      expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields })).status).toBe(200);
      expect(await detail()).toMatchObject({
        genre: "玄幻",
        subgenre: "异世大陆",
        serialStatus: "ongoing",
        aliases: ["自己加的别名", "旧名"],
        authorEn: null,
        sourceWordCount: 1000,
        released: { date: "2019-05", precision: "month", estimated: true },
        sourceUpdatedAt: "2025-08-14T01:00:00.000Z",
        facets: [{ key: "signed", label: "Signed", value: "Signed" }],
        mature: true,
        sourceUrl: "https://www.qidian.com/book/2/",
        alsoOn: [{ platform: "zongheng", url: "https://daosearch.io/zongheng/book/9/x" }],
      });
    });

    it("再次刮削时，刮削结果为空的只读字段被清空；别名不含现在与新写入的书名", async () => {
      const fields = ["title", "aliases", "wordCount", "released", "sourceUpdatedAt", "facets", "mature", "sourceUrl", "alsoOn"];
      await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/2", fields });
      expect(await detail()).toMatchObject({ sourceWordCount: 1000, mature: true });
      expect((await call("POST", `/api/admin/books/${BOOK_ID}/scrape`, { ref: "qidian/3", fields })).status).toBe(200);
      expect(await detail()).toMatchObject({
        title: "书3",
        aliases: ["旧名", "自己加的别名", "别名3"],
        sourceWordCount: null,
        released: null,
        sourceUpdatedAt: null,
        facets: null,
        mature: null,
        sourceUrl: null,
        alsoOn: null,
      });
    });

    it("所有者编辑分类、子分类、连载状态与别名；拒绝无效值", async () => {
      const ok = await call("PATCH", `/api/admin/books/${BOOK_ID}`, { genre: " 都市 ", subgenre: "", serialStatus: "completed", aliases: [" 甲 ", "甲", "乙"] });
      expect(ok.status).toBe(200);
      expect(await detail()).toMatchObject({ genre: "都市", subgenre: null, serialStatus: "completed", aliases: ["甲", "乙"] });
      expect((await call("PATCH", `/api/admin/books/${BOOK_ID}`, { serialStatus: null })).status).toBe(200);
      expect(await detail()).toMatchObject({ serialStatus: null });
      for (const body of [{ genre: 1 }, { genre: "长".repeat(51) }, { serialStatus: "paused" }, { aliases: "甲" }, { aliases: Array(21).fill(0).map((_, i) => `a${i}`) }]) {
        expect((await call("PATCH", `/api/admin/books/${BOOK_ID}`, body)).status).toBe(400);
      }
    });

    it.each([
      ["不是图片", () => new Response("<html>")],
      ["404", () => new Response(PNG, { status: 404 })],
      ["声明超过 5 MB", () => new Response(PNG, { headers: { "content-length": String(6 * 1024 * 1024) } })],
      ["实际超过 5 MB", () => new Response(new Uint8Array(5 * 1024 * 1024 + 1).fill(0x89))],
      ["网络错误", (): Response => {
        throw new TypeError("fetch failed");
      }],
    ])("封面%s时整次写入失败，书不变", async (_name, response) => {
      coverResponse = response;
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
