import { ApiError, request } from "./books";

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

const kindText: Record<string, string> = {
  invalid_key: "密钥无效或已撤销，请在 DaoSearch 账号页检查",
  rate_limited: "请求过于频繁",
  quota: "今日点数已用完",
  not_found: "没有找到这本书",
  unavailable: "DaoSearch 暂时不可用",
  network: "无法连接 DaoSearch",
};

/** 刮削请求失败的原因，例如「请求过于频繁，30 秒后重试」。 */
export function scrapeFailureReason(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "scrape_not_configured") return "还没有填写 DaoSearch 密钥";
    if (error.code === "scrape_unavailable") {
      const text = kindText[error.kind ?? ""] ?? kindText.unavailable;
      const wait = error.retryAfterSeconds;
      return wait ? `${text}，${formatWait(wait)}后重试` : text;
    }
  }
  return kindText.unavailable;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${Math.ceil(seconds / 3600)} 小时`;
}
