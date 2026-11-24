import { describe, expect, it } from "vitest";
import { decodeManuscript } from "./decode";
import { encodeAs, SAMPLE_PROSE, utf8 } from "./test-helpers";

const text = `第一章 启程\n${SAMPLE_PROSE.repeat(20)}`;

describe("decodeManuscript", () => {
  it("decodes UTF-8", async () => {
    expect(await decodeManuscript(utf8(text))).toBe(text);
  });

  it("strips the UTF-8 BOM", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]);
    expect(await decodeManuscript(bytes)).toBe(text);
  });

  it("decodes GBK", async () => {
    expect(await decodeManuscript(encodeAs(text, "gbk"))).toBe(text);
  });

  it("decodes Big5", async () => {
    const traditional = `第一章 啟程\n${"夜色漸深，城門外的長街上只剩下幾盞搖晃的燈籠。少年背著行囊，踩著濕漉漉的青石板，一步一步走向遠處的客棧。".repeat(30)}`;
    expect(await decodeManuscript(encodeAs(traditional, "big5"))).toBe(traditional);
  });

  it("decodes UTF-16LE with a BOM (Windows 记事本「Unicode」)", async () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...encodeAs(text, "utf16le")]);
    expect(await decodeManuscript(bytes)).toBe(text);
  });

  it("decodes UTF-16BE with a BOM", async () => {
    const bytes = new Uint8Array([0xfe, 0xff, ...encodeAs(text, "utf16be")]);
    expect(await decodeManuscript(bytes)).toBe(text);
  });

  it("decodes ASCII-heavy UTF-16LE without a BOM by NUL density", async () => {
    const english = "Chapter 1\nThe night grew deep over the city gate.\n".repeat(20);
    expect(await decodeManuscript(encodeAs(english, "utf16le"))).toBe(english);
  });

  // 已知限制（与上游一致）：没有 BOM、几乎全是中文的 UTF-16 没有 NUL 特征，识别不出来，明确报错。
  it("rejects BOM-less UTF-16 that is almost all CJK", async () => {
    await expect(decodeManuscript(encodeAs(text, "utf16le"))).rejects.toThrow(/unrecognized/);
  });

  it("rejects bytes it cannot identify instead of returning mojibake", async () => {
    const noise = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 129) % 256);
    await expect(decodeManuscript(noise)).rejects.toThrow();
  });
});
