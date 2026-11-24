import { extractChapterOrder } from "./vendor/novel-processor/novel";
import { detectChapterUnit, isChapterTitleLine } from "./vendor/novel-processor/regex";

/** 分章结果中的一个章节。偏移与长度都以整理后正文的 UTF-8 字节计算。 */
export interface ChapterDraft {
  /** 阅读顺序，从 0 开始连续编号。 */
  order: number;
  title: string;
  /** 章节序号；序章、番外这类没有编号的章节为 null。 */
  number: number | null;
  /** 正文（不含标题行）在整理后正文中的起始字节。 */
  byteOffset: number;
  /** 正文的字节长度；空章节为 0。 */
  byteLength: number;
}

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
  const isTitle = titleMatcher(lines, options.chapterPattern);

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

  const titleLines: number[] = [];
  lines.forEach((line, i) => {
    if (isTitle(line)) titleLines.push(i);
  });

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
  const push = (title: string, number: number | null, from: number, to: number) => {
    chapters.push({ order: chapters.length, title, number, ...bodyRange(from, to) });
  };

  if (titleLines.length === 0) {
    push(WHOLE_BOOK_TITLE, null, 0, lines.length);
    return chapters;
  }

  const firstTitle = titleLines[0]!;
  if (lines.slice(0, firstTitle).some((line) => line.trim())) {
    push(PREFACE_TITLE, null, 0, firstTitle);
  }
  titleLines.forEach((lineIndex, k) => {
    const title = lines[lineIndex]!.trim();
    const end = titleLines[k + 1] ?? lines.length;
    push(title, extractChapterOrder(title), lineIndex + 1, end);
  });
  return chapters;
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
