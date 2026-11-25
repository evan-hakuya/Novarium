import { extractChapterOrder } from "./vendor/novel-processor/novel";
import { CHAPTER_TITLE_MAX_LEN, detectChapterUnit, isChapterTitleLine } from "./vendor/novel-processor/regex";
import { applyNumberFixes, findNumberAnomalies } from "./numbering";
import { candidateLines, lineIds, lineOverrideMap, markSuspicious, type CandidateLine } from "./line-review";
import type { ChapterDraft } from "./types";

export type { ChapterDraft };

/** 本书章节正则与内置规则的关系：extend 两者任一命中即为标题；replace 只用本书正则。 */
export type ChapterPatternMode = "extend" | "replace";

export interface SplitOptions {
  /** 本书的章节标题正则；为 null 时只用内置规则。 */
  chapterPattern: string | null;
  /** 缺省为 extend。 */
  chapterPatternMode?: ChapterPatternMode;
  /** AI 复核得出的行级修正，优先于规则（见 line-review.ts）。 */
  lineOverrides?: readonly string[];
}

/** 第一个章节标题之前有正文时，这段正文作为一个章节，使用此标题。 */
export const PREFACE_TITLE = "前言";
/** 全文找不到任何章节标题时，整本书作为一个章节，使用此标题。 */
export const WHOLE_BOOK_TITLE = "正文";

const encoder = new TextEncoder();
const utf8Length = (s: string) => encoder.encode(s).length;

/** 校验自定义章节正则；无效时返回错误信息，有效时返回 null。 */
export function checkChapterPattern(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * 把整理后的正文切分为章节。正文本身不改动：调用方把 `text` 按 UTF-8 存成版本文件，
 * 再用每个章节的字节偏移和长度读取章节正文。
 */
export function splitChapters(text: string, options: SplitOptions): ChapterDraft[] {
  const lines = text.split("\n");
  const lineStart: number[] = [];
  const lineBytes: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineStart.push(pos);
    const len = utf8Length(line);
    lineBytes.push(len);
    pos += len + 1;
  }
  const totalBytes = Math.max(0, pos - 1);

  // 章节正文的字节范围：去掉首尾空行。
  const bodyRange = (from: number, to: number) => {
    let first = from;
    while (first < to && !lines[first]!.trim()) first++;
    let last = to - 1;
    while (last >= first && !lines[last]!.trim()) last--;
    if (first > last) {
      const at = from < lines.length ? lineStart[from]! : totalBytes;
      return { byteOffset: at, byteLength: 0 };
    }
    const byteOffset = lineStart[first]!;
    return { byteOffset, byteLength: lineStart[last]! + lineBytes[last]! - byteOffset };
  };

  const chapters: ChapterDraft[] = [];
  for (const segment of chapterSegments(lines, options)) {
    if (!segment.isChapter) continue;
    // 有标题的章节，正文从标题的下一行开始。
    const bodyFrom = segment.titleLine === null ? segment.from : segment.titleLine + 1;
    chapters.push({
      order: chapters.length,
      title: segment.title,
      number: segment.number,
      volume: segment.volume,
      ...bodyRange(bodyFrom, segment.to),
    });
  }
  return chapters;
}

interface Segment {
  title: string;
  number: number | null;
  /** 标题所在行；前言与无标题的全文为 null。 */
  titleLine: number | null;
  /** 行范围 [from, to)，含标题行。所有段首尾相接，覆盖全部行。 */
  from: number;
  to: number;
  /** 所属卷的标题；没有卷时为 null。 */
  volume: string | null;
  /** 卷标题所在的段：它不随章节修复移动，并开始一个新的分卷。 */
  volumeStart: boolean;
  /** 是否生成章节。卷标题与第一章之间没有正文时，卷标题段不生成章节。 */
  isChapter: boolean;
}

const VOLUME_NUMERAL = "[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+";
const volumeHeadRegex = new RegExp(
  `^(?:第\\s*${VOLUME_NUMERAL}\\s*([卷部])|卷\\s*${VOLUME_NUMERAL}|[上中下]\\s*[卷部册])(?=$|[\\s：:·\\-—（(【「《])`,
);
const chapterInVolumeTitleRegex = new RegExp(`第?\\s*${VOLUME_NUMERAL}\\s*[章节回]`);

/**
 * 卷标题：「第一卷 xxx」「卷三」「上卷」「第二部 xxx」这类短行。
 * 这本书本身用「卷」或「部」作章节单位时，它们是章节，不是卷。
 * 「第一卷 第三章 xxx」这类带章节号的行仍是章节标题。
 */
function volumeMatcher(unit: string | null): (line: string) => boolean {
  return (line) => {
    const t = line.trim();
    if (!t || [...t].length > CHAPTER_TITLE_MAX_LEN || /[。！？!?]$/.test(t)) return false;
    const m = volumeHeadRegex.exec(t);
    if (!m) return false;
    if (m[1] && m[1] === unit) return false;
    if (unit === "卷" && !m[1]) return false;
    return !chapterInVolumeTitleRegex.test(t.slice(m[0].length));
  };
}

/** 整理时判断卷标题行，使它独立成段。不区分章节单位：把章节标题当作独立行也不影响结果。 */
export const isVolumeTitleLine = volumeMatcher(null);

/**
 * 按章节标题与卷标题把正文的行分段。卷标题之后的章节都属于这一卷，直到下一个卷标题。
 * 卷标题与第一章之间有正文时（如卷首语），这段正文作为一个以卷标题为标题的章节。
 */
