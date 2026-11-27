// 章节序号的异常检查与逐条修复。只看章节的阅读顺序、标题与章节序号，不读正文。
import { extractChapterOrder } from "./vendor/novel-processor/novel";

export interface NumberedChapter {
  order: number;
  title: string;
  number: number | null;
  /** 所属卷的标题。卷不同的章节分属不同的分卷，各自检查序号。 */
  volume?: string | null;
  /** 卷标题本身（不是章节）：固定不动，开始一个新的分卷。 */
  volumeStart?: boolean;
}

/**
 * 章节序号异常。order 都是阅读顺序，用来在预览中定位章节。
 * key 标识一条异常，所有者的修复与忽略按 key 记在整理选项中；section 是分卷序号，从 0 开始。
 */
export type NumberAnomaly = { key: string; section: number } & (
  /** 分卷边界：序号从较大值重置到 1。系统自动按分卷检查，无需处理。 */
  | { kind: "sectionReset"; order: number; previous: number }
  /** 缺号：序号 from 到 to 不存在，缺口位于阅读顺序为 after 的章节（序号 from - 1）之后。 */
  | { kind: "missing"; from: number; to: number; after: number }
  /** 重复编号：多个章节使用同一个序号。 */
  | { kind: "duplicate"; number: number; orders: number[] }
  /** 乱序：章节不在分卷内按序号递增的最长序列上，位置需要调整。 */
  | { kind: "outOfOrder"; order: number; number: number; title: string }
  /**
   * 序号笔误：相邻两章都是第 number 章，下一章是 number + 2，缺 number + 1。
   * 第二章（order）应为 number + 1；first 是第一章。取代对应的重复编号与缺号。
   */
  | { kind: "numberTypo"; order: number; first: number; number: number; title: string }
);

export type NumberAnomalyKind = NumberAnomaly["kind"];

/** 可以由系统修复的异常类型：乱序章节可以移动到按序号应在的位置；序号笔误可以改写标题中的序号。 */
export const isFixable = (a: NumberAnomaly) => a.kind === "outOfOrder" || a.kind === "numberTypo";
/** 系统已自动处理、不需要所有者操作的异常类型。 */
export const needsNoAction = (a: NumberAnomaly) => a.kind === "sectionReset";

type Numbered = NumberedChapter & { number: number };

const fixKey = (kind: "outOfOrder" | "numberTypo", section: number, number: number, title: string) => `${kind}|${section}|${number}|${title}`;

/** 从可修复异常的 key 读出类型、修复前的序号与标题，用于显示已修复的异常。 */
export function parseFixKey(key: string): { kind: "outOfOrder" | "numberTypo"; section: number; number: number; title: string } | null {
  const [kind, section, number, ...title] = key.split("|");
  if ((kind !== "outOfOrder" && kind !== "numberTypo") || !section || !number) return null;
  return { kind, section: Number(section), number: Number(number), title: title.join("|") };
}

const TITLE_NUMBER = /第?([〇零一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟萬\d]+)\s*[章节卷集幕回部篇]/;
const DIGITS = "零一二三四五六七八九";
const UNITS = ["", "十", "百", "千"];

/** 1 到 9999 的小写中文数字，例如 1201 → 一千二百零一。 */
function chineseBelow10000(x: number): string {
  let s = "";
  let zero = false;
  for (let i = 3; i >= 0; i--) {
    const d = Math.floor(x / 10 ** i) % 10;
    if (d === 0) {
      if (s) zero = true;
      continue;
    }
    if (zero) s += "零";
    zero = false;
    s += DIGITS[d]! + UNITS[i]!;
  }
  return s;
}

/** 正整数（小于一亿）的小写中文数字：12 → 十二，230 → 二百三十，10001 → 一万零一。 */
export function toChineseNumeral(n: number): string {
  const high = Math.floor(n / 10000);
  const low = n % 10000;
  const s = high
    ? `${chineseBelow10000(high)}万${low && low < 1000 ? "零" : ""}${low ? chineseBelow10000(low) : ""}`
    : chineseBelow10000(low);
  return s.startsWith("一十") ? s.slice(1) : s;
}

