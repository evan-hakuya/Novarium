import { decodeFileBytes } from "./vendor/novel-processor/encoding";

/**
 * 把原稿字节解码为文本。支持 UTF-8（含 BOM）、UTF-16、GBK/GB18030、Big5 等。
 * 识别不出编码时抛出错误，不会退回到 UTF-8 产出乱码。
 */
export function decodeManuscript(bytes: Uint8Array): Promise<string> {
  // 带 BOM 的 UTF-16 直接按 BOM 解码。上游把它交给 jschardet，而 jschardet 对
  // UTF-16BE 只返回 "UTF-16"，TextDecoder 会按小端解码出乱码。
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Promise.resolve(new TextDecoder("utf-16be").decode(bytes));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return Promise.resolve(new TextDecoder("utf-16le").decode(bytes));
  return decodeFileBytes(bytes);
}
