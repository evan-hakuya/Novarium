// 整理选项：一次整理所用的全部设置。每个版本记录生成它的整理选项。
export interface ProcessOptions {
  /** 根据中文标点重新合并错误断开的段落。 */
  smartLineBreak: boolean;
  /** 段首加两个全角空格（仅在 smartLineBreak 打开时生效）。 */
  indent: boolean;
  /** 删除每行首尾的空白。 */
  trimLines: boolean;
  /** 把与正文挤在同一行的章节标题拆到独立的一行。 */
  splitInlineChapterTitles: boolean;
  /** 合并相邻或隔一行重复出现的同章标题。 */
  mergeDuplicateChapterTitles: boolean;
  /** 删除相邻的重复行。 */
  removeDuplicateLines: boolean;
  /** 把过长的段落按句子拆短。 */
  paragraphSplit: boolean;
  /** 删除长行末尾的数字（常见于抓取残留的页码）。 */
  removeLineEndNumbers: boolean;
  /** 以此文本开头的行强制独立成段，例如书名。空字符串表示不启用。 */
  specialStart: string;
  /** 过滤词表：删除含这些词的行。 */
  filterWords: string[];
  /** 长度超过此值的行不受过滤词表影响，用于保护正文；0 表示不豁免。 */
  filterMaxLineLength: number;
  /** 本书的章节标题正则；为 null 时使用内置规则。 */
  chapterPattern: string | null;
}

export const DEFAULT_PROCESS_OPTIONS: Readonly<ProcessOptions> = Object.freeze({
  smartLineBreak: true,
  indent: true,
  trimLines: true,
  splitInlineChapterTitles: true,
  mergeDuplicateChapterTitles: true,
  removeDuplicateLines: true,
  paragraphSplit: false,
  removeLineEndNumbers: false,
  specialStart: "",
  filterWords: [],
  filterMaxLineLength: 0,
  chapterPattern: null,
});

/** 过滤词表的上限，防止异常输入。 */
export const MAX_FILTER_WORDS = 1000;
export const MAX_FILTER_WORD_LENGTH = 100;
export const MAX_CHAPTER_PATTERN_LENGTH = 500;

const BOOLEAN_KEYS = [
  "smartLineBreak",
  "indent",
  "trimLines",
  "splitInlineChapterTitles",
  "mergeDuplicateChapterTitles",
  "removeDuplicateLines",
  "paragraphSplit",
  "removeLineEndNumbers",
] as const satisfies readonly (keyof ProcessOptions)[];

/**
 * 校验来自客户端或数据库的整理选项。服务端不得信任客户端。
 * 过滤词会去掉首尾空白、去重并丢弃空词。
 */
export function parseProcessOptions(
  value: unknown,
): { ok: true; options: ProcessOptions } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "options must be an object" };
  const v = value as Record<string, unknown>;
  for (const key of BOOLEAN_KEYS) {
    if (typeof v[key] !== "boolean") return { ok: false, error: `${key} must be a boolean` };
  }
  if (typeof v.specialStart !== "string" || v.specialStart.length > 100) {
    return { ok: false, error: "specialStart must be a string of at most 100 characters" };
  }
  if (!Array.isArray(v.filterWords) || !v.filterWords.every((w) => typeof w === "string")) {
    return { ok: false, error: "filterWords must be an array of strings" };
  }
  const filterWords = [...new Set((v.filterWords as string[]).map((w) => w.trim()).filter(Boolean))];
  if (filterWords.length > MAX_FILTER_WORDS) return { ok: false, error: `at most ${MAX_FILTER_WORDS} filter words` };
  if (filterWords.some((w) => w.length > MAX_FILTER_WORD_LENGTH)) {
    return { ok: false, error: `each filter word must be at most ${MAX_FILTER_WORD_LENGTH} characters` };
  }
  const max = v.filterMaxLineLength;
  if (typeof max !== "number" || !Number.isSafeInteger(max) || max < 0 || max > 100_000) {
    return { ok: false, error: "filterMaxLineLength must be an integer between 0 and 100000" };
  }
  const pattern = v.chapterPattern;
  if (pattern !== null && (typeof pattern !== "string" || !pattern || pattern.length > MAX_CHAPTER_PATTERN_LENGTH)) {
    return { ok: false, error: `chapterPattern must be null or a non-empty string of at most ${MAX_CHAPTER_PATTERN_LENGTH} characters` };
  }
  if (typeof pattern === "string") {
    try {
      new RegExp(pattern);
    } catch {
      return { ok: false, error: "chapterPattern is not a valid regular expression" };
    }
  }
  const options = { ...DEFAULT_PROCESS_OPTIONS } as ProcessOptions;
  for (const key of BOOLEAN_KEYS) options[key] = v[key] as boolean;
  return {
    ok: true,
    options: { ...options, specialStart: v.specialStart, filterWords, filterMaxLineLength: max, chapterPattern: pattern },
  };
}
