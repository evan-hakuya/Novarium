import { describe, expect, it } from "vitest";
import { checkChapterPattern, PREFACE_TITLE, splitChapters, WHOLE_BOOK_TITLE } from "./split";
import { readChapter } from "./test-helpers";

const builtin = { chapterPattern: null };

describe("splitChapters", () => {
  it("splits on built-in titles and reads each body back by byte range", () => {
    const text = [
      "书名：测试之书",
      "作者：某人",
      "",
      "序章 风起",
      "　　开篇的故事。",
      "",
      "第一章 少年",
      "　　他走进客栈，要了一碗面。",
      "　　面很烫。",
      "",
      "第十二章 归来",
      "　　一切都结束了。",
      "番外 后日谈",
      "　　多年以后。",
    ].join("\n");
    const chapters = splitChapters(text, builtin);

    expect(chapters.map((c) => [c.order, c.title, c.number])).toEqual([
      [0, PREFACE_TITLE, null],
      [1, "序章 风起", null],
      [2, "第一章 少年", 1],
      [3, "第十二章 归来", 12],
      [4, "番外 后日谈", null],
    ]);
    expect(chapters.map((c) => readChapter(text, c))).toEqual([
      "书名：测试之书\n作者：某人",
      "　　开篇的故事。",
      "　　他走进客栈，要了一碗面。\n　　面很烫。",
      "　　一切都结束了。",
      "　　多年以后。",
    ]);
  });

  it("parses Chinese numerals, Arabic numerals and 万-level numbers", () => {
    const text = [
      "第一千零二章 甲",
      "内容。",
      "第1003章 乙",
      "内容。",
      "第一万章 丙",
      "内容。",
      "第壹拾贰章 丁",
      "内容。",
    ].join("\n");
    expect(splitChapters(text, builtin).map((c) => c.number)).toEqual([1002, 1003, 10000, 12]);
  });

  it("recognises numbered titles such as 「12. 标题」", () => {
    const text = "1. 开始\n内容。\n2. 继续\n内容。";
    expect(splitChapters(text, builtin).map((c) => [c.title, c.number])).toEqual([
      ["1. 开始", 1],
      ["2. 继续", 2],
    ]);
  });

  it("keeps byte offsets correct for multi-byte text and emoji", () => {
    const text = "第一章 开始\n😀中文 mixed ASCII\n\n第二章 结束\n最后一行";
    const chapters = splitChapters(text, builtin);
    expect(chapters.map((c) => readChapter(text, c))).toEqual(["😀中文 mixed ASCII", "最后一行"]);
    const last = chapters.at(-1)!;
    expect(last.byteOffset + last.byteLength).toBe(new TextEncoder().encode(text).length);
  });

  it("does not treat prose sentences as titles", () => {
    const text = "第一章 开始\n一部正在上映的电影，票价三十起步。\n第二章 继续\n内容";
    expect(splitChapters(text, builtin).map((c) => c.title)).toEqual(["第一章 开始", "第二章 继续"]);
  });

  it("does not treat numbered lists or bare Chinese number phrases as titles", () => {
    const text = ["第一章 开始", "1，一项清单", "一部优秀的推理小说是需要逻辑性的：", "正文。"].join("\n");
    expect(splitChapters(text, builtin).map((c) => c.title)).toEqual(["第一章 开始"]);
  });

  it("does not treat 章节 as an inline chapter title", () => {
    const text = "第一章 开始\n第三章节的通关目标已经确定。\n正文。";
    expect(splitChapters(text, builtin).map((c) => c.title)).toEqual(["第一章 开始"]);
  });

  it("does not assign a body chapter number to numbered extras", () => {
    const text = "第一章 开始\n番外：最喜欢的一章\n内容。";
    expect(splitChapters(text, builtin).map((c) => [c.title, c.number])).toEqual([
      ["第一章 开始", 1],
      ["番外：最喜欢的一章", null],
    ]);
  });

  it("treats the whole text as one chapter when no title is found", () => {
    const text = "只有一段文字。\n没有任何章节标题。";
    const chapters = splitChapters(text, builtin);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe(WHOLE_BOOK_TITLE);
    expect(readChapter(text, chapters[0]!)).toBe(text);
  });

  it("gives empty chapters a zero length", () => {
    const text = "第一章 空\n\n第二章 有\n内容";
    const [empty] = splitChapters(text, builtin);
    expect(empty!.byteLength).toBe(0);
  });

  it("uses only the custom pattern in replace mode", () => {
    const text = "【卷一】\n内容一\n第一章 不算标题\n【卷二】\n内容二";
    const chapters = splitChapters(text, { chapterPattern: "^【卷.+】$", chapterPatternMode: "replace" });
    expect(chapters.map((c) => c.title)).toEqual(["【卷一】", "【卷二】"]);
    expect(readChapter(text, chapters[0]!)).toBe("内容一\n第一章 不算标题");
  });

  it("adds the custom pattern to the built-in rules by default, for short lines only", () => {
    const text = [
      "第一章 开始",
      "正文。",
      "后记：这里提到个人番外的一段很长很长很长很长很长很长很长很长很长很长很长很长的正文说明。",
      "个人番外篇 : 甲",
      "番外正文。",
    ].join("\n");
    const chapters = splitChapters(text, { chapterPattern: "个人番外" });
    expect(chapters.map((c) => c.title)).toEqual(["第一章 开始", "个人番外篇 : 甲"]);
  });

  it("reports invalid custom patterns", () => {
    expect(checkChapterPattern("^第(")).not.toBeNull();
    expect(checkChapterPattern("^第.+章")).toBeNull();
    expect(() => splitChapters("x", { chapterPattern: "(" })).toThrow(/invalid chapter pattern/);
  });

  describe("卷", () => {
    it("没有卷的书，章节的卷为 null", () => {
      const chapters = splitChapters("第一章 甲\n正文。\n第二章 乙\n正文。", builtin);
      expect(chapters.map((c) => [c.title, c.volume])).toEqual([
        ["第一章 甲", null],
        ["第二章 乙", null],
      ]);
    });

    it("识别卷标题并把后续章节归入该卷；卷内序号可以重新从 1 开始", () => {
      const text = [
        "第一卷 风起",
        "第一章 甲",
        "甲正文。",
        "第二章 乙",
        "乙正文。",
        "第二卷 云涌",
        "本卷讲的是云涌。",
        "第一章 丙",
        "丙正文。",
      ].join("\n");
      const chapters = splitChapters(text, builtin);
      expect(chapters.map((c) => [c.title, c.number, c.volume])).toEqual([
        ["第一章 甲", 1, "第一卷 风起"],
        ["第二章 乙", 2, "第一卷 风起"],
        // 卷标题后有正文：这段正文作为以卷标题为标题的章节。
        ["第二卷 云涌", null, "第二卷 云涌"],
        ["第一章 丙", 1, "第二卷 云涌"],
      ]);
      expect(readChapter(text, chapters[2]!)).toBe("本卷讲的是云涌。");
      expect(readChapter(text, chapters[0]!)).toBe("甲正文。");
    });

    it("识别「卷三」「上卷」，不把带章节号的行或正文句当作卷", () => {
      const text = ["卷三 归来", "第一章 甲", "正文。", "第一卷 第二章 乙", "正文。", "上卷", "第三章 丙", "第一部电影很好看，我们看完了。"].join("\n");
      const chapters = splitChapters(text, builtin);
      expect(chapters.map((c) => [c.title, c.volume])).toEqual([
        ["第一章 甲", "卷三 归来"],
        ["第一卷 第二章 乙", "卷三 归来"],
        ["第三章 丙", "上卷"],
      ]);
    });

    it("这本书用「卷」作章节单位时，不识别卷", () => {
      const text = ["第一卷 甲", "正文。", "第二卷 乙", "正文。", "第三卷 丙", "正文。"].join("\n");
      expect(splitChapters(text, builtin).map((c) => [c.title, c.volume])).toEqual([
        ["第一卷 甲", null],
        ["第二卷 乙", null],
        ["第三卷 丙", null],
      ]);
    });
  });

  it("作者公告单独成章、不带序号；标记不是章节单位的句子不是标题", () => {
    const text = [
      "第一章 绯红",
      "　　正文。",
      "第二章 梦",
      "　　（第一部完）",
      "第一部总结兼请假（求月票）",
      "　　感谢大家。",
      "第二部 无面人",
      "第一章 新生",
      "第一幕依旧是那个狭小的房间。",
      "第二部，我还没想好主角和切入，大概是：",
      "第二章 尾声",
      "完本感言",
      "　　谢谢。",
    ].join("\n");
    expect(splitChapters(text, builtin).map((c) => [c.title, c.number, c.volume])).toEqual([
      ["第一章 绯红", 1, null],
      ["第二章 梦", 2, null],
      ["第一部总结兼请假（求月票）", null, null],
      ["第一章 新生", 1, "第二部 无面人"],
      ["第二章 尾声", 2, "第二部 无面人"],
      ["完本感言", null, "第二部 无面人"],
    ]);
  });
});
