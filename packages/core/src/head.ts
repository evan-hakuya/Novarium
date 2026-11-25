import { decodeManuscript } from "./decode";

/** 解码原稿开头时读取的字节数。3,000 个汉字在 UTF-8 下约 9 KB，多读一些以容纳空行与 ASCII。 */
const HEAD_BYTES = 16 * 1024;

/**
 * 原稿开头的文本，用于 AI 识别元数据（ADR 0007）。只解码开头一段字节，不解码整个原稿。
 * 在换行处截断字节，避免把多字节字符切成两半：0x0A 在 UTF-8、GBK、Big5 中都不会是多字节字符的一部分。
 */
export async function manuscriptHead(bytes: Uint8Array, maxChars = 3000): Promise<string> {
  let slice = bytes;
  if (bytes.length > HEAD_BYTES) {
    const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
    if (utf16) {
      slice = bytes.subarray(0, HEAD_BYTES);
    } else {
      const newline = bytes.subarray(0, HEAD_BYTES).lastIndexOf(0x0a);
      slice = bytes.subarray(0, newline > 0 ? newline + 1 : HEAD_BYTES);
    }
  }
  const text = (await decodeManuscript(slice)).replace(/^\uFEFF/, "");
  return [...text].slice(0, maxChars).join("");
}
