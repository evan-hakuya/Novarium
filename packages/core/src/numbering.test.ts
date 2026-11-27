import { describe, expect, it } from "vitest";
import { applyNumberFixes, findNumberAnomalies, parseFixKey, renumberTitle, toChineseNumeral } from "./numbering";
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

  it("可修复异常的 key 可以读回类型、序号与标题", () => {
    expect(parseFixKey("outOfOrder|2|7|第七章 a|b")).toEqual({ kind: "outOfOrder", section: 2, number: 7, title: "第七章 a|b" });
    expect(parseFixKey("numberTypo|0|6|第6章")).toEqual({ kind: "numberTypo", section: 0, number: 6, title: "第6章" });
    expect(parseFixKey("missing|0|3|3")).toBeNull();
  });

  it("相邻两个第 n 章、下一章是 n+2 时是序号笔误，取代对应的重复编号与缺号", () => {
    expect(findNumberAnomalies(chapters([5, 6, 6, 8, 9]))).toEqual([
      { key: "numberTypo|0|6|第6章", section: 0, kind: "numberTypo", order: 2, first: 1, number: 6, title: "第6章" },
    ]);
    // 无序号章节夹在中间也算相邻。
    expect(findNumberAnomalies(chapters([6, null, 6, 8])).map((a) => a.kind)).toEqual(["numberTypo"]);
  });

  it("拆成上下篇（不缺号）、不相邻、出现三次、下一章不是 n+2 或 n+1 在别处时不是序号笔误", () => {
    const kinds = (numbers: (number | null)[]) => findNumberAnomalies(chapters(numbers)).map((a) => a.kind);
    expect(kinds([5, 6, 6, 7])).toEqual(["duplicate"]);
    expect(kinds([6, 5, 6, 8])).not.toContain("numberTypo");
    expect(kinds([6, 6, 6, 8])).toEqual(["missing", "duplicate"]);
    expect(kinds([6, 6, 9])).toEqual(["missing", "duplicate"]);
    expect(kinds([5, 6, 6])).toEqual(["duplicate"]);
    // 第 7 章只是乱序：修复成第 7 章会出现两个第 7 章。
    expect(kinds([5, 6, 6, 8, 7])).not.toContain("numberTypo");
  });

  it("标题序号不能按原写法改写（大写数字）时，仍报重复编号与缺号", () => {
    const list = ["第伍章", "第陆章 甲", "第陆章 乙", "第捌章"].map((title, order) => ({ order, number: [5, 6, 6, 8][order]!, title }));
    expect(findNumberAnomalies(list).map((a) => a.kind)).toEqual(["missing", "duplicate"]);
  });
});

describe("renumberTitle", () => {
  it("保持原来的数字写法改写序号", () => {
    expect(renumberTitle("第六章 选择（周一求推荐票）", 7)).toBe("第七章 选择（周一求推荐票）");
    expect(renumberTitle("第二百三十章 三个问题", 231)).toBe("第二百三十一章 三个问题");
    expect(renumberTitle("第一千二百零一章 也姓陈", 1202)).toBe("第一千二百零二章 也姓陈");
    expect(renumberTitle("第230章 三个问题", 231)).toBe("第231章 三个问题");
    expect(renumberTitle("第九章 雨", 10)).toBe("第十章 雨");
    // 大写数字不改写。
    expect(renumberTitle("第陆章 选择", 7)).toBeNull();
  });

  it("中文数字格式", () => {
    expect([10, 12, 20, 101, 110, 1010, 10001, 12000].map(toChineseNumeral)).toEqual([
      "十", "十二", "二十", "一百零一", "一百一十", "一千零一十", "一万零一", "一万二千",
    ]);
  });
});

describe("numberTypo fix", () => {
  it("修复后改写标题序号，章节变为第 n+1 章，不再有异常", async () => {
    // 每章两行正文：两个同号标题只隔一行时，清洗会把它们当作重复标题合并。
    const body = ["第一段。", "第二段。"];
    const manuscript = ["第五章 开端", ...body, "第六章 清晨", ...body, "第六章 选择", ...body, "第八章 结尾", ...body].join("\n");
    const book = await processManuscript(new TextEncoder().encode(manuscript), { ...DEFAULT_PROCESS_OPTIONS, numberFixes: ["numberTypo|0|6|第六章 选择"] });
    expect(book.chapters.map((c) => [c.title, c.number])).toEqual([
      ["第五章 开端", 5], ["第六章 清晨", 6], ["第七章 选择", 7], ["第八章 结尾", 8],
    ]);
    expect(findNumberAnomalies(book.chapters)).toEqual([]);
  });

  it("按卷分别检查：卷内序号从 1 开始不算异常，也不是推断的分卷边界", () => {
    const list = [
      { order: 0, number: 1, title: "第一章", volume: "第一卷" },
      { order: 1, number: 2, title: "第二章", volume: "第一卷" },
      { order: 2, number: 1, title: "第一章", volume: "第二卷" },
      { order: 3, number: 3, title: "第三章", volume: "第二卷" },
    ];
    expect(findNumberAnomalies(list)).toEqual([{ key: "missing|1|2|2", section: 1, kind: "missing", from: 2, to: 2, after: 2 }]);
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

  it("修复不越过卷标题", () => {
    // 第一卷：卷标题 0、第3章 1、第1章 2；第二卷：卷标题 3、第1章 4
    const list = [
      { order: 0, number: null, title: "第一卷", volume: "第一卷", volumeStart: true },
      { order: 1, number: 3, title: "第3章", volume: "第一卷" },
      { order: 2, number: 1, title: "第1章", volume: "第一卷" },
      { order: 3, number: null, title: "第二卷", volume: "第二卷", volumeStart: true },
      { order: 4, number: 1, title: "第1章", volume: "第二卷" },
    ];
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
