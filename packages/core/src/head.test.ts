import { describe, expect, it } from "vitest";
import { manuscriptHead } from "./head";
import { encodeAs, SAMPLE_PROSE, utf8 } from "./test-helpers";

const long = `《归藏试读》\n作者：无名氏\n\n${`第一章 启程\n${SAMPLE_PROSE.repeat(10)}\n`.repeat(40)}`;

describe("manuscriptHead", () => {
  it("取 UTF-8 原稿开头的指定字数", async () => {
    const head = await manuscriptHead(utf8(long), 100);
    expect([...head].length).toBe(100);
    expect(long.startsWith(head)).toBe(true);
  });

  it("GBK 原稿只解码开头，不会出现乱码", async () => {
    const head = await manuscriptHead(encodeAs(long, "gbk"), 3000);
    expect(head.startsWith("《归藏试读》\n作者：无名氏")).toBe(true);
    expect(long.startsWith(head)).toBe(true);
  });

  it("UTF-16LE 原稿按偶数字节截断", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...encodeAs(long, "utf16le")]);
    const head = await manuscriptHead(bytes, 50);
    expect(head).toBe([...long].slice(0, 50).join(""));
  });

  it("去掉 BOM；短原稿整段返回", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(long.slice(0, 200))]);
    expect(await manuscriptHead(bytes)).toBe(long.slice(0, 200));
  });
});
