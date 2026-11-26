import { beforeEach, describe, expect, it, vi } from "vitest";
import { maskKey } from "./scrape-routes";
import { createTestApp, ownerCookieHeader } from "./test-app";

const KEY = "ds_test_0123456789abcdef";

describe("刮削设置", () => {
  let responses: Response[];
  let sent: { url: string; authorization: string | null }[];
  let app: ReturnType<typeof createTestApp>;
  let cookie: string;

  const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    sent.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    const next = responses.shift();
    if (!next) throw new Error("unexpected DaoSearch request");
    return next;
  }) as typeof fetch;

  const call = (method: string, path: string, body?: unknown) =>
    app.fetchApi(`/api/admin/settings/scrape${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeEach(async () => {
    responses = [];
    sent = [];
    app = createTestApp({ fetch: fakeFetch });
    cookie = await ownerCookieHeader();
  });

  it("未填写密钥时为未配置，测试连接返回 409", async () => {
    expect(await (await call("GET", "")).json()).toEqual({ configured: false, source: "daosearch", keyHint: null });
    expect((await call("POST", "/check")).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it("填写、替换、清除密钥；响应只含前后几位", async () => {
    let res = await call("PUT", "", { key: `  ${KEY}  ` });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({ configured: true, source: "daosearch", keyHint: "ds_t…cdef" });

    res = await call("PUT", "", { key: "ds_other_key_9999" });
    expect(((await res.json()) as { keyHint: string }).keyHint).toBe("ds_o…9999");

    res = await call("DELETE", "");
    expect(await res.json()).toEqual({ configured: false, source: "daosearch", keyHint: null });
  });

  it("拒绝空密钥与含空白的密钥", async () => {
    expect((await call("PUT", "", { key: "  " })).status).toBe(400);
    expect((await call("PUT", "", { key: "ab cd" })).status).toBe(400);
    expect((await call("PUT", "", {})).status).toBe(400);
  });

  it("测试连接返回当天剩余点数", async () => {
    await call("PUT", "", { key: KEY });
    responses.push(Response.json({ data: { used: 12, limit: 1000, remaining: 988, resets_at: "2026-11-27T00:00:00Z" } }));
    const res = await call("POST", "/check");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, quota: { remaining: 988, limit: 1000, resetsAt: "2026-11-27T00:00:00Z" } });
    expect(sent).toEqual([{ url: "https://daosearch.io/api/v1/limits/me", authorization: `Bearer ${KEY}` }]);
  });

  it("无效密钥与限流转成可读的错误，日志不含密钥", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await call("PUT", "", { key: KEY });
    responses.push(Response.json({ error: { code: "invalid_key", status: 401, message: "…" } }, { status: 401 }));
    let res = await call("POST", "/check");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "scrape_unavailable", kind: "invalid_key" });

    responses.push(Response.json({ error: { code: "rate_limited", status: 429, message: "…" } }, { status: 429, headers: { "retry-after": "30" } }));
    res = await call("POST", "/check");
    expect(res.status).toBe(502);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.json()).toEqual({ error: "scrape_unavailable", kind: "rate_limited", retryAfterSeconds: 30 });

    expect(warn).toHaveBeenCalled();
    for (const args of warn.mock.calls) expect(String(args)).not.toContain(KEY);
    warn.mockRestore();
  });

  it("需要所有者登录", async () => {
    expect((await app.fetchApi("/api/admin/settings/scrape")).status).toBe(401);
  });

  it("太短的密钥全部隐藏", () => {
    expect(maskKey("short")).toBe("…");
  });
});