/**
 * 把标题中的章节序号改为 n，保持阿拉伯数字或小写中文数字的写法：「第六章 选择」→「第七章 选择」。
 * 其他写法（大写数字、混合写法）或改写后读不出 n 时返回 null。
 */
export function renumberTitle(title: string, n: number): string | null {
  const m = TITLE_NUMBER.exec(title);
  if (!m) return null;
  const old = m[1]!;
  const next = /^\d+$/.test(old) ? String(n) : /^[零一二三四五六七八九十百千万]+$/.test(old) ? toChineseNumeral(n) : null;
  if (!next) return null;
  const start = m.index + m[0].indexOf(old);
  const result = title.slice(0, start) + next + title.slice(start + old.length);
  return extractChapterOrder(result) === n ? result : null;
}

/**
 * 把有序号的章节分成分卷。两种边界：
 * - 卷：章节所属的卷与前一个有序号章节不同。卷标题已经说明了分卷，不算异常。
 * - 序号重置：当前分卷已经有第 1 章，又遇到第 1 章且前一章序号大于 1；这是没有卷标题时推断出的分卷边界。
 *   当前分卷还没有第 1 章时（如「第3章、第1章、第2章」），第 1 章只是乱序，不是新分卷。
 */
function splitSections(numbered: Numbered[]): { sections: Numbered[][]; resets: { order: number; previous: number }[] } {
  const sections: Numbered[][] = [];
  const resets: { order: number; previous: number }[] = [];
  for (const chapter of numbered) {
    const previous = sections.at(-1)?.at(-1);
    if (previous && (previous.volume ?? null) !== (chapter.volume ?? null)) {
      sections.push([]);
    } else if (startsSection(sections.at(-1), chapter)) {
      resets.push({ order: chapter.order, previous: previous!.number });
      sections.push([]);
    }
    if (!sections.length) sections.push([]);
    sections.at(-1)!.push(chapter);
  }
  return { sections, resets };
}

function startsSection(section: readonly { number: number | null }[] | undefined, chapter: { number: number | null }) {
  const previous = section?.findLast((c) => c.number !== null);
  return (
    !!previous && chapter.number === 1 && previous.number! > 1 && section!.some((c) => c.number === 1)
  );
}

/** 序号不减的最长子序列之外的章节下标：移动这些章节即可让分卷按序号排列，且移动的章节最少。 */
function misplaced(section: Numbered[]): Set<number> {
  const tails: number[] = []; // tails[k]：长度为 k+1 的子序列的末尾下标
  const prev: number[] = [];
  section.forEach((c, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (section[tails[mid]!]!.number <= c.number) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]!) keep.add(i);
  return new Set(section.map((_, i) => i).filter((i) => !keep.has(i)));
}

/** 找出章节序号的分卷边界、缺号、重复编号与乱序。没有章节序号的章节不参与检查。 */
export function findNumberAnomalies(chapters: readonly NumberedChapter[]): NumberAnomaly[] {
  const numbered = chapters.filter((c): c is Numbered => c.number !== null);
  const { sections, resets } = splitSections(numbered);
  const sectionOf = new Map(sections.flatMap((s, i) => s.map((c) => [c.order, i] as const)));
  const anomalies: NumberAnomaly[] = resets.map((r) => {
    const section = sectionOf.get(r.order)!;
    return { key: `sectionReset|${section}`, section, kind: "sectionReset", ...r };
  });

  sections.forEach((section, s) => {
    const byNumber = new Map<number, number[]>();
    for (const c of section) byNumber.set(c.number, [...(byNumber.get(c.number) ?? []), c.order]);

    // 序号笔误：只有这两章用了 n，二者在分卷的有序号章节中相邻，下一章是 n + 2，分卷中没有 n + 1，且标题可以改写。
    const typos = new Set<number>();
    section.forEach((c, i) => {
      const prev = section[i - 1];
      const n = c.number;
      if (prev?.number !== n || byNumber.get(n)!.length !== 2 || section[i + 1]?.number !== n + 2) return;
      if (byNumber.has(n + 1) || !renumberTitle(c.title, n + 1)) return;
      typos.add(n);
      anomalies.push({ key: fixKey("numberTypo", s, n, c.title), section: s, kind: "numberTypo", order: c.order, first: prev.order, number: n, title: c.title });
    });

    const sorted = [...byNumber.keys()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (b - a > 1 && !(typos.has(a) && b === a + 2)) {
        anomalies.push({ key: `missing|${s}|${a + 1}|${b - 1}`, section: s, kind: "missing", from: a + 1, to: b - 1, after: byNumber.get(a)![0]! });
      }
    }
    for (const n of sorted) {
      const orders = byNumber.get(n)!;
      if (orders.length > 1 && !typos.has(n)) anomalies.push({ key: `duplicate|${s}|${n}`, section: s, kind: "duplicate", number: n, orders });
    }
    for (const i of misplaced(section)) {
      const c = section[i]!;
      anomalies.push({
        key: fixKey("outOfOrder", s, c.number, c.title),
        section: s,
        kind: "outOfOrder",
        order: c.order,
        number: c.number,
        title: c.title,
      });
    }
  });
  return anomalies;
}

