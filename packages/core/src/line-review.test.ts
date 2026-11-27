import { describe, expect, it } from "vitest";
import { lineOverrideKey, lineOverrideMap, parseLineOverrideKey } from "./line-review";
import { DEFAULT_PROCESS_OPTIONS, parseProcessOptions } from "./options";
import { processManuscript } from "./process";
import { findCandidateLines, splitChapters } from "./split";
import { utf8 } from "./test-helpers";

const text = [
  "第一章 开端",
  "　　他推开门。",
  "",
  "请假条",
  "　　今天停更一天。",
  "第二章 继续",
  "　　“第一次见面。”",
  "　　这是第三次了，他想。",
  "番外：雨夜",
  "　　雨下了一夜。",
  "第二章 继续",
  "　　重复的标题。",
].join("\n");

describe("行级修正的记法", () => {
  it("key 记录类别、出现次序与文字，文字中可以有竖线", () => {
    const key = lineOverrideKey("chapter", "番外|雨夜", 2);
    expect(key).toBe("chapter|2|番外|雨夜");
    expect(parseLineOverrideKey(key)).toEqual({ kind: "chapter", text: "番外|雨夜", occurrence: 2, id: "2|番外|雨夜" });
    expect(parseLineOverrideKey("bad|0|x")).toBeNull();
    expect(parseLineOverrideKey("chapter|x|y")).toBeNull();
    expect(lineOverrideMap(["notice|0|请假条", "body|0|第一章 开端"])).toEqual(
      new Map([
        ["0|请假条", "notice"],
        ["0|第一章 开端", "body"],
      ]),
    );
  });

  it("整理选项接受并去重 lineOverrides 与 lineIgnores；早期选项没有这两项时为空", () => {
    const parsed = parseProcessOptions({ ...DEFAULT_PROCESS_OPTIONS, lineOverrides: ["body|0|a", "body|0|a"], lineIgnores: ["notice|0|b"] });
    expect(parsed.ok && parsed.options.lineOverrides).toEqual(["body|0|a"]);
    expect(parsed.ok && parsed.options.lineIgnores).toEqual(["notice|0|b"]);
    const { lineOverrides: _a, lineIgnores: _b, ...old } = DEFAULT_PROCESS_OPTIONS;
    const legacy = parseProcessOptions(old);
    expect(legacy.ok && legacy.options.lineOverrides).toEqual([]);
    expect(parseProcessOptions({ ...DEFAULT_PROCESS_OPTIONS, lineIgnores: [""] }).ok).toBe(false);
  });
});

