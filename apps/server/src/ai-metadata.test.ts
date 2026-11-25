import { DEFAULT_PROCESS_OPTIONS } from "@novarium/core/validate";
import { beforeEach, describe, expect, it } from "vitest";
import { AiError, type AiClient } from "./ai";
import { parseMetadataAnswers } from "./ai-metadata";
import { createTestApp, ownerCookieHeader } from "./test-app";

const answers = (title: unknown, author: unknown, intro: unknown) => ({
  answers: { title: { value: title, confidence: 0.6 }, author: { value: author }, intro: { value: intro } },
});

describe("解析 clairic 的回答", () => {
  it("去掉首尾空白；null、空串、非字符串、超长都当作没有建议", () => {
    expect(parseMetadataAnswers(answers(" 深海回声 ", "林间鹿", "潜水员……"))).toEqual({ title: "深海回声", author: "林间鹿", intro: "潜水员……" });
    expect(parseMetadataAnswers(answers(null, "  ", 3))).toEqual({ title: null, author: null, intro: null });
    expect(parseMetadataAnswers(answers("书".repeat(201), "人".repeat(101), "简".repeat(5001)))).toEqual({ title: null, author: null, intro: null });
    expect(parseMetadataAnswers({})).toEqual({ title: null, author: null, intro: null });
  });

  it("简介去掉每行的缩进", () => {
    expect(parseMetadataAnswers(answers("甲", "乙", "　　第一段。\n　　第二段。 \n")).intro).toBe("第一段。\n第二段。");
  });
});

describe("AI 识别元数据", () => {
  let cookie: string;
  let calls: { model: string; input: Record<string, unknown> }[];
  const fakeAi = (result: () => unknown): AiClient => ({
    mode: "binding",
    run: async (model, input) => {
      calls.push({ model, input });
      return result() as never;
    },
  });

  beforeEach(async () => {
    cookie = await ownerCookieHeader();
    calls = [];
  });

  const enable = (app: ReturnType<typeof createTestApp>) =>
    app.fetchApi("/api/admin/settings/ai", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  const suggest = (app: ReturnType<typeof createTestApp>, body: unknown) =>
    app.fetchApi("/api/admin/ai/metadata", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const sample = { fileName: "深海回声.txt", head: "《深海回声》\n作者：林间鹿\n" };

  it("把文件名和原稿开头发给 clairic，返回三项建议", async () => {
    const app = createTestApp({ ai: fakeAi(() => answers("深海回声", "林间鹿", null)) });
    await enable(app);
    const res = await suggest(app, sample);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: { title: "深海回声", author: "林间鹿", intro: null } });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.model).toBe("clairic");
    expect(call?.input.state).toBe("文件名：深海回声.txt\n文件开头：\n《深海回声》\n作者：林间鹿\n");
    expect(Object.keys(call?.input.fields as object)).toEqual(["title", "author", "intro"]);
  });

  it("未配置返回 503，未开启返回 409，都不调用 AI", async () => {
    expect((await suggest(createTestApp(), sample)).status).toBe(503);
    const app = createTestApp({ ai: fakeAi(() => answers("a", "b", "c")) });
    expect(await (await suggest(app, sample)).json()).toEqual({ error: "ai_disabled" });
    expect(calls).toHaveLength(0);
  });

  it("拒绝过长或缺少字段的请求", async () => {
    const app = createTestApp({ ai: fakeAi(() => answers("a", "b", "c")) });
    await enable(app);
    expect((await suggest(app, { fileName: "a.txt", head: "字".repeat(4001) })).status).toBe(400);
    expect((await suggest(app, { head: "x" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("AI 失败时返回 502 与失败类型", async () => {
    const app = createTestApp({
      ai: fakeAi(() => {
        throw new AiError("quota", "3036");
      }),
    });
    await enable(app);
    const res = await suggest(app, sample);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable", kind: "quota" });
    const odd = createTestApp({ ai: fakeAi(() => ({})) });
    await enable(odd);
    expect(await (await suggest(odd, sample)).json()).toEqual({ error: "ai_unavailable", kind: "unavailable" });
  });
});

describe("导入时保存简介", () => {
  it("新书带简介；简介超长时拒绝", async () => {
    const app = createTestApp();
    const cookie = await ownerCookieHeader();
    const text = new TextEncoder().encode("第一章 甲\n正文。\n");
    const put = (path: string) =>
      app.fetchApi(path, { method: "PUT", headers: { cookie, "content-length": String(text.byteLength) }, body: text as Uint8Array<ArrayBuffer> });
    const create = async (intro: string) => {
      const id = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      await put(`/api/admin/books/${id}/original`);
      await put(`/api/admin/books/${id}/versions/${versionId}/text`);
      const res = await app.fetchApi("/api/admin/books", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          id,
          versionId,
          title: "甲",
          intro,
          originalName: "甲.txt",
          options: DEFAULT_PROCESS_OPTIONS,
          chapters: [{ order: 0, title: "第一章 甲", number: 1, byteOffset: 0, byteLength: text.byteLength }],
        }),
      });
      return { id, res };
    };
    const ok = await create("  一段简介。 ");
    expect(ok.res.status).toBe(201);
    const detail = (await (await app.fetchApi(`/api/admin/books/${ok.id}`, { headers: { cookie } })).json()) as { book: { intro: string } };
    expect(detail.book.intro).toBe("一段简介。");
    expect((await create("简".repeat(5001))).res.status).toBe(400);
  });
});
