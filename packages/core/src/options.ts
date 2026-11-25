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
  /** 本书的章节标题正则；为 null 时只用内置规则。只按书设置。 */
  chapterPattern: string | null;
  /** extend：本书正则补充内置规则；replace：只用本书正则。只按书设置。 */
  chapterPatternMode: "extend" | "replace";
  /** 所有者选择修复的章节序号异常（异常的 key）。只按书设置；系统不自动修复。 */
  numberFixes: string[];
  /** 所有者选择忽略的章节序号异常（异常的 key）。只按书设置。 */
  numberIgnores: string[];
  /** AI 复核得出的行级修正（ADR 0007），见 line-review.ts 的 lineOverrideKey。只按书设置。 */
  lineOverrides: string[];
  /** 所有者忽略的 AI 复核结果，见 line-review.ts 的 lineOverrideKey。只按书设置。 */
  lineIgnores: string[];
}

export const DEFAULT_PROCESS_OPTIONS: Readonly<ProcessOptions> = Object.freeze({
  smartLineBreak: true,
  indent: true,
  trimLines: true,
  splitInlineChapterTitles: false,
  mergeDuplicateChapterTitles: true,
  removeDuplicateLines: true,
  paragraphSplit: false,
  removeLineEndNumbers: false,
  specialStart: "",
  filterWords: [],
  filterMaxLineLength: 0,
  chapterPattern: null,
  chapterPatternMode: "extend",
  numberFixes: [],
  numberIgnores: [],
  lineOverrides: [],
  lineIgnores: [],
});

/** 每本书最多记录的修复或忽略条数。 */
export const MAX_NUMBER_REVIEWS = 20_000;
const MAX_REVIEW_KEY_LENGTH = 300;

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

/** 按书记录的异常处理与 AI 修正：字符串数组，每条不超过 MAX_REVIEW_KEY_LENGTH。 */
const REVIEW_KEYS = ["numberFixes", "numberIgnores", "lineOverrides", "lineIgnores"] as const satisfies readonly (keyof ProcessOptions)[];

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
  // 早期保存的整理选项没有这一项；那时本书正则会替换内置规则。
  const mode = v.chapterPatternMode ?? "replace";
  if (mode !== "extend" && mode !== "replace") return { ok: false, error: "chapterPatternMode must be extend or replace" };
  // 早期保存的整理选项没有这几项，视为没有处理过异常。
  const reviews: Record<(typeof REVIEW_KEYS)[number], string[]> = { numberFixes: [], numberIgnores: [], lineOverrides: [], lineIgnores: [] };
  for (const key of REVIEW_KEYS) {
    const list = v[key] ?? [];
    if (
      !Array.isArray(list) ||
      list.length > MAX_NUMBER_REVIEWS ||
      !list.every((k) => typeof k === "string" && k.length > 0 && k.length <= MAX_REVIEW_KEY_LENGTH)
    ) {
      return { ok: false, error: `${key} must be an array of at most ${MAX_NUMBER_REVIEWS} non-empty strings` };
    }
    reviews[key] = [...new Set(list as string[])];
  }
  const options = { ...DEFAULT_PROCESS_OPTIONS } as ProcessOptions;
  for (const key of BOOLEAN_KEYS) options[key] = v[key] as boolean;
  return {
    ok: true,
    options: {
      ...options,
      specialStart: v.specialStart,
      filterWords,
      filterMaxLineLength: max,
      chapterPattern: pattern,
      chapterPatternMode: mode,
      ...reviews,
    },
  };
}