describe("候选行", () => {
  it("包括规则识别的标题行，以及含关键词的短行；对话与长句不算", () => {
    const candidates = findCandidateLines(text, { chapterPattern: null });
    expect(candidates.map((c) => [c.text, c.occurrence, c.rule, c.priority])).toEqual([
      ["第一章 开端", 0, "chapter", false],
      ["请假条", 0, "body", true],
      ["第二章 继续", 0, "chapter", false],
      ["番外：雨夜", 0, "chapter", true],
      ["第二章 继续", 1, "chapter", false],
    ]);
  });

  it("给出上一行、下一个非空行与字节偏移", () => {
    const leave = findCandidateLines(text, { chapterPattern: null }).find((c) => c.text === "请假条")!;
    expect(leave).toMatchObject({ prev: "", next: "　　今天停更一天。", gap: false });
    expect(new TextDecoder().decode(utf8(text).subarray(leave.byteOffset, leave.byteOffset + 9))).toBe("请假条");
    const first = findCandidateLines(text, { chapterPattern: null })[0]!;
    expect(first).toMatchObject({ prev: "", next: "　　他推开门。", byteOffset: 0 });
  });

  it("可疑行：优先行、序号异常、正文很短、含公告用词；编号连续且正文正常的标题不可疑", () => {
    const long = `　　${"夜色渐深，城门外只剩下几盏灯笼。".repeat(40)}`;
    const book = [
      "第一章 开端", long,
      "第二章 继续", long,
      "第三章 请假一天", long,
      "第四章 短章", "　　很短。",
      "第六章 跳号", long,
      "第七章 结尾", long,
      "番外 后日谈", long,
    ].join("\n");
    const marked = findCandidateLines(book, { chapterPattern: null }).map((c) => [c.text, c.suspicious]);
    expect(marked).toEqual([
      ["第一章 开端", false],
      ["第二章 继续", false],
      ["第三章 请假一天", true],
      ["第四章 短章", true],
      ["第六章 跳号", true],
      ["第七章 结尾", false],
      ["番外 后日谈", true],
    ]);
  });

  it("序号重置的第 1 章前用空行隔开的独立短行，规则判为卷名，仍是可疑的候选行；超过 20 字或以句号结尾的不算", () => {
    const book = [
      "第一章 开端", "　　正文。",
      "第二章 继续", "　　正文。",
      "", "小丑", "",
      "第一章 新卷", "　　正文。",
      "　　这一行以句号结尾，所以不是卷名。",
      "第一章 又一卷", "　　正文。",
      "　　这一行没有结尾标点但是已经超过了二十个字的长度上限",
      "第一章 再一卷", "　　正文。",
    ].join("\n");
    const marked = findCandidateLines(book, { chapterPattern: null }).filter((c) => c.rule !== "chapter");
    expect(marked.map((c) => [c.text, c.rule, c.suspicious])).toEqual([["小丑", "volume", true]]);
    const chapters = splitChapters(book, { chapterPattern: null });
    expect(chapters.map((c) => c.title)).not.toContain("小丑");
    expect(chapters.find((c) => c.title === "第一章 新卷")?.volume).toBe("小丑");
  });

  it("有序号重置的卷名时，全书第一个第 1 章前的短行也是卷名；没有时它只是正文候选行", () => {
    const opening = ["前文。", "", "风起", "", "第一章 开端", "　　正文。", "第二章 继续", "　　正文。"];
    const volumes = (lines: string[]) => [...new Set(splitChapters(lines.join("\n"), { chapterPattern: null }).map((c) => c.volume))];
    expect(volumes([...opening, "", "云涌", "", "第一章 新篇", "　　正文。"])).toEqual([null, "风起", "云涌"]);
    expect(volumes(opening)).toEqual([null]);
    // 只用本书正则时不识别卷。
    const replace = { chapterPattern: "^第.章", chapterPatternMode: "replace" as const };
    expect(splitChapters([...opening, "", "云涌", "", "第一章 新篇", "　　正文。"].join("\n"), replace).every((c) => !c.volume)).toBe(true);
  });

  it("整理时疑似作者公告的独立短行不与下一行正文合并，成为可疑的候选行；对话与含常见词的折行正文照常合并", async () => {
    const manuscript = "第一章 开端\n他推开门。\n生病了，请假一天\n明天补更。\n“可以请假\n吗？”他问。\n这说明他没有收到通知\n，只好先回家。\n";
    const book = await processManuscript(utf8(manuscript), { ...DEFAULT_PROCESS_OPTIONS });
    expect(book.chapters.map((c) => c.title)).toEqual(["第一章 开端"]);
    const lines = book.text.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain("生病了，请假一天");
    expect(lines).toContain("“可以请假吗？”他问。");
    expect(lines).toContain("这说明他没有收到通知，只好先回家。");
    const leave = findCandidateLines(book.text, DEFAULT_PROCESS_OPTIONS).find((c) => c.text === "生病了，请假一天");
    expect(leave).toMatchObject({ rule: "body", suspicious: true });
    // 含新增公告用词的对话不是候选行。
    expect(findCandidateLines("第一章 开端\n　　“抱歉，停更通知”\n", DEFAULT_PROCESS_OPTIONS).map((c) => c.text)).toEqual(["第一章 开端"]);
  });

  it("整理时没有结尾标点的番外短标题不与下一行正文合并，成为可疑的候选行", async () => {
    const manuscript = "第一章 开端\n他推开门。\n\n个人番外篇 : 与你相配\n\n　　伦敦的音乐厅座无虚席。\n";
    const book = await processManuscript(utf8(manuscript), { ...DEFAULT_PROCESS_OPTIONS });
    expect(book.text.split("\n").map((l) => l.trim())).toContain("个人番外篇 : 与你相配");
    const line = findCandidateLines(book.text, DEFAULT_PROCESS_OPTIONS).find((c) => c.text === "个人番外篇 : 与你相配");
    expect(line).toMatchObject({ rule: "body", suspicious: true });
  });

  it("含番外、完结的折行正文与对话照常合并", async () => {
    const manuscript = "第一章 开端\n他说这本书终于要完结了，读者们都在等着看最后\n一章。\n“番外\n还写吗？”她问。\n";
    const book = await processManuscript(utf8(manuscript), { ...DEFAULT_PROCESS_OPTIONS });
    const lines = book.text.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(lines).toContain("他说这本书终于要完结了，读者们都在等着看最后一章。");
    expect(lines).toContain("“番外还写吗？”她问。");
  });
});

describe("分章应用行级修正", () => {
  const titles = (lineOverrides: string[]) => splitChapters(text, { chapterPattern: null, lineOverrides }).map((c) => c.title);

  it("可以把正文行设为章节、把标题行设为正文，按出现次序只改一处", () => {
    expect(titles([])).toEqual(["第一章 开端", "第二章 继续", "番外：雨夜", "第二章 继续"]);
    expect(titles(["chapter|0|请假条"])).toEqual(["第一章 开端", "请假条", "第二章 继续", "番外：雨夜", "第二章 继续"]);
    expect(titles(["body|1|第二章 继续"])).toEqual(["第一章 开端", "第二章 继续", "番外：雨夜"]);
  });

  it("可以把行设为卷", () => {
    const chapters = splitChapters(text, { chapterPattern: null, lineOverrides: ["volume|0|番外：雨夜"] });
    expect(chapters.map((c) => [c.title, c.volume])).toEqual([
      ["第一章 开端", null],
      ["第二章 继续", null],
      ["番外：雨夜", "番外：雨夜"],
      ["第二章 继续", "番外：雨夜"],
    ]);
  });

  it("整理时设为章节的行不与正文合并", async () => {
    const manuscript = "第一章 开端\n他推开门，\n请假一天\n然后走了。\n";
    const plain = await processManuscript(utf8(manuscript), { ...DEFAULT_PROCESS_OPTIONS });
    expect(plain.chapters.map((c) => c.title)).toEqual(["第一章 开端"]);
    const forced = await processManuscript(utf8(manuscript), { ...DEFAULT_PROCESS_OPTIONS, lineOverrides: ["chapter|0|请假一天"] });
    expect(forced.chapters.map((c) => c.title)).toEqual(["第一章 开端", "请假一天"]);
  });
});
