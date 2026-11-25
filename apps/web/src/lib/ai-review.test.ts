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
  it("与规则一致或把正文判为作者公告时不生成条目；不一致时待处理", () => {
    const { items } = setup(base, {
      "0|第一章 开端": { kind: "chapter", confidence: 0.99 },
      "0|请假条": { kind: "notice", confidence: 0.9 },
      "0|第二章 继续": { kind: "body", confidence: 0.4 },
      "0|番外篇": { kind: "notice", confidence: 0.95 },
    });
    expect(items.map((i) => [i.ai.text, i.status, i.ai.kind, i.ai.suggested, i.ai.order])).toEqual([
      ["第二章 继续", "pending", "aiLine", "body", 1],
      ["番外篇", "pending", "notice", "notice", 2],
    ]);
  });

  it("置信度不低于 0.8 的不一致判断自动采用；作者公告与低置信度的不自动采用", () => {
    const { candidates, map } = setup(base, {
      "0|第二章 继续": { kind: "body", confidence: 0.85 },
      "0|请假条": { kind: "chapter", confidence: 0.5 },
      "0|番外篇": { kind: "notice", confidence: 0.99 },
    });
    const next = autoApply(candidates, base, map)!;
    expect(next.lineOverrides).toEqual(["body|0|第二章 继续"]);
    expect(autoApply(candidates, next, map)).toBeNull();
    const after = setup(next, Object.fromEntries(map));
    expect(after.chapters.map((c) => c.title)).toEqual(["第一章 开端", "番外篇"]);
    expect(after.items.map((i) => [i.ai.text, i.status])).toEqual([
      ["第二章 继续", "fixed"],
      ["请假条", "pending"],
      ["番外篇", "pending"],
    ]);
  });

  it("修复、忽略、撤销与撤销全部", () => {
    const results = { "0|请假条": { kind: "chapter", confidence: 0.5 }, "0|番外篇": { kind: "notice", confidence: 0.99 } } as const;
    const { items } = setup(base, results);
    const [leave, notice] = items;
    const fixed = fixAiLines(base, [leave!, notice!]);
    expect(fixed.lineOverrides).toEqual(["chapter|0|请假条", "body|0|番外篇"]);
    expect(setup(fixed, results).chapters.map((c) => c.title)).toEqual(["第一章 开端", "请假条", "第二章 继续"]);

    const undone = unfixAiLines(fixed, [setup(fixed, results).items.find((i) => i.ai.text === "请假条")!]);
    expect(undone).toMatchObject({ lineOverrides: ["body|0|番外篇"], lineIgnores: ["chapter|0|请假条"] });
    expect(setup(undone, results).items.map((i) => [i.ai.text, i.status])).toEqual([
      ["番外篇", "fixed"],
      ["请假条", "ignored"],
    ]);

    const ignored = ignoreAiLines(base, [notice!]);
    expect(ignored.lineIgnores).toEqual(["notice|0|番外篇"]);
    expect(unignoreAiLines(ignored, setup(ignored, results).items.filter((i) => i.status === "ignored")).lineIgnores).toEqual([]);

    const all = undoAllAiFixes(fixed);
    expect(all).toMatchObject({ lineOverrides: [], lineIgnores: ["chapter|0|请假条", "body|0|番外篇"] });
  });

  it("只发送还没有判断、也没有处理过的候选行，优先发送规则最可能出错的行", () => {
    const { candidates } = setup(base, {});
    const options = { ...base, lineIgnores: ["notice|0|番外篇"] };
    const order = unjudgedCandidates(candidates, options, new Map([["0|第一章 开端", { kind: "chapter", confidence: 1 }]]));
    expect(order.map((c) => c.text)).toEqual(["请假条", "第二章 继续"]);
  });
});
