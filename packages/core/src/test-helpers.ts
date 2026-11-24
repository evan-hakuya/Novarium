import iconv from "iconv-lite";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (s: string) => encoder.encode(s);
export const encodeAs = (s: string, encoding: string) => new Uint8Array(iconv.encode(s, encoding));

/** 按章节的字节范围从整理后正文中读出章节正文，模拟服务端的 Range 读取。 */
export function readChapter(text: string, chapter: { byteOffset: number; byteLength: number }): string {
  const bytes = utf8(text);
  return decoder.decode(bytes.subarray(chapter.byteOffset, chapter.byteOffset + chapter.byteLength));
}

// 一段足够长的中文正文，给编码检测提供统计特征。
export const SAMPLE_PROSE =
  "夜色渐深，城门外的长街上只剩下几盏摇晃的灯笼。少年背着行囊，踩着湿漉漉的青石板，一步一步走向远处的客栈。" +
  "掌柜抬头看了他一眼，又低下头去拨弄算盘，仿佛这样的旅人每天都要见上好几回。";
