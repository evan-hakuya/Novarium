import { describe, expect, it } from "vitest";
import { splitChapters } from "./split";
import { validateChapterIndex } from "./validate";

const chapter = (order: number, byteOffset: number, byteLength: number) => ({
  order,
  title: `第${order + 1}章`,
  number: order + 1,
  byteOffset,
  byteLength,
});

describe("validateChapterIndex", () => {
  it("accepts the output of splitChapters", () => {
    const text = "前言内容\n第一章 甲\n内容一\n第二章 乙\n\n内容二";
    const size = new TextEncoder().encode(text).length;
    expect(validateChapterIndex(splitChapters(text, { chapterPattern: null }), size)).toEqual([]);
  });

  it("rejects malformed input", () => {
    expect(validateChapterIndex(null, 10)).toEqual(["chapters must be an array"]);
    expect(validateChapterIndex([], 10)).toEqual(["at least one chapter is required"]);
  });

  it("rejects gaps in reading order", () => {
    expect(validateChapterIndex([chapter(0, 0, 1), chapter(2, 2, 1)], 10)).toEqual(["chapter 1: order must be 1"]);
  });

  it("rejects ranges outside the text", () => {
    expect(validateChapterIndex([chapter(0, 5, 6)], 10)).toEqual(["chapter 0: range exceeds the version text"]);
  });

  it("rejects overlapping or reordered ranges", () => {
    expect(validateChapterIndex([chapter(0, 0, 5), chapter(1, 3, 2)], 10)).toEqual([
      "chapter 1: overlaps the previous chapter or is out of reading order",
    ]);
  });

  it("rejects bad field types", () => {
    const bad = [{ order: 0, title: " ", number: -1, byteOffset: 1.5, byteLength: 1 }];
    expect(validateChapterIndex(bad, 10)).toEqual([
      "chapter 0: title must be a non-empty string",
      "chapter 0: number must be null or a non-negative integer",
      "chapter 0: byteOffset and byteLength must be non-negative integers",
    ]);
  });
});
