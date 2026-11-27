import {
  AI_CONFIDENT,
  lineOverrideKey,
  parseLineOverrideKey,
  type CandidateLine,
  type ChapterDraft,
  type LineKind,
  type ProcessOptions,
} from "@novarium/core";

/** AI 对一行的判断。 */
export interface AiResult {
  kind: LineKind;
  confidence: number;
}

/** 行标识 → AI 的判断。 */
export type AiResults = ReadonlyMap<string, AiResult>;

/** 一条 AI 复核结果在异常面板中的显示。 */
export interface AiLine {
  /** aiLine：AI 与规则对一行的类别判断不同；notice：AI 判为作者公告的标题行。 */
  kind: "aiLine" | "notice";
  id: string;
  text: string;
  occurrence: number;
  /** 规则给出的类别；这一行已不是候选行时为 null。 */
  rule: LineKind | null;
  /** 待处理：AI 的判断；已修复：修正后的类别；已忽略：被忽略的判断。 */
  suggested: LineKind;
  confidence: number | null;
  /** 这一行所在章节的阅读顺序；找不到时为 null。 */
  order: number | null;
}

export type AiReviewStatus = "pending" | "ignored" | "fixed";
export interface AiReviewItem {
  key: string;
  status: AiReviewStatus;
  ai: AiLine;
}

export const AI_KEY_PREFIX = "ai|";
export const isAiKey = (key: string) => key.startsWith(AI_KEY_PREFIX);

export const LINE_KIND_TEXT: Record<LineKind, string> = { chapter: "章节", volume: "卷名", notice: "作者公告", body: "正文" };

/**
 * AI 与规则一致时不需要处理。作者公告也是章节，所以规则判为公告、AI 判为章节时一致。
 * 规则判为正文的作者公告仍留在正文里。
 */
const agrees = (rule: LineKind, ai: LineKind) =>
  ai === rule || (ai === "notice" && rule === "body") || (ai === "chapter" && rule === "notice");

const byId = (keys: readonly string[]) => {
  const map = new Map<string, NonNullable<ReturnType<typeof parseLineOverrideKey>>>();
  for (const key of keys) {
    const parsed = parseLineOverrideKey(key);
    if (parsed) map.set(parsed.id, parsed);
  }
  return map;
};

/** 一行所在的章节：标题行属于它开始的章节，正文行属于包含它的章节。 */
function chapterAt(chapters: readonly ChapterDraft[], byteOffset: number, text: string): number | null {
  if (chapters.length === 0) return null;
  let lo = 0;
  let hi = chapters.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chapters[mid]!.byteOffset > byteOffset) hi = mid;
    else lo = mid + 1;
  }
  if (lo < chapters.length && chapters[lo]!.title === text) return lo;
  return Math.max(0, lo - 1);
}

/** 把 AI 的判断、行级修正与忽略记录合在一起，得到异常面板中的 AI 复核条目。 */
export function reviewAiLines(
  candidates: readonly CandidateLine[],
  chapters: readonly ChapterDraft[],
  options: ProcessOptions,
  results: AiResults,
): AiReviewItem[] {
  const overrides = byId(options.lineOverrides);
  const ignores = byId(options.lineIgnores);
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  const make = (id: string, text: string, occurrence: number, status: AiReviewStatus, suggested: LineKind): AiReviewItem => {
    const c = candidateById.get(id);
    return {
      key: AI_KEY_PREFIX + id,
      status,
      ai: {
        kind: suggested === "notice" ? "notice" : "aiLine",
        id,
        text,
        occurrence,
        rule: c?.rule ?? null,
        suggested,
        confidence: results.get(id)?.confidence ?? null,
        order: c ? chapterAt(chapters, c.byteOffset, text) : null,
      },
    };
  };
  const items: AiReviewItem[] = [];
  for (const o of overrides.values()) items.push(make(o.id, o.text, o.occurrence, "fixed", o.kind));
  for (const i of ignores.values()) if (!overrides.has(i.id)) items.push(make(i.id, i.text, i.occurrence, "ignored", i.kind));
  for (const c of candidates) {
    const r = results.get(c.id);
    if (!r || overrides.has(c.id) || ignores.has(c.id) || agrees(c.rule, r.kind)) continue;
    items.push(make(c.id, c.text, c.occurrence, "pending", r.kind));
  }
  return items;
}

