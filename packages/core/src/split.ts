import { extractChapterOrder } from "./vendor/novel-processor/novel";
import { detectChapterUnit, isChapterTitleLine } from "./vendor/novel-processor/regex";
import { orderByNumber } from "./numbering";
import type { ChapterDraft } from "./types";

export type { ChapterDraft };

export interface SplitOptions {
  /** 自定义章节标题正则；为 null 时使用内置规则。 */
  chapterPattern: string | null;
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
  for (const segment of chapterSegments(lines, options.chapterPattern)) {
    // 有标题的章节，正文从标题的下一行开始。
    const bodyFrom = segment.titleLine === null ? segment.from : segment.titleLine + 1;
    chapters.push({ order: chapters.length, title: segment.title, number: segment.number, ...bodyRange(bodyFrom, segment.to) });
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
}

/** 按章节标题把正文的行分段，每段对应一个章节。 */
function chapterSegments(lines: string[], pattern: string | null): Segment[] {
  const isTitle = titleMatcher(lines, pattern);
  const titleLines: number[] = [];
  lines.forEach((line, i) => {
    if (isTitle(line)) titleLines.push(i);
  });
  if (titleLines.length === 0) {
    return [{ title: WHOLE_BOOK_TITLE, number: null, titleLine: null, from: 0, to: lines.length }];
  }
  const segments: Segment[] = [];
  const firstTitle = titleLines[0]!;
  if (lines.slice(0, firstTitle).some((line) => line.trim())) {
    segments.push({ title: PREFACE_TITLE, number: null, titleLine: null, from: 0, to: firstTitle });
  }
  titleLines.forEach((lineIndex, k) => {
    const title = lines[lineIndex]!.trim();
    // 第一个标题前只有空行时，这些空行并入第一章。
    const from = k === 0 && segments.length === 0 ? 0 : lineIndex;
    segments.push({ title, number: extractChapterOrder(title), titleLine: lineIndex, from, to: titleLines[k + 1] ?? lines.length });
  });
  return segments;
}

/** 按章节序号重排正文中各章节的位置（规则见 orderByNumber），返回重排后的正文。 */
export function reorderTextByNumber(text: string, options: SplitOptions): string {
  const lines = text.split("\n");
  const segments = chapterSegments(lines, options.chapterPattern);
  const order = orderByNumber(segments.map((s, i) => ({ order: i, number: s.number })));
  return order.map((i) => lines.slice(segments[i]!.from, segments[i]!.to).join("\n")).join("\n");
}

function titleMatcher(lines: string[], pattern: string | null): (line: string) => boolean {
  if (pattern) {
    const error = checkChapterPattern(pattern);
    if (error) throw new Error(`invalid chapter pattern: ${error}`);
    const re = new RegExp(pattern);
    return (line) => {
      const t = line.trim();
      return t.length > 0 && re.test(t);
    };
  }
  const unit = detectChapterUnit(lines);
  return (line) => isChapterTitleLine(line, unit);
}
