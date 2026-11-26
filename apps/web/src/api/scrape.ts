import { ApiError, describeError, request } from "./books";

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

/** 刮削源中的一部作品。 */
export interface ScrapedBook {
  ref: string;
  url: string;
  title: string | null;
  author: string | null;
  intro: string | null;
  tags: string[];
  coverUrl: string | null;
  platform: string;
  wordCount: number | null;
  status: "ongoing" | "completed" | null;
  releasedAt: string | null;
}

export type ScrapeField = "title" | "author" | "intro" | "tags" | "cover";

export const searchScrape = (bookId: string, q: string) =>
  request<{ results: ScrapedBook[] }>(`/api/admin/books/${bookId}/scrape/search?${new URLSearchParams({ q })}`).then((r) => r.results);

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

/** 字数，例如「446.5 万字」。 */
export function formatWordCount(count: number | null): string | null {
  if (count === null) return null;
  return count >= 10_000 ? `${Number((count / 10_000).toFixed(1))} 万字` : `${count} 字`;
}

export const statusText = { ongoing: "连载", completed: "完结" } as const;

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
