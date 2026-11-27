import { describe, expect, it } from "vitest";
import { locateLine } from "./chapter-browser";

describe("locateLine", () => {
  it("finds the whole line, skipping matches inside longer lines", () => {
    const text = "他说请假一天就回来。\n　　请假一天\n正文";
    const hit = locateLine(text, "请假一天");
    expect(hit).toEqual({ start: text.indexOf("　　请假一天") + 2, end: text.indexOf("　　请假一天") + 6, page: 0 });
  });

  it("returns the page that holds the line", () => {
    const filler = `${"字".repeat(99)}\n`.repeat(450); // 45,000 字，分成 3 页
    const text = `${filler}目标行\n尾`;
    expect(locateLine(text, "目标行")).toMatchObject({ start: filler.length, page: 2 });
  });

  it("returns null when the line is not in the body", () => {
    expect(locateLine("正文\n更多正文", "第一章 开始")).toBeNull();
    expect(locateLine("正文", "")).toBeNull();
  });
});
