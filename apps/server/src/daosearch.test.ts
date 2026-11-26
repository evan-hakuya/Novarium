import { describe, expect, it } from "vitest";
import { createDaoSearchSource, DAOSEARCH_BASE, DAOSEARCH_CACHE_MS, DAOSEARCH_USER_AGENT } from "./daosearch";
import { ScrapeError, type ScrapeCache } from "./scrape";

// 测试不调用真实的 DaoSearch，用假的 fetch 返回模拟响应。

type Call = { url: string; headers: Headers };

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const doFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    return respond(url);
  }) as typeof fetch;
  return { calls, doFetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const apiError = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { error: { code, status, message: "…", docs_url: "https://daosearch.io/developers#errors" } }, headers);

const KEY = "ds_test_0123456789abcdef";

const book = {
  source: "qidian",
  source_book_id: "1010868264",
  url: "https://daosearch.io/book/qidian/1010868264",
  title: { en: "Lord of the Mysteries", zh: "诡秘之主" },
  author: { en: null, zh: "爱潜水的乌贼" },
  cover_url: "https://daosearch.io/covers/1.jpg",
  synopsis_zh: "蒸汽与机械的浪潮中……",
  tags: [{ en: "Mystery", zh: "悬疑" }, { en: null, zh: "克苏鲁" }],
  word_count: 4465000,
  status: "completed",
  released: { date: "2018-04-01", precision: "day", estimated: false },
};

const scraped = {
  ref: "qidian/1010868264",
  url: book.url,
  title: "诡秘之主",
  author: "爱潜水的乌贼",
  intro: book.synopsis_zh,
  tags: ["悬疑", "克苏鲁"],
  coverUrl: book.cover_url,
  platform: "qidian",
  wordCount: 4465000,
  status: "completed",
  releasedAt: "2018-04-01",
};

async function scrapeError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ScrapeError);
  return error as ScrapeError;
}

