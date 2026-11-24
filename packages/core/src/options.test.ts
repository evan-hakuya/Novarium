import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESS_OPTIONS, parseProcessOptions } from "./options";

describe("parseProcessOptions", () => {
  it("accepts the defaults", () => {
    expect(parseProcessOptions(DEFAULT_PROCESS_OPTIONS)).toEqual({ ok: true, options: DEFAULT_PROCESS_OPTIONS });
  });

  it("keeps replace mode for patterns saved before the mode existed", () => {
    const { chapterPatternMode: _, ...legacy } = DEFAULT_PROCESS_OPTIONS;
    const result = parseProcessOptions({ ...legacy, chapterPattern: "^卷.+$" });
    expect(result.ok && result.options.chapterPatternMode).toBe("replace");
  });

  it("normalizes filter words and drops unknown keys", () => {
    const result = parseProcessOptions({
      ...DEFAULT_PROCESS_OPTIONS,
      filterWords: [" 加群 ", "加群", "", "最新章节"],
      chapterPattern: "^卷.+$",
      extra: 1,
    });
    expect(result).toEqual({
      ok: true,
      options: { ...DEFAULT_PROCESS_OPTIONS, filterWords: ["加群", "最新章节"], chapterPattern: "^卷.+$" },
    });
  });

  it.each([
    ["non-array fixes", { ...DEFAULT_PROCESS_OPTIONS, numberFixes: "x" }],
    ["empty ignore key", { ...DEFAULT_PROCESS_OPTIONS, numberIgnores: [""] }],
    ["missing boolean", { ...DEFAULT_PROCESS_OPTIONS, indent: undefined }],
    ["bad regex", { ...DEFAULT_PROCESS_OPTIONS, chapterPattern: "(" }],
    ["empty regex", { ...DEFAULT_PROCESS_OPTIONS, chapterPattern: "" }],
    ["negative threshold", { ...DEFAULT_PROCESS_OPTIONS, filterMaxLineLength: -1 }],
    ["fractional threshold", { ...DEFAULT_PROCESS_OPTIONS, filterMaxLineLength: 1.5 }],
    ["non-string word", { ...DEFAULT_PROCESS_OPTIONS, filterWords: [1] }],
    ["array", []],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(parseProcessOptions(value).ok).toBe(false);
  });

  it("treats options saved before number reviews existed as unreviewed", () => {
    const { numberFixes: _f, numberIgnores: _i, ...legacy } = DEFAULT_PROCESS_OPTIONS;
    expect(parseProcessOptions({ ...legacy, reorderByNumber: true })).toEqual({ ok: true, options: DEFAULT_PROCESS_OPTIONS });
  });
});
