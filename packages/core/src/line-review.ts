// AI 复核（ADR 0007）用到的行：候选行的识别与行级修正的记法。只看整理后的正文，不调用 AI。

import { LEAVE_WORDS, NOTICE_WORDS } from "./notice-words";

/** 一行的类别。notice 是作者公告的标题：单独成章，不带序号（GLOSSARY「作者公告」）。 */
export type LineKind = "chapter" | "volume" | "notice" | "body";
/** 标题行的类别。 */
export type TitleKind = Exclude<LineKind, "body">;

/** 提示词改动时加 1：浏览器中缓存的旧结果随之失效。 */
export const AI_LINE_PROMPT_VERSION = 1;
/** 每次调用 clef 的题数上限（questions 的 maxProperties）。 */
export const AI_LINE_BATCH_SIZE = 64;
/** 单次复核最多判断的候选行数（10 批）。 */
export const AI_LINES_PER_RUN = 640;
/** 置信度不低于此值的结果直接采用，低于此值的交给所有者确认。 */
export const AI_CONFIDENT = 0.8;
/** 判断 1 行约占每日免费额度（10,000 Neurons）的百分比：实测 1,000 行约 45%。 */
export const AI_QUOTA_PERCENT_PER_LINE = 0.045;

/**
 * 一行在整理后正文中的标识：去掉首尾空白后的文字，加上它是第几次出现（从 0 开始）。
 * 不用行号：清洗选项改变时行号会变，文字与出现次序通常不变。
 */
export const lineId = (text: string, occurrence: number) => `${occurrence}|${text}`;

/** 行级修正与忽略记录的 key：`类别|出现次序|文字`。 */
export const lineOverrideKey = (kind: LineKind, text: string, occurrence: number) => `${kind}|${lineId(text, occurrence)}`;

export function parseLineOverrideKey(key: string): { kind: LineKind; text: string; occurrence: number; id: string } | null {
  const [kind, occurrence, ...rest] = key.split("|");
  const text = rest.join("|");
  if (!(kind === "chapter" || kind === "volume" || kind === "notice" || kind === "body") || !occurrence || !/^\d+$/.test(occurrence) || !text) {
    return null;
  }
  return { kind, text, occurrence: Number(occurrence), id: lineId(text, Number(occurrence)) };
}

/** 整理选项中的行级修正，按行标识索引。 */
export function lineOverrideMap(keys: readonly string[] | undefined): Map<string, LineKind> {
  const map = new Map<string, LineKind>();
  for (const key of keys ?? []) {
    const parsed = parseLineOverrideKey(key);
    if (parsed) map.set(parsed.id, parsed.kind);
  }
  return map;
}

/** 给每行编上标识：空行为 null。 */
export function lineIds(lines: readonly string[]): (string | null)[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const text = line.trim();
    if (!text) return null;
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return lineId(text, n);
  });
}

/** 交给 AI 判断的一行。 */
export interface CandidateLine {
  /** 行标识，见 lineId。 */
  id: string;
  text: string;
  occurrence: number;
  /** 上一行（可能是空行）。 */
  prev: string;
  /** 下一个非空行；没有时为空串。 */
  next: string;
  /** 本行与下一个非空行之间隔着空行。 */
  gap: boolean;
  /** 只按规则（不含行级修正）给出的类别。 */
  rule: LineKind;
  /** 本行在整理后正文中的起始字节，用于定位章节。 */
  byteOffset: number;
  /** 优先判断：规则最可能出错的行。单次复核有上限时先发送这些行。 */
  priority: boolean;
  /** 可疑：「AI 复核可疑行」只发送这些行，见 markSuspicious。 */
  suspicious: boolean;
}

/** 番外、后记这类非「第 N 章」的标题用词：找候选行与清洗时保持单独成行都用它。 */
const EXTRA_TITLE_WORDS = /番外|完结|后记|尾声|楔子|序章|终章/;
/** 规则判为正文、但像标题的短行：含这些词之一。 */
const NEAR_MISS_WORDS = new RegExp(`第|卷|${EXTRA_TITLE_WORDS.source}|${NOTICE_WORDS.source}`);
/** 规则判为章节、且有「第 N 章/回/节」编号的行：规则基本不会错，排在后面。 */
const NUMBERED_TITLE = /^第\s*[〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟\d]+\s*[章回节]/;
const MAX_TITLE_CHARS = 40;
/** 单独成行的短行：疑似作者公告与卷名的长度上限。正文折行的片段通常更长。 */
const SHORT_LINE_CHARS = 20;

const encoder = new TextEncoder();

/**
 * 候选行：规则已识别为章节或卷的行，以及规则未识别、但较短且含关键词的行（GLOSSARY「候选行」）。
 * ruleKinds 是规则给出的标题行类别（行下标 → 类别）。
 * firstChapters 是规则判为第 1 章的标题行下标（含序号重置）：它前面的短行可能是规则漏判的卷名，也作为候选行。
 */
