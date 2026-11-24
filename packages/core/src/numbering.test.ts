import { describe, expect, it } from "vitest";
import { applyNumberFixes, findNumberAnomalies, parseOutOfOrderKey } from "./numbering";
import { DEFAULT_PROCESS_OPTIONS } from "./options";
import { processManuscript } from "./process";

const chapters = (numbers: (number | null)[]) =>
  numbers.map((number, order) => ({ order, number, title: number === null ? `无号${order}` : `第${number}章` }));

describe("findNumberAnomalies", () => {
  it("正常编号没有异常，无序号章节不参与检查", () => {
    expect(findNumberAnomalies(chapters([null, 1, 2, null, 3, null]))).toEqual([]);
  });

  it("找出缺号、重复编号与乱序，并给出章节位置与 key", () => {
    // 阅读顺序：0 序章，1 第1章，2 第2章，3 第5章，4 第4章，5 第4章，6 番外
    expect(findNumberAnomalies(chapters([null, 1, 2, 5, 4, 4, null]))).toEqual([
      { key: "missing|0|3|3", section: 0, kind: "missing", from: 3, to: 3, after: 2 },
      { key: "duplicate|0|4", section: 0, kind: "duplicate", number: 4, orders: [4, 5] },
      { key: "outOfOrder|0|5|第5章", section: 0, kind: "outOfOrder", order: 3, number: 5, title: "第5章" },
    ]);
  });

  it("只把需要移动的最少章节标为乱序", () => {
    // 第5章放错了位置，2、3、4 本身顺序正确。
    const anomalies = findNumberAnomalies(chapters([1, 5, 2, 3, 4]));
    expect(anomalies.map((a) => a.key)).toEqual(["outOfOrder|0|5|第5章"]);
  });

  it("把序号重置识别为分卷边界，并在分卷内检查异常", () => {
    expect(findNumberAnomalies(chapters([1, 2, 1, 2, 4]))).toEqual([
      { key: "sectionReset|1", section: 1, kind: "sectionReset", order: 2, previous: 2 },
      { key: "missing|1|3|3", section: 1, kind: "missing", from: 3, to: 3, after: 3 },
    ]);
  });

  it("乱序 key 可以读回序号与标题", () => {
    expect(parseOutOfOrderKey("outOfOrder|2|7|第七章 a|b")).toEqual({ section: 2, number: 7, title: "第七章 a|b" });
    expect(parseOutOfOrderKey("missing|0|3|3")).toBeNull();
  });
});

describe("applyNumberFixes", () => {
  it("只移动选择修复的章节；无序号章节跟随移动，开头的留在最前", () => {
    // 0 序章，1 第3章，2 第1章，3 番外（跟随第1章），4 第2章 → 乱序的是第3章
    const list = chapters([null, 3, 1, null, 2]);
    expect(applyNumberFixes(list, [])).toEqual([0, 1, 2, 3, 4]);
    expect(applyNumberFixes(list, ["outOfOrder|0|3|第3章"])).toEqual([0, 2, 3, 4, 1]);
  });

  it("只修复其中一处时，其他乱序保持原位", () => {
    // 第4章与第2章都放错：只修复第4章。
    const list = chapters([1, 4, 3, 5, 2]);
    const keys = findNumberAnomalies(list).filter((a) => a.kind === "outOfOrder").map((a) => a.key);
    expect(keys).toEqual(["outOfOrder|0|4|第4章", "outOfOrder|0|2|第2章"]);
    expect(applyNumberFixes(list, ["outOfOrder|0|4|第4章"])).toEqual([0, 2, 1, 3, 4]);
    expect(applyNumberFixes(list, keys)).toEqual([0, 4, 2, 1, 3]);
  });

  it("在分卷内移动，不跨分卷", () => {
    // 卷一：1 3 2；卷二：1 2
    const list = chapters([1, 3, 2, 1, 2]);
    expect(applyNumberFixes(list, ["outOfOrder|0|3|第3章"])).toEqual([0, 2, 1, 3, 4]);
  });
});

describe("processManuscript 修复章节序号", () => {
  const raw = ["序章 开端", "楔子正文。", "第三章 丙", "丙正文。", "第一章 甲", "甲正文。", "番外 插曲", "番外正文。", "第二章 乙", "乙正文。"].join("\n");
  const bytes = new TextEncoder().encode(raw);
  const options = { ...DEFAULT_PROCESS_OPTIONS, smartLineBreak: false, indent: false };

  it("默认不修复", async () => {
    const draft = await processManuscript(bytes, options);
    expect(draft.chapters.map((c) => c.title)).toEqual(["序章 开端", "第三章 丙", "第一章 甲", "番外 插曲", "第二章 乙"]);
  });

  it("修复后正文与章节索引一致，番外跟随第一章，正文不丢失", async () => {
    const before = await processManuscript(bytes, options);
    const [anomaly] = findNumberAnomalies(before.chapters);
    expect(anomaly?.key).toBe("outOfOrder|0|3|第三章 丙");
    const draft = await processManuscript(bytes, { ...options, numberFixes: [anomaly!.key] });
    expect(draft.chapters.map((c) => c.title)).toEqual(["序章 开端", "第一章 甲", "番外 插曲", "第二章 乙", "第三章 丙"]);
    const text = new TextEncoder().encode(draft.text);
    const body = (i: number) =>
      new TextDecoder().decode(text.subarray(draft.chapters[i]!.byteOffset, draft.chapters[i]!.byteOffset + draft.chapters[i]!.byteLength));
    expect(draft.chapters.map((_, i) => body(i))).toEqual(["楔子正文。", "甲正文。", "番外正文。", "乙正文。", "丙正文。"]);
    expect([...draft.text].sort().join("")).toBe([...before.text].sort().join(""));
    expect(findNumberAnomalies(draft.chapters)).toEqual([]);
  });
});
