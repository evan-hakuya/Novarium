import { describe, expect, it } from "vitest";
import type { AiReviewItem } from "./ai-review";
import { countPending, itemKind, reviewNumbers } from "./number-review";

const chapter = (order: number, number: number) => ({ order, number, title: `第${number}章` });
const none = { numberIgnores: [], numberFixes: [] };

describe("哪些章节异常挡住导入", () => {
  it("缺号与重复编号只提示，不计入", () => {
    // 第 2 章缺号，第 4 章重复。
    const items = reviewNumbers([chapter(0, 1), chapter(1, 3), chapter(2, 4), chapter(3, 4)], none);
    expect(items.map(itemKind).sort()).toEqual(["duplicate", "missing"]);
    expect(countPending(items)).toBe(0);
  });

  it("序号笔误只提示、可以修复；修复后按改写后的标题找到这一章", () => {
    const typo = reviewNumbers([chapter(0, 5), chapter(1, 6), chapter(2, 6), chapter(3, 8)], none);
    expect(typo.map(itemKind)).toEqual(["numberTypo"]);
    expect(countPending(typo)).toBe(0);
    const fixed = reviewNumbers([chapter(0, 5), chapter(1, 6), chapter(2, 7), chapter(3, 8)], { ...none, numberFixes: [typo[0]!.key] });
    expect(fixed).toEqual([{ key: typo[0]!.key, status: "fixed", kind: "numberTypo", number: 7, title: "第6章", order: 2 }]);
  });

  it("乱序计入，忽略后不再计入", () => {
    const chapters = [chapter(0, 1), chapter(1, 2), chapter(2, 5), chapter(3, 3), chapter(4, 4), chapter(5, 6)];
    const items = reviewNumbers(chapters, none);
    const outOfOrder = items.find((i) => itemKind(i) === "outOfOrder");
    expect(outOfOrder).toBeDefined();
    expect(countPending(items)).toBe(1);
    expect(countPending(reviewNumbers(chapters, { ...none, numberIgnores: [outOfOrder!.key] }))).toBe(0);
  });

  it("待处理的 AI 复核结果计入，分卷边界不计入", () => {
    // 序号从 3 回到 1：分卷边界，无需处理。
    const items = reviewNumbers([chapter(0, 1), chapter(1, 2), chapter(2, 3), chapter(3, 1), chapter(4, 2)], none);
    expect(items.map(itemKind)).toEqual(["sectionReset"]);
    const ai = { key: "ai|0|请假条", status: "pending", ai: { kind: "notice" } } as unknown as AiReviewItem;
    expect(countPending([...items, ai])).toBe(1);
  });
});