/**
 * 按所有者选择修复的乱序异常（fixes 中的 key）调整阅读顺序，返回原阅读顺序组成的新顺序。
 * 被修复的章节连同它后面没有序号的章节（如番外）一起移动，放到同一分卷中第一个序号更大的章节之前；
 * 没有更大的序号时放到分卷末尾。其他章节的相对位置不变。
 * 一次修复后可能出现新的、已被选择的异常（所有者在修复后的预览上选择的），因此重复直到没有可修复的。
 */
export function applyNumberFixes(chapters: readonly NumberedChapter[], fixes: readonly string[]): number[] {
  const wanted = new Set(fixes);
  let current = [...chapters];
  const applied = new Set<string>();
  for (let round = 0; round < 10; round++) {
    const targets = new Set(
      findNumberAnomalies(current)
        .filter((a) => a.kind === "outOfOrder" && wanted.has(a.key) && !applied.has(a.key))
        .map((a) => {
          applied.add(a.key);
          return (a as { order: number }).order;
        }),
    );
    if (targets.size === 0) break;
    current = moveChapters(current, targets);
  }
  return current.map((c) => c.order);
}

interface Group {
  number: number | null;
  section: number;
  items: NumberedChapter[];
}

/** 移动阅读顺序在 targets 中的章节组，返回新的章节序列（每项保留原 order）。 */
function moveChapters(chapters: NumberedChapter[], targets: Set<number>): NumberedChapter[] {
  // 分组：一个有序号的章节加上紧随其后的无序号章节；开头的无序号章节与卷标题各自成组，不移动。
  const { sections } = splitSections(chapters.filter((c): c is Numbered => c.number !== null));
  const sectionOf = new Map(sections.flatMap((s, i) => s.map((c) => [c.order, i] as const)));
  const groups: Group[] = [];
  chapters.forEach((c, i) => {
    if (c.volumeStart) {
      // 卷标题属于它后面第一个有序号章节所在的分卷，修复插入时不会越过它。
      const next = chapters.slice(i + 1).find((n) => n.number !== null);
      groups.push({ number: null, section: next ? sectionOf.get(next.order)! : sections.length, items: [c] });
    } else if (c.number === null) {
      if (groups.length === 0) groups.push({ number: null, section: 0, items: [] });
      groups.at(-1)!.items.push(c);
    } else {
      groups.push({ number: c.number, section: sectionOf.get(c.order)!, items: [c] });
    }
  });
  const moving = groups.filter((g) => g.number !== null && targets.has(g.items[0]!.order));
  const result = groups.filter((g) => !moving.includes(g));
  // 序号小的先插入；序号相同的保持原来的先后。
  for (const g of [...moving].sort((a, b) => a.number! - b.number!)) {
    let at = result.findIndex((r) => r.section === g.section && r.number !== null && r.number > g.number!);
    if (at < 0) {
      const lastInSection = result.findLastIndex((r) => r.section === g.section);
      at = lastInSection + 1;
    }
    result.splice(at, 0, g);
  }
  return result.flatMap((g) => g.items);
}
