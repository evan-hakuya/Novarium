import { beforeEach, describe, expect, it } from "vitest";
import { AiError, createAiClient, createBindingAiClient, createRestAiClient, type AiClient } from "./ai";
import { createTestApp, ownerCookieHeader } from "./test-app";

const okClef = { answers: { q: { choice: "yes", confidence: 0.9 } }, usage: { input_tokens: 20 } };

function restFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiError) return error.kind;
    throw error;
  }
  throw new Error("expected AiError");
}

describe("Workers AI 客户端", () => {
  it("没有绑定也没有账户 ID 与令牌时不创建客户端", () => {
    expect(createAiClient({})).toBeNull();
    expect(createAiClient({ accountId: "acc" })).toBeNull();
    expect(createAiClient({ accountId: "acc", token: "t" })?.mode).toBe("rest");
    expect(createAiClient({ binding: { run: async () => okClef } })?.mode).toBe("binding");
  });

  it("REST：带令牌请求模型地址，返回 result", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = createRestAiClient({ accountId: "acc", token: "secret", fetch: restFetch(200, { success: true, result: okClef, errors: [] }, seen) });
    expect(await client.run("clef", { state: "x" })).toEqual(okClef);
    expect(seen.url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef");
    expect((seen.init?.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(String(seen.init?.body))).toEqual({ state: "x" });
  });

  it("REST：额度用完、容量不足、超时、其他错误分别归类", async () => {
    const fail = (status: number, code: number) =>
      createRestAiClient({ accountId: "a", token: "t", fetch: restFetch(status, { success: false, errors: [{ code, message: "m" }] }) }).run("clef", {});
    expect(await kindOf(fail(429, 3036))).toBe("quota");
    expect(await kindOf(fail(429, 3040))).toBe("busy");
    expect(await kindOf(fail(408, 3007))).toBe("timeout");
    expect(await kindOf(fail(403, 5035))).toBe("unavailable");
    expect(await kindOf(fail(401, 10000))).toBe("unavailable");
  });

  it("REST：请求超时与网络错误", async () => {
    const hang = (async (_url: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
    expect(await kindOf(createRestAiClient({ accountId: "a", token: "t", fetch: hang, timeoutMs: 10 }).run("clef", {}))).toBe("timeout");
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await kindOf(createRestAiClient({ accountId: "a", token: "t", fetch: down }).run("clef", {}))).toBe("unavailable");
  });

  it("绑定：按错误文字中的错误码归类，并有超时", async () => {
    const throwing = (message: string) => createBindingAiClient({ run: async () => Promise.reject(new Error(message)) });
    expect(await kindOf(throwing("3036: You have used up your daily free allocation of 10,000 neurons.").run("clef", {}))).toBe("quota");
    expect(await kindOf(throwing("InferenceUpstreamError: 3040: Capacity temporarily exceeded").run("clef", {}))).toBe("busy");
    expect(await kindOf(throwing("boom").run("clef", {}))).toBe("unavailable");
    const slow = createBindingAiClient({ run: () => new Promise(() => {}) }, 10);
    expect(await kindOf(slow.run("clef", {}))).toBe("timeout");
  });

  it("绑定：模型名带 @cf/cloudflare/ 前缀", async () => {
    let model = "";
    await createBindingAiClient({ run: async (m) => ((model = m), okClef) }).run("clairic", {});
    expect(model).toBe("@cf/cloudflare/clairic");
  });
});

describe("AI 设置", () => {
  let cookie: string;
  const fakeAi = (run: AiClient["run"]): AiClient => ({ mode: "binding", run });

  beforeEach(async () => {
    cookie = await ownerCookieHeader();
  });

  const get = (app: ReturnType<typeof createTestApp>) =>
    app.fetchApi("/api/admin/settings/ai", { headers: { cookie } }).then((r) => r.json() as Promise<{ enabled: boolean }>);
  const put = (app: ReturnType<typeof createTestApp>, body: unknown) =>
    app.fetchApi("/api/admin/settings/ai", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const check = (app: ReturnType<typeof createTestApp>) => app.fetchApi("/api/admin/settings/ai/check", { method: "POST", headers: { cookie } });

  it("未配置时显示未配置，不能开启，也不能测试", async () => {
    const app = createTestApp();
    expect(await get(app)).toEqual({ configured: false, mode: null, enabled: false });
    expect((await put(app, { enabled: true })).status).toBe(503);
    expect((await check(app)).status).toBe(503);
  });

  it("已配置时默认关闭，可以开启与关闭", async () => {
    const app = createTestApp({ ai: fakeAi(async () => okClef as never) });
    expect(await get(app)).toEqual({ configured: true, mode: "binding", enabled: false });
    expect((await put(app, { enabled: true })).status).toBe(200);
    expect(await get(app)).toEqual({ configured: true, mode: "binding", enabled: true });
    expect((await put(app, { enabled: false })).status).toBe(200);
    expect((await get(app)).enabled).toBe(false);
    expect((await put(app, { enabled: "yes" })).status).toBe(400);
  });

  it("测试连接：成功返回调用方式；额度用完返回 502 与 kind", async () => {
    const ok = createTestApp({ ai: fakeAi(async () => okClef as never) });
    expect(await (await check(ok)).json()).toEqual({ ok: true, mode: "binding" });
    const quota = createTestApp({
      ai: fakeAi(async () => {
        throw new AiError("quota", "3036: used up");
      }),
    });
    const res = await check(quota);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable", kind: "quota" });
    const odd = createTestApp({ ai: fakeAi(async () => ({}) as never) });
    expect(await (await check(odd)).json()).toEqual({ error: "ai_unavailable", kind: "unavailable" });
  });

  it("需要所有者登录", async () => {
    const app = createTestApp({ ai: fakeAi(async () => okClef as never) });
    expect((await app.fetchApi("/api/admin/settings/ai")).status).toBe(401);
    expect((await app.fetchApi("/api/admin/settings/ai/check", { method: "POST" })).status).toBe(401);
  });
});
