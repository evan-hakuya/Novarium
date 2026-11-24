import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESS_OPTIONS } from "./options";
import { processManuscript } from "./process";
import { encodeAs, readChapter, SAMPLE_PROSE } from "./test-helpers";

describe("processManuscript", () => {
  it("decodes GBK, cleans the text and splits chapters", async () => {
    const raw = [
      "第一章：出发 他推开门，外面下着雨。",
      "请牢记收藏,网址 www.example-novel.com 最新最快无防盗",
      SAMPLE_PROSE,
      "",
      "",
      "",
      "第二章 到达",
      "第二章 到达",
      SAMPLE_PROSE,
    ].join("\r\n");

    const { text, chapters } = await processManuscript(encodeAs(raw.repeat(1), "gbk"), DEFAULT_PROCESS_OPTIONS);

    expect(text).not.toContain("\r");
    expect(text).not.toContain("请牢记收藏");
    // 行内连写的标题被拆开，冒号统一为空格；重复的标题被合并。
    expect(chapters.map((c) => c.title)).toEqual(["第一章 出发", "第二章 到达"]);
    expect(readChapter(text, chapters[0]!)).toContain("他推开门，外面下着雨。");
    expect(readChapter(text, chapters[1]!).startsWith("　　")).toBe(true);
  });

  it("applies the filter word list only to lines within the length limit", async () => {
    const raw = `第一章 开始\n加群领福利\n${SAMPLE_PROSE}加群的人很多。`;
    const { text } = await processManuscript(new TextEncoder().encode(raw), {
      ...DEFAULT_PROCESS_OPTIONS,
      filterWords: ["加群"],
      filterMaxLineLength: 20,
    });
    expect(text).not.toContain("加群领福利");
    expect(text).toContain("加群的人很多。");
  });
});
