import type { ScrapeSnapshot } from "@/api/books";

/** 快照中的一行：名称、文字，以及可选的链接（榜单页）。 */
export interface SnapshotRow {
  label: string;
  text: string;
  url?: string;
}

const periodText: Record<string, string> = {
  all_time: "累计",
  month: "本月",
  week: "本周",
  day: "今日",
  current: "当前",
};

const availabilityText: Record<string, string> = {
  removed_at_source: "源站已下架",
  withheld_at_source: "源站暂不显示",
};

const num = (value: number) => value.toLocaleString("zh-CN");
const day = (iso: string) => new Date(iso).toLocaleDateString("zh-CN");

/**
 * 快照的展示行。数据项按平台给出的名称与周期显示，不换算、不跨平台比较。
 * 源站仍有这本书时不显示「在架」一行；未知的在架状态按原值显示。
 */
export function snapshotRows(snapshot: ScrapeSnapshot): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const state = snapshot.availability?.state;
  if (state && state !== "available") {
    const since = snapshot.availability?.since;
    rows.push({ label: "在架状态", text: `${availabilityText[state] ?? state}${since ? `（${since} 起）` : ""}` });
  }
  for (const m of snapshot.metrics) {
    const value = m.key === "score" && snapshot.scoreScale ? `${m.value} / ${snapshot.scoreScale}` : num(m.value);
    const period = m.period ? periodText[m.period] : undefined;
    rows.push({ label: m.label, text: period ? `${value}（${period}）` : value });
  }
  if (snapshot.ratingCount !== null) rows.push({ label: "评分人数", text: num(snapshot.ratingCount) });
  if (snapshot.commentCount !== null) rows.push({ label: "评论数", text: num(snapshot.commentCount) });
  if (snapshot.booklistCount !== null) rows.push({ label: "书单收录", text: num(snapshot.booklistCount) });
  for (const r of snapshot.rankings) {
    rows.push({ label: r.channel ? `${r.label}（${r.channel}）` : r.label, text: `第 ${r.position} 名`, url: r.url });
  }
  if (snapshot.pace) {
    const { chaptersPerWeek, paused, days } = snapshot.pace;
    rows.push({ label: "更新速度", text: paused ? `近 ${days} 天没有新章节` : `每周约 ${chaptersPerWeek} 章（近 ${days} 天）` });
  }
  if (snapshot.refreshedAt) rows.push({ label: "DaoSearch 读取源站", text: day(snapshot.refreshedAt) });
  return rows;
}