/** 只按规则（不含行级修正）判断的标题行：行下标 → 章节或卷。 */
function ruleTitleLines(lines: string[], options: SplitOptions): Map<number, "chapter" | "volume"> {
  const unit = detectChapterUnit(lines);
  const isTitle = titleMatcher(lines, options, unit);
  // 只用本书正则时，所有者完全接管标题识别，不再识别卷。
  const isVolume = options.chapterPatternMode === "replace" && options.chapterPattern ? () => false : volumeMatcher(unit);
  const kinds = new Map<number, "chapter" | "volume">();
  lines.forEach((line, i) => {
    if (isVolume(line)) kinds.set(i, "volume");
    else if (isTitle(line)) kinds.set(i, "chapter");
  });
  return kinds;
}

/** 整理后正文中交给 AI 复核的候选行（GLOSSARY「候选行」），并标出其中可疑的行。 */
export function findCandidateLines(text: string, options: SplitOptions): CandidateLine[] {
  const lines = text.split("\n");
  const candidates = candidateLines(lines, ruleTitleLines(lines, options));
  const chapters = splitChapters(text, options);
  // 涉及序号异常的章节：乱序、重复编号，以及缺号前后的两章。分卷边界系统已自动处理，不算。
  const anomalous = new Set<number>();
  for (const a of findNumberAnomalies(chapters)) {
    if (a.kind === "missing") anomalous.add(a.after).add(a.after + 1);
    else if (a.kind === "duplicate") a.orders.forEach((o) => anomalous.add(o));
    else if (a.kind === "outOfOrder") anomalous.add(a.order);
  }
  const bytes = encoder.encode(text);
  const decoder = new TextDecoder();
  return markSuspicious(
    candidates,
    chapters.map((c) => ({
      title: c.title,
      byteOffset: c.byteOffset,
      chars: decoder.decode(bytes.subarray(c.byteOffset, c.byteOffset + c.byteLength)).replace(/\s/g, "").length,
      numberAnomaly: anomalous.has(c.order),
    })),
  );
}

function chapterSegments(lines: string[], options: SplitOptions): Segment[] {
  const kinds = ruleTitleLines(lines, options);
  // 行级修正优先于规则：可以把正文行设为章节或卷，也可以把标题行设为正文。
  const overrides = lineOverrideMap(options.lineOverrides);
  if (overrides.size > 0) {
    lineIds(lines).forEach((id, i) => {
      const kind = id ? overrides.get(id) : undefined;
      if (kind === "body") kinds.delete(i);
      else if (kind) kinds.set(i, kind);
    });
  }
  const titleLines = [...kinds].sort((a, b) => a[0] - b[0]).map(([line, kind]) => ({ line, volume: kind === "volume" }));
  if (titleLines.length === 0) {
    return [
      { title: WHOLE_BOOK_TITLE, number: null, titleLine: null, from: 0, to: lines.length, volume: null, volumeStart: false, isChapter: true },
    ];
  }
  const segments: Segment[] = [];
  const firstTitle = titleLines[0]!.line;
  if (lines.slice(0, firstTitle).some((line) => line.trim())) {
    segments.push({ title: PREFACE_TITLE, number: null, titleLine: null, from: 0, to: firstTitle, volume: null, volumeStart: false, isChapter: true });
  }
  let volume: string | null = null;
  titleLines.forEach(({ line: lineIndex, volume: isVolumeLine }, k) => {
    const title = lines[lineIndex]!.trim();
    // 第一个标题前只有空行时，这些空行并入第一章。
    const from = k === 0 && segments.length === 0 ? 0 : lineIndex;
    const to = titleLines[k + 1]?.line ?? lines.length;
    if (isVolumeLine) {
      volume = title;
      const hasBody = lines.slice(lineIndex + 1, to).some((line) => line.trim());
      segments.push({ title, number: null, titleLine: lineIndex, from, to, volume, volumeStart: true, isChapter: hasBody });
    } else {
      segments.push({ title, number: extractChapterOrder(title), titleLine: lineIndex, from, to, volume, volumeStart: false, isChapter: true });
    }
  });
  return segments;
}

/** 按所有者选择的修复调整正文中各章节的位置（规则见 applyNumberFixes），返回调整后的正文。 */
export function applyNumberFixesToText(text: string, options: SplitOptions, fixes: readonly string[]): string {
  const lines = text.split("\n");
  const segments = chapterSegments(lines, options);
  const order = applyNumberFixes(
    segments.map((s, i) => ({ order: i, title: s.title, number: s.number, volume: s.volume, volumeStart: s.volumeStart })),
    fixes,
  );
  return order.map((i) => lines.slice(segments[i]!.from, segments[i]!.to).join("\n")).join("\n");
}

/**
 * 判断一行是不是章节标题。内置规则不是单个正则：它组合多条正则、标题长度上限、句末标点判断，
 * 以及按全文统计出的章节单位（章/回/节…），因此无法作为正则交给所有者编辑。
 * 本书正则命中的行同样受标题长度上限约束，避免把正文中提到同一词语的长句当作标题。
 */
function titleMatcher(lines: string[], options: SplitOptions, unit = detectChapterUnit(lines)): (line: string) => boolean {
  const builtin = (line: string) => isChapterTitleLine(line, unit);
  const custom = customTitleMatcher(options.chapterPattern);
  if (!custom) return builtin;
  return options.chapterPatternMode === "replace" ? custom : (line) => builtin(line) || custom(line);
}

/** 本书章节正则的匹配函数；没有本书正则时返回 null。只匹配不超过标题长度上限的行。 */
export function customTitleMatcher(pattern: string | null): ((line: string) => boolean) | null {
  if (!pattern) return null;
  const error = checkChapterPattern(pattern);
  if (error) throw new Error(`invalid chapter pattern: ${error}`);
  const re = new RegExp(pattern);
  return (line) => {
    const t = line.trim();
    return t.length > 0 && [...t].length <= CHAPTER_TITLE_MAX_LEN && re.test(t);
  };
}
