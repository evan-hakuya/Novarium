import type { ChapterDraft } from "./types";

// 服务端只依赖这个入口：整理选项的校验也从这里导出。
export { parseProcessOptions, DEFAULT_PROCESS_OPTIONS, type ProcessOptions } from "./options";

/** 一个版本最多允许的章节数，防止异常输入拖垮数据库。 */
export const MAX_CHAPTERS = 20_000;
export const MAX_TITLE_LENGTH = 200;

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * 校验客户端提交的章节索引。服务端不得信任客户端，提交前必须调用。
 * 只做结构校验（不读正文）：顺序连续、范围不越界、章节之间不重叠且按阅读顺序排列。
 * 返回错误信息列表；为空表示通过。
 */
export function validateChapterIndex(chapters: unknown, textByteLength: number): string[] {
  if (!Array.isArray(chapters)) return ["chapters must be an array"];
  if (chapters.length === 0) return ["at least one chapter is required"];
  if (chapters.length > MAX_CHAPTERS) return [`too many chapters: ${chapters.length} > ${MAX_CHAPTERS}`];

  const errors: string[] = [];
  const fail = (i: number, message: string) => {
    if (errors.length < 20) errors.push(`chapter ${i}: ${message}`);
  };
  let previousEnd = 0;
  chapters.forEach((raw: unknown, i) => {
    const c = (raw ?? {}) as Partial<Record<keyof ChapterDraft, unknown>>;
    if (c.order !== i) fail(i, `order must be ${i}`);
    if (typeof c.title !== "string" || !c.title.trim()) fail(i, "title must be a non-empty string");
    else if (c.title.length > MAX_TITLE_LENGTH) fail(i, `title longer than ${MAX_TITLE_LENGTH}`);
    if (c.number !== null && !isCount(c.number)) fail(i, "number must be null or a non-negative integer");
    if (!isCount(c.byteOffset) || !isCount(c.byteLength)) {
      fail(i, "byteOffset and byteLength must be non-negative integers");
      return;
    }
    if (c.byteOffset < previousEnd) fail(i, "overlaps the previous chapter or is out of reading order");
    if (c.byteOffset + c.byteLength > textByteLength) fail(i, "range exceeds the version text");
    previousEnd = c.byteOffset + c.byteLength;
  });
  return errors;
}
