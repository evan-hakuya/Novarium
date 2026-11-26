import { describe, expect, it } from "vitest";
import { formatWordCount } from "./word-count";

describe("formatWordCount", () => {
  it("万字以上保留一位小数，书源格式不加空格", () => {
    expect(formatWordCount(4467719)).toBe("446.8 万字");
    expect(formatWordCount(4467719, { compact: true })).toBe("446.8万字");
    expect(formatWordCount(20_000)).toBe("2 万字");
    expect(formatWordCount(9999)).toBe("9999 字");
    expect(formatWordCount(null)).toBeNull();
    expect(formatWordCount(0)).toBeNull();
  });
});
