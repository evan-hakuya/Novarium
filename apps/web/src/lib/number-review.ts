import {
  findNumberAnomalies,
  isFixable,
  needsNoAction,
  parseFixKey,
  renumberTitle,
  type NumberAnomaly,
  type NumberedChapter,
  type ProcessOptions,
} from "@novarium/core";
import type { AiReviewItem } from "@/lib/ai-review";

/** 一条章节序号异常的处理状态。 */
export type ReviewStatus = "pending" | "noAction" | "ignored" | "fixed";

export type NumberReviewItem =
  | { key: string; status: "pending" | "noAction" | "ignored"; anomaly: NumberAnomaly }
  /**
   * 已修复的乱序或序号笔误；修复后它不再是异常。number 与 title 是修复前的序号与标题，
   * order 是这一章在修复后的阅读顺序，找不到时为 null。
   */
  | { key: string; status: "fixed"; kind: "outOfOrder" | "numberTypo"; number: number; title: string; order: number | null };

/** 异常面板中的一条：章节序号异常或 AI 复核结果。 */
export type ReviewItem = NumberReviewItem | AiReviewItem;

export const isAiItem = (item: ReviewItem): item is AiReviewItem => "ai" in item;

/** 把当前预览的异常与整理选项中的修复、忽略记录合在一起，得到每条异常的处理状态。 */
export function reviewNumbers(
  chapters: readonly NumberedChapter[],
  options: Pick<ProcessOptions, "numberIgnores" | "numberFixes">,
): NumberReviewItem[] {
  const anomalies = findNumberAnomalies(chapters);
  const ignored = new Set(options.numberIgnores);
  const items: NumberReviewItem[] = anomalies.map((anomaly) => ({
    key: anomaly.key,
    anomaly,
    status: needsNoAction(anomaly) ? "noAction" : ignored.has(anomaly.key) ? "ignored" : "pending",
  }));
  const current = new Set(anomalies.map((a) => a.key));
  for (const key of options.numberFixes) {
    const parsed = parseFixKey(key);
    if (!parsed || current.has(key)) continue;
    // 序号笔误修复后标题与序号已改为 n+1。
    const typo = parsed.kind === "numberTypo";
    const number = typo ? parsed.number + 1 : parsed.number;
    const title = typo ? renumberTitle(parsed.title, number) : parsed.title;
    const chapter = chapters.find((c) => c.number === number && c.title === title);
    if (chapter) items.push({ key, status: "fixed", kind: parsed.kind, number: parsed.number, title: parsed.title, order: chapter.order });
  }
  return items;
}

/** 只提示、不挡住导入的异常：缺号、重复编号与序号笔误多来自原稿本身。 */
export const isAdvisory = (item: ReviewItem) =>
  !isAiItem(item) &&
  item.status !== "fixed" &&
  (item.anomaly.kind === "missing" || item.anomaly.kind === "duplicate" || item.anomaly.kind === "numberTypo");

/** 挡住导入与保存的条数：待处理的乱序与 AI 复核结果。 */
export const countPending = (items: readonly ReviewItem[]) =>
  items.filter((i) => i.status === "pending" && !isAdvisory(i)).length;

export type ReviewKind = NumberAnomaly["kind"] | AiReviewItem["ai"]["kind"];

/** 异常类型，按显示顺序排列。 */
export const ANOMALY_KINDS: { kind: ReviewKind; label: string }[] = [
  { kind: "outOfOrder", label: "乱序" },
  { kind: "missing", label: "缺号" },
  { kind: "duplicate", label: "重复编号" },
  { kind: "numberTypo", label: "序号笔误" },
  { kind: "sectionReset", label: "分卷边界" },
  { kind: "aiLine", label: "AI 复核" },
  { kind: "notice", label: "作者公告" },
];

/** 一条异常的类型。 */
export const itemKind = (item: ReviewItem): ReviewKind =>
  isAiItem(item) ? item.ai.kind : item.status === "fixed" ? item.kind : item.anomaly.kind;

/** 可以修复：乱序与序号笔误，以及待处理的 AI 复核结果。 */
export const canFix = (item: ReviewItem) => item.status === "pending" && (isAiItem(item) || isFixable(item.anomaly));

/** 章节列表中要标出的章节：还待处理的异常所在的章节。 */
export function pendingOrders(items: readonly ReviewItem[]): Set<number> {
  const orders = new Set<number>();
  for (const item of items) {
    if (item.status !== "pending") continue;
    if (isAiItem(item)) {
      if (item.ai.order !== null) orders.add(item.ai.order);
      continue;
    }
    const a = item.anomaly;
    if (a.kind === "missing") orders.add(a.after);
    else if (a.kind === "duplicate") a.orders.forEach((o) => orders.add(o));
    else orders.add(a.order);
  }
  return orders;
}
