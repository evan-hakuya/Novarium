import {
  findNumberAnomalies,
  needsNoAction,
  parseOutOfOrderKey,
  type ChapterDraft,
  type NumberAnomaly,
  type ProcessOptions,
} from "@novarium/core";

/** 一条章节序号异常的处理状态。 */
export type ReviewStatus = "pending" | "noAction" | "ignored" | "fixed";

export type ReviewItem =
  | { key: string; status: "pending" | "noAction" | "ignored"; anomaly: NumberAnomaly }
  /** 已修复的乱序章节；修复后它不再是异常，order 是它在修复后的阅读顺序，找不到时为 null。 */
  | { key: string; status: "fixed"; number: number; title: string; order: number | null };

/** 把当前预览的异常与整理选项中的修复、忽略记录合在一起，得到每条异常的处理状态。 */
export function reviewNumbers(chapters: readonly ChapterDraft[], options: ProcessOptions): ReviewItem[] {
  const anomalies = findNumberAnomalies(chapters);
  const ignored = new Set(options.numberIgnores);
  const items: ReviewItem[] = anomalies.map((anomaly) => ({
    key: anomaly.key,
    anomaly,
    status: needsNoAction(anomaly) ? "noAction" : ignored.has(anomaly.key) ? "ignored" : "pending",
  }));
  const current = new Set(anomalies.map((a) => a.key));
  for (const key of options.numberFixes) {
    const parsed = parseOutOfOrderKey(key);
    if (!parsed || current.has(key)) continue;
    const chapter = chapters.find((c) => c.number === parsed.number && c.title === parsed.title);
    if (chapter) items.push({ key, status: "fixed", number: parsed.number, title: parsed.title, order: chapter.order });
  }
  return items;
}

export const countPending = (items: readonly ReviewItem[]) => items.filter((i) => i.status === "pending").length;

/** 章节列表中要标出的章节：还待处理的异常所在的章节。 */
export function pendingOrders(items: readonly ReviewItem[]): Set<number> {
  const orders = new Set<number>();
  for (const item of items) {
    if (item.status !== "pending") continue;
    const a = item.anomaly;
    if (a.kind === "missing") orders.add(a.after);
    else if (a.kind === "duplicate") a.orders.forEach((o) => orders.add(o));
    else orders.add(a.order);
  }
  return orders;
}
