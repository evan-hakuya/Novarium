import { beforeEach, describe, expect, it } from "vitest";
import { AiError, type AiClient } from "./ai";
import { buildClefInput, parseClefAnswers, type LineQuestion } from "./ai-lines";
import { createTestApp, ownerCookieHeader } from "./test-app";

const q = (id: string, line: string, extra: Partial<LineQuestion> = {}): LineQuestion => ({ id, prev: "", line, next: "　　正文。", gap: false, ...extra });

describe("clef 题目", () => {
  it("每题写出上一行、本行与下一个非空行；空行与全角空格按约定显示", () => {
    const input = buildClefInput([q("0|请假条", "请假条", { prev: "　　上一段。", gap: true })]);
    const question = (input.questions as Record<string, { instructions: string; type: string; criteria: object }>).L0!;
    expect(question.type).toBe("choice");
    expect(question.instructions).toBe("判断这一行属于哪一类。上一行：␣␣上一段。；本行：「请假条」；下一个非空行：(空行) ␣␣正文。");
    expect(Object.keys(question.criteria)).toEqual(["chapter", "volume", "notice", "body"]);
    expect(buildClefInput([q("a", "x")]).questions.L0!.instructions).toContain("上一行：(空行)");
  });

  it("只返回有效的回答", () => {
    const questions = [q("a", "甲"), q("b", "乙"), q("c", "丙")];
    const result = { answers: { L0: { choice: "notice", confidence: 0.93 }, L1: { choice: "other", confidence: 0.9 }, L2: { choice: "body" } } };
    expect(parseClefAnswers(questions, result)).toEqual({ a: { kind: "notice", confidence: 0.93 } });
  });
});

describe("AI 复核章节接口", () => {
  let cookie: string;
  let inputs: Record<string, unknown>[];
  const fakeAi = (result: () => unknown): AiClient => ({
    mode: "binding",
    run: async (_model, input) => {
      inputs.push(input);
      return result() as never;
    },
  });
  const post = (app: ReturnType<typeof createTestApp>, body: unknown) =>
    app.fetchApi("/api/admin/ai/lines", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const enable = (app: ReturnType<typeof createTestApp>) =>
    app.fetchApi("/api/admin/settings/ai", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });

  beforeEach(async () => {
    cookie = await ownerCookieHeader();
    inputs = [];
  });

  it("判断一批候选行，按 id 返回类别与置信度", async () => {
    const app = createTestApp({ ai: fakeAi(() => ({ answers: { L0: { choice: "chapter", confidence: 0.99 }, L1: { choice: "notice", confidence: 0.6 } } })) });
    await enable(app);
    const res = await post(app, { questions: [q("0|第一章", "第一章"), q("0|请假", "请假")] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: { "0|第一章": { kind: "chapter", confidence: 0.99 }, "0|请假": { kind: "notice", confidence: 0.6 } } });
    expect(inputs).toHaveLength(1);
  });

  it("拒绝空批次、超过 64 题、重复 id 与过长的行", async () => {
    const app = createTestApp({ ai: fakeAi(() => ({ answers: {} })) });
    await enable(app);
    expect((await post(app, { questions: [] })).status).toBe(400);
    expect((await post(app, { questions: Array.from({ length: 65 }, (_, i) => q(`${i}`, "甲")) })).status).toBe(400);
    expect((await post(app, { questions: [q("a", "甲"), q("a", "乙")] })).status).toBe(400);
    expect((await post(app, { questions: [q("a", "甲".repeat(201))] })).status).toBe(400);
    expect((await post(app, { questions: [q("a", "  ")] })).status).toBe(400);
    expect(inputs).toHaveLength(0);
  });

  it("未开启返回 409；AI 失败返回 502 与类型", async () => {
    const off = createTestApp({ ai: fakeAi(() => ({ answers: {} })) });
    expect(await (await post(off, { questions: [q("a", "甲")] })).json()).toEqual({ error: "ai_disabled" });
    const busy = createTestApp({
      ai: fakeAi(() => {
        throw new AiError("busy", "3040");
      }),
    });
    await enable(busy);
    const res = await post(busy, { questions: [q("a", "甲")] });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai_unavailable", kind: "busy" });
  });
});
