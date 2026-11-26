import { describe, expect, it } from "vitest";
import type { ScrapeSnapshot } from "@/api/books";
import { snapshotRows } from "./snapshot";

const empty: ScrapeSnapshot = {
  metrics: [],
  scoreScale: null,
  rankings: [],
  ratingCount: null,
  commentCount: null,
  booklistCount: null,
  pace: null,
  availability: { state: "available", since: null },
  refreshedAt: null,
};

describe("snapshotRows", () => {
  it("在架且没有数据时没有行", () => {
    expect(snapshotRows(empty)).toEqual([]);
  });

  it("数据项按平台的名称与周期显示；评分带满分", () => {
    const rows = snapshotRows({
      ...empty,
      metrics: [
        { key: "monthly_votes", label: "月票", value: 56850, period: "month" },
        { key: "score", label: "评分", value: 8.6, period: null },
        { key: "odd", label: "Odd", value: 3, period: "fortnight" },
      ],
      scoreScale: 10,
    });
    expect(rows).toEqual([
      { label: "月票", text: "56,850（本月）" },
      { label: "评分", text: "8.6 / 10" },
      { label: "Odd", text: "3" },
    ]);
  });

  it("榜单带频道与链接；更新速度区分暂停；下架状态在最前", () => {
    const rows = snapshotRows({
      ...empty,
      availability: { state: "removed_at_source", since: "2026-10-01" },
      rankings: [{ label: "月票榜", channel: "男频", position: 3, url: "https://daosearch.io/r" }],
      pace: { chaptersPerWeek: 0, paused: true, days: 30 },
    });
    expect(rows).toEqual([
      { label: "在架状态", text: `源站已下架（${new Date("2026-10-01").toLocaleDateString("zh-CN")} 起）` },
      { label: "月票榜（男频）", text: "第 3 名", url: "https://daosearch.io/r" },
      { label: "更新速度", text: "近 30 天没有新章节" },
    ]);
  });

  it("未知的在架状态按原值显示", () => {
    expect(snapshotRows({ ...empty, availability: { state: "paused_at_source", since: null } })[0]).toEqual({ label: "在架状态", text: "paused_at_source" });
  });
});
