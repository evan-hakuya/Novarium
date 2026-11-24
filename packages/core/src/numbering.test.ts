import { describe, expect, it } from "vitest";
import { findNumberAnomalies, orderByNumber } from "./numbering";
import { DEFAULT_PROCESS_OPTIONS } from "./options";
import { processManuscript } from "./process";

const chapters = (numbers: (number | null)[]) => numbers.map((number, order) => ({ order, number }));

describe("findNumberAnomalies", () => {
  it("正常编号没有异常，无序号章节不参与检查", () => {
    expect(findNumberAnomalies(chapters([null, 1, 2, null, 3, null]))).toEqual([]);
  });

  it("找出缺号、重复编号与乱序，并给出章节位置", () => {
    // 阅读顺序：0 序章，1 第1章，2 第2章，3 第5章，4 第4章，5 第4章，6 番外
    expect(findNumberAnomalies(chapters([null, 1, 2, 5, 4, 4, null]))).toEqual([
      { kind: "missing", from: 3, to: 3, after: 2 },
      { kind: "duplicate", number: 4, orders: [4, 5] },
      { kind: "outOfOrder", order: 4, number: 4, previous: 5 },
    ]);
  });

  it("把序号重置识别为分卷边界，并在分卷内检查异常", () => {
    expect(findNumberAnomalies(chapters([1, 2, 1, 2, 4]))).toEqual([
      { kind: "sectionReset", order: 2, previous: 2 },
      { kind: "missing", from: 3, to: 3, after: 3 },
    ]);
  });
});

describe("orderByNumber", () => {
  it("按序号排序；无序号章节跟随前一个有序号章节，开头的留在最前", () => {
    // 0 序章，1 第3章，2 第1章，3 番外（跟随第1章），4 第2章
    expect(orderByNumber(chapters([null, 3, 1, null, 2]))).toEqual([0, 2, 3, 4, 1]);
  });

  it("序号相同的章节保持原来的先后", () => {
    expect(orderByNumber(chapters([2, 1, 2, 1]))).toEqual([1, 3, 0, 2]);
  });
});

describe("processManuscript 按序号重排", () => {
  const raw = ["序章 开端", "楔子正文。", "第三章 丙", "丙正文。", "第一章 甲", "甲正文。", "番外 插曲", "番外正文。", "第二章 乙", "乙正文。"].join("\n");
  const bytes = new TextEncoder().encode(raw);
  const options = { ...DEFAULT_PROCESS_OPTIONS, smartLineBreak: false, indent: false };

  it("默认不重排", async () => {
    const draft = await processManuscript(bytes, options);
    expect(draft.chapters.map((c) => c.title)).toEqual(["序章 开端", "第三章 丙", "第一章 甲", "番外 插曲", "第二章 乙"]);
  });

  it("重排后正文与章节索引一致，番外跟随第一章，正文不丢失", async () => {
    const draft = await processManuscript(bytes, { ...options, reorderByNumber: true });
    expect(draft.chapters.map((c) => c.title)).toEqual(["序章 开端", "第一章 甲", "番外 插曲", "第二章 乙", "第三章 丙"]);
    const text = new TextEncoder().encode(draft.text);
    const body = (i: number) =>
      new TextDecoder().decode(text.subarray(draft.chapters[i]!.byteOffset, draft.chapters[i]!.byteOffset + draft.chapters[i]!.byteLength));
    expect(draft.chapters.map((_, i) => body(i))).toEqual(["楔子正文。", "甲正文。", "番外正文。", "乙正文。", "丙正文。"]);
    expect(draft.chapters.map((c) => c.order)).toEqual([0, 1, 2, 3, 4]);
    expect([...draft.text].sort().join("")).toBe([...(await processManuscript(bytes, options)).text].sort().join(""));
  });
});