/** 置信度不低于 0.8、与规则不一致、且尚未处理的判断直接采用为行级修正。作者公告总是交给所有者处理。 */
export function autoApply(candidates: readonly CandidateLine[], options: ProcessOptions, results: AiResults): ProcessOptions | null {
  const handled = new Set([...byId(options.lineOverrides).keys(), ...byId(options.lineIgnores).keys()]);
  const added: string[] = [];
  for (const c of candidates) {
    const r = results.get(c.id);
    if (!r || r.kind === "notice" || r.confidence < AI_CONFIDENT || handled.has(c.id) || agrees(c.rule, r.kind)) continue;
    added.push(lineOverrideKey(r.kind, c.text, c.occurrence));
  }
  return added.length ? { ...options, lineOverrides: [...options.lineOverrides, ...added] } : null;
}

/** 修复：按 AI 的判断修正这一行。作者公告单独成章，不带序号。 */
export function fixAiLines(options: ProcessOptions, items: readonly AiReviewItem[]): ProcessOptions {
  const ids = new Set(items.map((i) => i.ai.id));
  const added = items.map((i) => lineOverrideKey(i.ai.suggested, i.ai.text, i.ai.occurrence));
  return {
    ...options,
    lineOverrides: [...dropIds(options.lineOverrides, ids), ...added],
    lineIgnores: dropIds(options.lineIgnores, ids),
  };
}

export function ignoreAiLines(options: ProcessOptions, items: readonly AiReviewItem[]): ProcessOptions {
  const ids = new Set(items.map((i) => i.ai.id));
  const added = items.map((i) => lineOverrideKey(i.ai.suggested, i.ai.text, i.ai.occurrence));
  return { ...options, lineIgnores: [...dropIds(options.lineIgnores, ids), ...added] };
}

/** 撤销修复：去掉修正，并记为已忽略，避免下次复核时被再次采用。 */
export function unfixAiLines(options: ProcessOptions, items: readonly AiReviewItem[]): ProcessOptions {
  const ids = new Set(items.map((i) => i.ai.id));
  const undone = options.lineOverrides.filter((k) => ids.has(parseLineOverrideKey(k)?.id ?? ""));
  return { ...options, lineOverrides: dropIds(options.lineOverrides, ids), lineIgnores: [...dropIds(options.lineIgnores, ids), ...undone] };
}

export function unignoreAiLines(options: ProcessOptions, items: readonly AiReviewItem[]): ProcessOptions {
  return { ...options, lineIgnores: dropIds(options.lineIgnores, new Set(items.map((i) => i.ai.id))) };
}

/** 撤销全部 AI 修正。 */
export function undoAllAiFixes(options: ProcessOptions): ProcessOptions {
  const ids = new Set(options.lineOverrides.map((k) => parseLineOverrideKey(k)?.id ?? ""));
  return { ...options, lineOverrides: [], lineIgnores: [...dropIds(options.lineIgnores, ids), ...options.lineOverrides] };
}

function dropIds(keys: readonly string[], ids: ReadonlySet<string>) {
  return keys.filter((k) => !ids.has(parseLineOverrideKey(k)?.id ?? ""));
}

/** 复核范围：只发送可疑行，或发送全部候选行。 */
export type ReviewScope = "suspicious" | "all";

/** 还没有 AI 判断、也没有处理过的候选行，优先判断可疑行，再按规则最可能出错的程度排列。 */
export function unjudgedCandidates(
  candidates: readonly CandidateLine[],
  options: ProcessOptions,
  results: AiResults,
  scope: ReviewScope = "all",
): CandidateLine[] {
  const handled = new Set([...byId(options.lineOverrides).keys(), ...byId(options.lineIgnores).keys()]);
  const rest = candidates.filter((c) => !results.has(c.id) && !handled.has(c.id) && (scope === "all" || c.suspicious));
  const rank = (c: CandidateLine) => (c.suspicious ? 0 : 2) + (c.priority ? 0 : 1);
  return rest.map((c, i) => [rank(c), i, c] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , c]) => c);
}
