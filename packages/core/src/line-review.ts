// AI 复核（ADR 0007）用到的行：候选行的识别与行级修正的记法。只看整理后的正文，不调用 AI。

/** 一行的类别。notice 是作者公告，只作为 AI 的判断出现，不直接改变分章。 */
export type LineKind = "chapter" | "volume" | "notice" | "body";
/** 规则或修正能给一行定的类别。 */
export type SplitLineKind = Exclude<LineKind, "notice">;

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

/** 整理选项中的行级修正，按行标识索引。只保留能改变分章的类别。 */
export function lineOverrideMap(keys: readonly string[] | undefined): Map<string, SplitLineKind> {
  const map = new Map<string, SplitLineKind>();
  for (const key of keys ?? []) {
    const parsed = parseLineOverrideKey(key);
    if (parsed && parsed.kind !== "notice") map.set(parsed.id, parsed.kind);
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
  rule: SplitLineKind;
  /** 本行在整理后正文中的起始字节，用于定位章节。 */
  byteOffset: number;
  /** 优先判断：规则最可能出错的行。单次复核有上限时先发送这些行。 */
  priority: boolean;
  /** 可疑：「AI 复核可疑行」只发送这些行，见 markSuspicious。 */
  suspicious: boolean;
}

/** 规则判为正文、但像标题的短行：含这些词之一。 */
const NEAR_MISS_WORDS = /第|番外|卷|请假|感言|公告|上架|完本|完结|后记|尾声|楔子|序章|终章|单章|说明/;
/** 规则判为章节、且有「第 N 章/回/节」编号的行：规则基本不会错，排在后面。 */
const NUMBERED_TITLE = /^第\s*[〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟\d]+\s*[章回节]/;
const MAX_TITLE_CHARS = 40;

const encoder = new TextEncoder();

/**
 * 候选行：规则已识别为章节或卷的行，以及规则未识别、但较短且含关键词的行（GLOSSARY「候选行」）。
 * ruleKinds 是规则给出的标题行类别（行下标 → 类别）。
 */
export function candidateLines(lines: readonly string[], ruleKinds: ReadonlyMap<number, "chapter" | "volume">): CandidateLine[] {
  const ids = lineIds(lines);
  const candidates: CandidateLine[] = [];
  let offset = 0;
  lines.forEach((line, i) => {
    const byteOffset = offset;
    offset += encoder.encode(line).length + 1;
    const id = ids[i];
    if (!id) return;
    const text = line.trim();
    const rule = ruleKinds.get(i) ?? "body";
    if (rule === "body" && !looksLikeTitle(text)) return;
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
/** 标题含这些词时算可疑：有编号的作者公告，例如「第 100 章 请假」。 */
const NOTICE_WORDS = /请假|感言|公告|停更|通知|上架|完本|单章|说明|致歉|抱歉/;

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
 * 4. 含作者公告用词的行。
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

function looksLikeTitle(text: string): boolean {
  if ([...text].length > MAX_TITLE_CHARS) return false;
  if (/^[「『“"'‘（(【《]/.test(text) || /[。！？!?…”」』】—，,；;：:]$/.test(text)) return false;
  return NEAR_MISS_WORDS.test(text);
}