export function candidateLines(
  lines: readonly string[],
  ruleKinds: ReadonlyMap<number, TitleKind>,
  firstChapters: Iterable<number> = [],
): CandidateLine[] {
  const ids = lineIds(lines);
  const leads = new Set<number>();
  for (const t of firstChapters) {
    const j = leadLine(lines, t);
    if (j !== null && !ruleKinds.has(j)) leads.add(j);
  }
  const candidates: CandidateLine[] = [];
  let offset = 0;
  lines.forEach((line, i) => {
    const byteOffset = offset;
    offset += encoder.encode(line).length + 1;
    const id = ids[i];
    if (!id) return;
    const text = line.trim();
    const rule = ruleKinds.get(i) ?? "body";
    if (rule === "body" && (isPostscript(text) || (!looksLikeTitle(text) && !leads.has(i)))) return;
    let k = i + 1;
    while (k < lines.length && !lines[k]!.trim()) k++;
    candidates.push({
      id,
      text,
      occurrence: Number(id.slice(0, id.indexOf("|"))),
      prev: lines[i - 1] ?? "",
      next: lines[k] ?? "",
      gap: k > i + 1,
      rule,
      byteOffset,
      priority: rule !== "chapter" || !NUMBERED_TITLE.test(text),
      suspicious: false,
    });
  });
  return candidates;
}

/** 章节正文不到这么多字时，它的标题算可疑：请假条、感言这类作者公告通常很短。 */
export const SHORT_CHAPTER_CHARS = 500;
/** 一个章节在可疑判断中用到的信息。 */
export interface ChapterSignal {
  title: string;
  /** 正文（不含标题行）的起始字节。 */
  byteOffset: number;
  /** 正文字数。 */
  chars: number;
  /** 这个章节涉及章节序号异常（乱序、重复编号、缺号前后）。 */
  numberAnomaly: boolean;
}

/**
 * 标出可疑的候选行（ADR 0007）：
 * 1. 优先行：规则漏判的短行，以及没有「第 N 章」编号的标题；
 * 2. 涉及章节序号异常的章节标题；
 * 3. 正文不到 SHORT_CHAPTER_CHARS 字的章节标题；
 * 4. 含作者公告用词的行，例如「第 100 章 请假」。
 * 第 1 章前的短行（见 candidateLines）规则判为正文或卷（#105），都属于第 1 类。
 * 其余编号连续、正文正常的「第 N 章」标题直接相信规则。
 */
export function markSuspicious(candidates: readonly CandidateLine[], chapters: readonly ChapterSignal[]): CandidateLine[] {
  let k = 0;
  return candidates.map((c) => {
    // 标题行所在的章节：标题相同、正文从这一行之后开始的第一个章节。两者都按位置排序。
    while (k < chapters.length && chapters[k]!.byteOffset <= c.byteOffset) k++;
    const chapter = c.rule !== "body" && chapters[k]?.title === c.text ? chapters[k] : undefined;
    const suspicious =
      c.priority ||
      NOTICE_WORDS.test(c.text) ||
      (!!chapter && (chapter.numberAnomaly || chapter.chars < SHORT_CHAPTER_CHARS));
    return { ...c, suspicious };
  });
}

/** 形状像标题：不以引号、括号开头，不以标点结尾。 */
const titleShaped = (text: string) => !/^[「『“"'‘（(【《]/.test(text) && !/[。！？!?…”」』】—，,；;：:]$/.test(text);

function looksLikeTitle(text: string): boolean {
  return [...text].length <= MAX_TITLE_CHARS && titleShaped(text) && NEAR_MISS_WORDS.test(text);
}

const isShortLine = (text: string) => [...text].length <= SHORT_LINE_CHARS && titleShaped(text);

/** 章末附言：以 PS、P.S.、PPS 开头（可带编号，如 PS2），后跟冒号。它属于本章正文，不是标题或作者公告。 */
const isPostscript = (text: string) => /^p{1,2}\.?\s*s\.?\s*\d*\s*[:：]/i.test(text);

/** 标题行 t 前面最近的非空行，是不超过 20 字、形状像标题的短行（附言除外）时返回它的下标，否则返回 null。 */
export function leadLine(lines: readonly string[], t: number): number | null {
  let j = t - 1;
  while (j >= 0 && !lines[j]!.trim()) j--;
  return j >= 0 && isShortLine(lines[j]!.trim()) && !isPostscript(lines[j]!.trim()) ? j : null;
}

/** 清洗时保持单独成行的词：请假条用词与标题用词。「第」「卷」在折行正文的片段里太常见，不在其中。 */
const KEEP_LINE_WORDS = new RegExp(`${LEAVE_WORDS.source}|${EXTRA_TITLE_WORDS.source}`);

/**
 * 疑似作者公告或标题的独立短行，例如「生病了，请假一天」「个人番外篇 : 与你相配」。
 * 清洗时它保持单独成行（单独成段、没有缩进），不与下一行正文合并，这样它会成为候选行，交给 AI 判断；规则仍判为正文。
 */
export const isKeptShortLine = (line: string) => {
  const text = line.trim();
  return isShortLine(text) && KEEP_LINE_WORDS.test(text);
};
