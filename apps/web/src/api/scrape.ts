import { ApiError, describeError, request, type Released } from "./books";

/** 刮削的状态（ADR 0006）。configured：已填写 DaoSearch 密钥；keyHint：密钥的前后几位。 */
export interface ScrapeStatus {
  configured: boolean;
  source: "daosearch";
  keyHint: string | null;
}

/** 刮削源当天的用量。 */
export interface ScrapeQuota {
  remaining: number | null;
  limit: number | null;
  resetsAt: string | null;
}

export const scrapeStatusQueryKey = ["settings", "scrape"] as const;

export const fetchScrapeStatus = () => request<ScrapeStatus>("/api/admin/settings/scrape");

export const saveScrapeKey = (key: string) =>
  request<ScrapeStatus>("/api/admin/settings/scrape", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });

export const clearScrapeKey = () => request<ScrapeStatus>("/api/admin/settings/scrape", { method: "DELETE" });

export const checkScrape = () =>
  request<{ ok: true; quota: ScrapeQuota }>("/api/admin/settings/scrape/check", { method: "POST" }).then((r) => r.quota);

/** 搜索得到的候选作品。 */
export interface ScrapeCandidate {
  ref: string;
  url: string;
  title: string | null;
  author: string | null;
  coverUrl: string | null;
  platform: string;
}

/** 点击候选后读取到的作品详情。 */
export interface ScrapedBook extends ScrapeCandidate {
  intro: string | null;
  tags: string[];
  wordCount: number | null;
  status: "ongoing" | "completed" | null;
  released: Released | null;
  genre: string | null;
  subgenre: string | null;
  aliases: string[];
  authorEn: string | null;
  sourceUpdatedAt: string | null;
  facets: { key: string; label: string; value: string }[];
  mature: boolean | null;
  sourceUrl: string | null;
  alsoOn: { platform: string; url: string }[];
}

export type ScrapeField =
  | "title"
  | "author"
  | "intro"
  | "tags"
  | "cover"
  | "genre"
  | "subgenre"
  | "status"
  | "aliases"
  | "authorEn"
  | "wordCount"
  | "released"
  | "sourceUpdatedAt"
  | "facets"
  | "mature"
  | "sourceUrl"
  | "alsoOn";

/** 搜索与详情在浏览器内缓存到页面关闭。服务端另有 6 小时的缓存，重复请求不消耗点数。 */
export const SCRAPE_STALE_MS = Infinity;

export const scrapeSearchQueryKey = (q: string, author: string) => ["scrape", "search", q, author] as const;
export const scrapeBookQueryKey = (ref: string) => ["scrape", "book", ref] as const;

/** 搜索候选。author 用于把作者一致的候选排在前面。 */
export const searchScrape = (q: string, author: string) =>
  request<{ results: ScrapeCandidate[] }>(`/api/admin/scrape/search?${new URLSearchParams({ q, author })}`).then((r) => r.results);

export const fetchScrapedBook = (ref: string) =>
  request<{ book: ScrapedBook }>(`/api/admin/scrape/books?${new URLSearchParams({ ref })}`).then((r) => r.book);

export const applyScrape = (bookId: string, ref: string, fields: ScrapeField[]) =>
  request<{ ok: true }>(`/api/admin/books/${bookId}/scrape`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref, fields }),
  });

const platformNames: Record<string, string> = {
  qidian: "起点",
  fanqie: "番茄",
  jjwxc: "晋江",
  faloo: "飞卢",
  qimao: "七猫",
  zongheng: "纵横",
  seventeenk: "17K",
  sfacg: "SF 轻小说",
  ciweimao: "刺猬猫",
};

export const platformName = (platform: string) => platformNames[platform] ?? platform;

export { formatWordCount } from "@novarium/core";

export const statusText = { ongoing: "连载", completed: "完结" } as const;

/** 首发日期，例如「2017（估算）」。 */
export function formatReleased(released: Released | null): string | null {
  if (!released) return null;
  return released.estimated ? `${released.date}（估算）` : released.date;
}

export const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-CN") : null);

const facetNames: Record<string, string> = {
  audience: "读者",
  pov: "视角",
  theme: "题材",
  age: "年龄",
  access: "阅读方式",
  signed: "签约",
  vip: "VIP",
  paid_vip: "付费 VIP",
  editors_pick: "编辑推荐",
  exclusive: "独家",
  first_on_source: "首发",
  licensed: "授权",
  licensed_from: "授权来源",
  author_tier: "作者等级",
  fan_title: "同人",
  branching_story: "多分支",
  first_published: "首发月份",
};

/** 平台标记，例如「签约：Signed」。不认识的 key 用刮削源给出的名称。 */
export const formatFacet = (facet: { key: string; label: string; value: string }) => `${facetNames[facet.key] ?? facet.label}：${facet.value}`;

const kindText: Record<string, string> = {
  invalid_key: "密钥无效或已撤销，请在 DaoSearch 账号页检查",
  rate_limited: "请求过于频繁",
  quota: "今日点数已用完",
  not_found: "没有找到这本书",
  unavailable: "DaoSearch 暂时不可用",
  network: "无法连接 DaoSearch",
};

/** 刮削请求失败的原因，例如「请求过于频繁，30 秒后重试」。其他错误（如登录失效）按通用文字显示。 */
export function scrapeFailureReason(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "scrape_not_configured") return "还没有填写 DaoSearch 密钥";
    if (error.code === "scrape_unavailable") {
      const text = kindText[error.kind ?? ""] ?? kindText.unavailable;
      const wait = error.retryAfterSeconds;
      return wait ? `${text}，${formatWait(wait)}后重试` : text;
    }
  }
  return describeError(error);
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${Math.ceil(seconds / 3600)} 小时`;
}
