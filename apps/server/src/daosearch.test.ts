import { describe, expect, it } from "vitest";
import { createDaoSearchSource, DAOSEARCH_BASE, DAOSEARCH_USER_AGENT } from "./daosearch";
import { ScrapeError } from "./scrape";

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

  it("搜索后批量读取详情，返回与站点无关的结构，合并的重复作品只保留一次", async () => {
    const other = { ...book, source: "qimao", source_book_id: "77", url: "https://daosearch.io/book/qimao/77", status: "paused", released: null };
    const { calls, doFetch } = fakeFetch((url) =>
      url.includes("/search?")
        ? json(200, { data: [{ source: "qidian", source_book_id: "1010868264" }, { source: "qidian", source_book_id: "1" }, { source: "qimao", source_book_id: "77" }, { source: "fanqie", source_book_id: "9" }] })
        : json(200, {
            data: [
              { id: "qidian:1010868264", status: "found", book },
              { id: "qidian:1", status: "moved", book },
              { id: "qimao:77", status: "found", book: other },
              { id: "fanqie:9", status: "not_found", book: null },
            ],
          }),
    );
    const results = await createDaoSearchSource(KEY, doFetch).search("诡秘 之主");
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("诡秘 之主");
    expect(new URL(calls[1]!.url).searchParams.get("ids")).toBe("qidian:1010868264,qidian:1,qimao:77,fanqie:9");
    expect(results).toEqual([scraped, { ...scraped, ref: "qimao/77", url: other.url, platform: "qimao", status: null, releasedAt: null }]);
  });

  it("没有搜索结果时不再批量读取", async () => {
    const { calls, doFetch } = fakeFetch(() => json(200, { data: [] }));
    expect(await createDaoSearchSource(KEY, doFetch).search("不存在")).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("补全详情的批量读取失败时，整次搜索按错误归类", async () => {
    const { doFetch } = fakeFetch((url) =>
      url.includes("/search?")
        ? json(200, { data: [{ source: "qidian", source_book_id: "1" }] })
        : apiError(429, "quota_exceeded", { "retry-after": "600" }),
    );
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
    const error = await scrapeError(createDaoSearchSource(KEY, hanging, 20).check());
    expect(error.kind).toBe("network");
    expect(error.message).toContain("timed out");
  });
});
