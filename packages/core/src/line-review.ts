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
    });
  });
  return candidates;
}

function looksLikeTitle(text: string): boolean {
  if ([...text].length > MAX_TITLE_CHARS) return false;
  if (/^[「『“"'‘（(【《]/.test(text) || /[。！？!?…”」』】—，,；;：:]$/.test(text)) return false;
  return NEAR_MISS_WORDS.test(text);
}
