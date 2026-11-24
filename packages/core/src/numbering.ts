// 章节序号的异常检查与按序号重排。只看章节的阅读顺序与章节序号，不读正文。

export interface NumberedChapter {
  order: number;
  number: number | null;
}

/** 章节序号异常。order 都是阅读顺序，用来在预览中定位章节。 */
export type NumberAnomaly =
  /** 缺号：序号 from 到 to 不存在，缺口位于阅读顺序为 after 的章节（序号 from - 1）之后。 */
  | { kind: "missing"; from: number; to: number; after: number }
  /** 重复编号：多个章节使用同一个序号。 */
  | { kind: "duplicate"; number: number; orders: number[] }
  /** 乱序：章节序号小于阅读顺序上前一个有序号的章节。 */
  | { kind: "outOfOrder"; order: number; number: number; previous: number };

/** 找出章节序号的缺号、重复编号与乱序。没有章节序号的章节不参与检查。 */
export function findNumberAnomalies(chapters: readonly NumberedChapter[]): NumberAnomaly[] {
  const numbered = chapters.filter((c): c is NumberedChapter & { number: number } => c.number !== null);
  const anomalies: NumberAnomaly[] = [];

  const byNumber = new Map<number, number[]>();
  for (const c of numbered) byNumber.set(c.number, [...(byNumber.get(c.number) ?? []), c.order]);

  const sorted = [...byNumber.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (b - a > 1) anomalies.push({ kind: "missing", from: a + 1, to: b - 1, after: byNumber.get(a)![0]! });
  }
  for (const n of sorted) {
    const orders = byNumber.get(n)!;
    if (orders.length > 1) anomalies.push({ kind: "duplicate", number: n, orders });
  }
  for (let i = 1; i < numbered.length; i++) {
    const prev = numbered[i - 1]!;
    const cur = numbered[i]!;
    if (cur.number < prev.number) {
      anomalies.push({ kind: "outOfOrder", order: cur.order, number: cur.number, previous: prev.number });
    }
  }
  return anomalies;
}

/**
 * 按章节序号重排阅读顺序，返回原阅读顺序组成的新顺序。
 * 没有章节序号的章节跟随它前面最近的有序号章节一起移动；位于所有有序号章节之前的（如序章）留在最前。
 * 序号相同的章节保持原来的先后。
 */
export function orderByNumber(chapters: readonly NumberedChapter[]): number[] {
  const head: number[] = [];
  const groups: { number: number; orders: number[] }[] = [];
  for (const c of chapters) {
    if (c.number !== null) groups.push({ number: c.number, orders: [c.order] });
    else if (groups.length > 0) groups[groups.length - 1]!.orders.push(c.order);
    else head.push(c.order);
  }
  // Array.prototype.sort 是稳定排序。
  groups.sort((a, b) => a.number - b.number);
  return [...head, ...groups.flatMap((g) => g.orders)];
}