describe("DaoSearch 刮削源", () => {
  it("请求带 Bearer 密钥与写明 Novarium 的 User-Agent，密钥不在 URL 中", async () => {
    const { calls, doFetch } = fakeFetch(() => json(200, { data: { used: 12, limit: 1000, remaining: 988, resets_at: "2026-11-27T00:00:00Z" } }));
    const quota = await createDaoSearchSource(KEY, doFetch).check();
    expect(quota).toEqual({ remaining: 988, limit: 1000, resetsAt: "2026-11-27T00:00:00Z" });
    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    expect(call.url).toBe(`${DAOSEARCH_BASE}/limits/me`);
    expect(call.url).not.toContain(KEY);
    expect(call.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(call.headers.get("user-agent")).toBe(DAOSEARCH_USER_AGENT);
  });

  it("搜索只调用 /search，返回候选，不读取详情", async () => {
    const { url, title, author, cover_url, source, source_book_id } = book;
    const { calls, doFetch } = fakeFetch(() => json(200, { data: [{ source, source_book_id, url, title, author, cover_url }] }));
    const results = await createDaoSearchSource(KEY, doFetch).search("诡秘 之主");
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("诡秘 之主");
    expect(results).toEqual([{ ref: scraped.ref, url, title: "诡秘之主", author: "爱潜水的乌贼", coverUrl: cover_url, platform: "qidian" }]);
  });

  it("搜索失败时按错误归类", async () => {
    const { doFetch } = fakeFetch(() => apiError(429, "quota_exceeded", { "retry-after": "600" }));
    const error = await scrapeError(createDaoSearchSource(KEY, doFetch).search("诡秘"));
    expect(error.kind).toBe("quota");
    expect(error.retryAfterSeconds).toBe(600);
  });

  it("按 ID 读取作品，取中文的书名、作者、简介与标签", async () => {
    const { calls, doFetch } = fakeFetch(() => json(200, { data: book }));
    const result = await createDaoSearchSource(KEY, doFetch).getBook("qidian/1010868264");
    expect(calls[0]!.url).toBe(`${DAOSEARCH_BASE}/books/qidian/1010868264`);
    expect(result).toEqual(scraped);
  });

  it("拒绝格式不对的作品 ID，不发请求", async () => {
    const { calls, doFetch } = fakeFetch(() => json(200, { data: book }));
    const source = createDaoSearchSource(KEY, doFetch);
    for (const ref of ["", "qidian", "qidian/", "unknown/1", "qidian/1/../x", "qidian/..", "qidian/.", "qidian/1?x=1"]) {
      expect((await scrapeError(source.getBook(ref))).kind).toBe("not_found");
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    [apiError(401, "invalid_key"), "invalid_key", undefined],
    [apiError(403, "revoked_key"), "invalid_key", undefined],
    [apiError(429, "rate_limited", { "retry-after": "12" }), "rate_limited", 12],
    [apiError(429, "quota_exceeded", { "retry-after": "3600" }), "quota", 3600],
    [apiError(404, "not_found"), "not_found", undefined],
    [apiError(503, "api_disabled"), "unavailable", undefined],
    [new Response("<html>bad gateway</html>", { status: 502 }), "unavailable", undefined],
    [json(200, { nothing: true }), "unavailable", undefined],
  ] as const)("错误响应 %# 归类为 %s", async (response, kind, retryAfter) => {
    const { doFetch } = fakeFetch(() => response.clone());
    const error = await scrapeError(createDaoSearchSource(KEY, doFetch).check());
    expect(error.kind).toBe(kind);
    expect(error.retryAfterSeconds).toBe(retryAfter);
    expect(error.message).not.toContain(KEY);
  });

  it("网络错误与超时归类为 network", async () => {
    const failing = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect((await scrapeError(createDaoSearchSource(KEY, failing.doFetch).check())).kind).toBe("network");

    const hanging = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    const error = await scrapeError(createDaoSearchSource(KEY, hanging, { timeoutMs: 20 }).check());
    expect(error.kind).toBe("network");
    expect(error.message).toContain("timed out");
  });
});

describe("DaoSearch 响应缓存", () => {
  function memoryCache() {
    const rows = new Map<string, { etag: string | null; data: unknown; fetchedAt: number; usedAt: number }>();
    let clock = 1_000_000;
    const cache: ScrapeCache = {
      async get(key) {
        const row = rows.get(key);
        return row ? { etag: row.etag, data: row.data, fetchedAt: row.fetchedAt } : null;
      },
      async put(key, etag, data) {
        rows.set(key, { etag, data, fetchedAt: clock, usedAt: clock });
      },
      async touch(key, revalidated) {
        const row = rows.get(key)!;
        row.usedAt = clock;
        if (revalidated) row.fetchedAt = clock;
      },
    };
    return { rows, cache, now: () => clock, advance: (ms: number) => (clock += ms) };
  }
  const PATH = "/books/qidian/1010868264";

  it("缓存未过期时不发请求", async () => {
    const mem = memoryCache();
    const { calls, doFetch } = fakeFetch(() => json(200, { data: book }, { etag: '"v1"' }));
    const source = createDaoSearchSource(KEY, doFetch, { cache: mem.cache, now: mem.now });
    expect(await source.getBook(scraped.ref)).toEqual(scraped);
    mem.advance(DAOSEARCH_CACHE_MS - 1);
    expect(await source.getBook(scraped.ref)).toEqual(scraped);
    expect(calls).toHaveLength(1);
    expect(mem.rows.get(PATH)?.etag).toBe('"v1"');
    expect(mem.rows.get(PATH)?.usedAt).toBe(mem.now());
  });

  it("过期后带 ETag 重新验证，304 时继续用缓存并刷新取得时间", async () => {
    const mem = memoryCache();
    let status = 200;
    const { calls, doFetch } = fakeFetch(() => (status === 304 ? new Response(null, { status: 304 }) : json(200, { data: book }, { etag: '"v1"' })));
    const source = createDaoSearchSource(KEY, doFetch, { cache: mem.cache, now: mem.now });
    await source.getBook(scraped.ref);
    status = 304;
    mem.advance(DAOSEARCH_CACHE_MS);
    expect(await source.getBook(scraped.ref)).toEqual(scraped);
    expect(calls[1]!.headers.get("if-none-match")).toBe('"v1"');
    expect(mem.rows.get(PATH)?.fetchedAt).toBe(mem.now());
  });

  it("过期后返回 200 时替换缓存", async () => {
    const mem = memoryCache();
    let version = 1;
    const { doFetch } = fakeFetch(() => json(200, { data: { ...book, word_count: version } }, { etag: `"v${version}"` }));
    const source = createDaoSearchSource(KEY, doFetch, { cache: mem.cache, now: mem.now });
    await source.getBook(scraped.ref);
    version = 2;
    mem.advance(DAOSEARCH_CACHE_MS);
    expect((await source.getBook(scraped.ref)).wordCount).toBe(2);
    expect(mem.rows.get(PATH)?.etag).toBe('"v2"');
  });

  it("出错时不写缓存", async () => {
    const mem = memoryCache();
    const { doFetch } = fakeFetch(() => apiError(503, "api_disabled"));
    const source = createDaoSearchSource(KEY, doFetch, { cache: mem.cache, now: mem.now });
    expect((await scrapeError(source.getBook(scraped.ref))).kind).toBe("unavailable");
    expect((await scrapeError(source.search("诡秘"))).kind).toBe("unavailable");
    expect(mem.rows.size).toBe(0);
  });

  it("测试连接不走缓存", async () => {
    const mem = memoryCache();
    const { calls, doFetch } = fakeFetch(() => json(200, { data: { used: 0, limit: 2000, remaining: 2000, resets_at: "x" } }));
    const source = createDaoSearchSource(KEY, doFetch, { cache: mem.cache, now: mem.now });
    await source.check();
    await source.check();
    expect(calls).toHaveLength(2);
    expect(mem.rows.size).toBe(0);
  });
});
