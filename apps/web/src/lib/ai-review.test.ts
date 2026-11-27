import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESS_OPTIONS, findCandidateLines, splitChapters, type ProcessOptions } from "@novarium/core";
import {
  autoApply,
  fixAiLines,
  ignoreAiLines,
  reviewAiLines,
  undoAllAiFixes,
  unfixAiLines,
  unignoreAiLines,
  unjudgedCandidates,
  type AiResult,
} from "./ai-review";

const text = ["第一章 开端", "　　正文。", "请假条", "　　停更一天。", "第二章 继续", "　　正文。", "番外篇", "　　正文。"].join("\n");
const base: ProcessOptions = { ...DEFAULT_PROCESS_OPTIONS };

function setup(options: ProcessOptions, results: Record<string, AiResult>) {
  const candidates = findCandidateLines(text, options);
  const chapters = splitChapters(text, options);
  const map = new Map(Object.entries(results));
  return { candidates, chapters, map, items: reviewAiLines(candidates, chapters, options, map) };
}

describe("AI 复核条目", () => {
  it("与规则一致时不生成条目；不一致时待处理，包括把正文判为作者公告", () => {
    const { items } = setup(base, {
      "0|第一章 开端": { kind: "chapter", confidence: 0.99 },
      "0|请假条": { kind: "notice", confidence: 0.9 },
      "0|第二章 继续": { kind: "body", confidence: 0.4 },
      "0|番外篇": { kind: "notice", confidence: 0.95 },
    });
    expect(items.map((i) => [i.ai.text, i.status, i.ai.kind, i.ai.suggested, i.ai.order])).toEqual([
      ["请假条", "pending", "notice", "notice", 0],
      ["第二章 继续", "pending", "aiLine", "body", 1],
      ["番外篇", "pending", "notice", "notice", 2],
    ]);
  });

  it("置信度不低于 0.8 的不一致判断自动采用，作者公告也一样；低置信度的不自动采用", () => {
    const { candidates, map } = setup(base, {
      "0|第二章 继续": { kind: "body", confidence: 0.85 },
      "0|请假条": { kind: "chapter", confidence: 0.5 },
      "0|番外篇": { kind: "notice", confidence: 0.99 },
    });
    const next = autoApply(candidates, base, map)!;
    expect(next.lineOverrides).toEqual(["body|0|第二章 继续", "notice|0|番外篇"]);
    expect(autoApply(candidates, next, map)).toBeNull();
    const after = setup(next, Object.fromEntries(map));
    expect(after.chapters.map((c) => [c.title, c.number, c.notice])).toEqual([
      ["第一章 开端", 1, false],
      ["番外篇", null, true],
    ]);
    expect(after.items.map((i) => [i.ai.text, i.status])).toEqual([
      ["第二章 继续", "fixed"],
      ["番外篇", "fixed"],
      ["请假条", "pending"],
    ]);
  });

  it("规则判为正文的作者公告，高置信度时自动修复为单独成章、不带序号", () => {
    const { candidates, map } = setup(base, { "0|请假条": { kind: "notice", confidence: 0.9 } });
    const next = autoApply(candidates, base, map)!;
    expect(next.lineOverrides).toEqual(["notice|0|请假条"]);
    expect(setup(next, {}).chapters.map((c) => [c.title, c.number, c.notice])).toEqual([
      ["第一章 开端", 1, false],
      ["请假条", null, true],
      ["第二章 继续", 2, false],
      ["番外篇", null, false],
    ]);
  });

  it("修复、忽略、撤销与撤销全部", () => {
    const results = { "0|请假条": { kind: "chapter", confidence: 0.5 }, "0|番外篇": { kind: "notice", confidence: 0.99 } } as const;
    const { items } = setup(base, results);
    const [leave, notice] = items;
    const fixed = fixAiLines(base, [leave!, notice!]);
    expect(fixed.lineOverrides).toEqual(["chapter|0|请假条", "notice|0|番外篇"]);
    // 作者公告单独成章，不带序号。
    expect(setup(fixed, results).chapters.map((c) => [c.title, c.number, c.notice ?? false])).toEqual([
      ["第一章 开端", 1, false],
      ["请假条", null, false],
      ["第二章 继续", 2, false],
      ["番外篇", null, true],
    ]);

    const undone = unfixAiLines(fixed, [setup(fixed, results).items.find((i) => i.ai.text === "请假条")!]);
    expect(undone).toMatchObject({ lineOverrides: ["notice|0|番外篇"], lineIgnores: ["chapter|0|请假条"] });
    expect(setup(undone, results).items.map((i) => [i.ai.text, i.status])).toEqual([
      ["番外篇", "fixed"],
      ["请假条", "ignored"],
    ]);

    const ignored = ignoreAiLines(base, [notice!]);
    expect(ignored.lineIgnores).toEqual(["notice|0|番外篇"]);
    expect(unignoreAiLines(ignored, setup(ignored, results).items.filter((i) => i.status === "ignored")).lineIgnores).toEqual([]);

    const all = undoAllAiFixes(fixed);
    expect(all).toMatchObject({ lineOverrides: [], lineIgnores: ["chapter|0|请假条", "notice|0|番外篇"] });
  });

  it("规则已判为作者公告的行，AI 判为章节或作者公告时都不生成条目", () => {
    const noticeText = ["第一章 开端", "　　正文。", "上架感言", "　　谢谢。", "第二章 继续", "　　正文。"].join("\n");
    const candidates = findCandidateLines(noticeText, base);
    const chapters = splitChapters(noticeText, base);
    expect(chapters.map((c) => [c.title, c.number, c.notice ?? false])).toContainEqual(["上架感言", null, true]);
    for (const kind of ["chapter", "notice"] as const) {
      const results = new Map([["0|上架感言", { kind, confidence: 0.9 }]]);
      expect(reviewAiLines(candidates, chapters, base, results)).toEqual([]);
    }
  });

  it("只发送还没有判断、也没有处理过的候选行，优先发送规则最可能出错的行", () => {
    const { candidates } = setup(base, {});
    const options = { ...base, lineIgnores: ["notice|0|番外篇"] };
    const order = unjudgedCandidates(candidates, options, new Map([["0|第一章 开端", { kind: "chapter", confidence: 1 }]]));
    expect(order.map((c) => c.text)).toEqual(["请假条", "第二章 继续"]);
  });

  it("只复核可疑行时跳过不可疑的行；复核全部时先发可疑行", () => {
    const marked = setup(base, {}).candidates.map((c) => ({ ...c, suspicious: c.text !== "第二章 继续" && c.text !== "请假条" }));
    expect(unjudgedCandidates(marked, base, new Map(), "suspicious").map((c) => c.text)).toEqual(["番外篇", "第一章 开端"]);
    expect(unjudgedCandidates(marked, base, new Map(), "all").map((c) => c.text)).toEqual(["番外篇", "第一章 开端", "请假条", "第二章 继续"]);
  });
});
