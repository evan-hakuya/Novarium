// DaoSearch 刮削源（ADR 0006，`docs/agents/daosearch.md`）。只从服务端调用。
import { ScrapeError, type ScrapeCandidate, type ScrapedBook, type ScrapeErrorKind, type ScrapeQuota, type ScrapeSource } from "./scrape";

export const DAOSEARCH_BASE = "https://daosearch.io/api/v1";
export const DAOSEARCH_USER_AGENT = "Novarium (+https://github.com/evan-hakuya/Novarium)";
export const DAOSEARCH_TIMEOUT_MS = 15_000;
/** 搜索返回的候选数。DaoSearch 上限 25，每次搜索 5 点，与数量无关。 */
const SEARCH_LIMIT = 10;

const PLATFORMS = new Set(["qidian", "fanqie", "jjwxc", "faloo", "qimao", "zongheng", "seventeenk", "sfacg", "ciweimao"]);

interface Text {
  en: string | null;
  zh: string | null;
}

interface DaoSearchResult {
  source: string;
  source_book_id: string;
  url: string;
  title: Text;
  author: Text;
  cover_url: string | null;
}

interface DaoSearchBook extends DaoSearchResult {
  synopsis_zh: string | null;
  tags: Text[] | null;
}

interface DaoSearchLimits {
  limit: number;
  remaining: number;
  resets_at: string;
}

/** 按 DaoSearch 的 error.code 与 HTTP 状态归类。 */
export function classifyDaoSearchError(status: number, code: string | undefined): ScrapeErrorKind {
  if (code === "quota_exceeded") return "quota";
  if (code === "rate_limited" || status === 429) return "rate_limited";
  if (status === 401 || code === "missing_key" || code === "invalid_key" || code === "revoked_key" || code === "account_blocked") {
    return "invalid_key";
  }
  if (status === 404) return "not_found";
  return "unavailable";
}

const zh = (text: Text | null | undefined) => text?.zh ?? text?.en ?? null;

function toCandidate(item: DaoSearchResult): ScrapeCandidate {
  return {
    ref: `${item.source}/${item.source_book_id}`,
    url: item.url,
    title: zh(item.title),
    author: zh(item.author),
    coverUrl: item.cover_url,
    platform: item.source,
  };
}

/** ref 的格式是「平台/作品 ID」，例如 qidian/1010868264。 */
function parseRef(ref: string): { platform: string; id: string } {
  const slash = ref.indexOf("/");
  const platform = ref.slice(0, slash);
  const id = ref.slice(slash + 1);
  if (slash < 1 || !id || id.includes("/") || !PLATFORMS.has(platform)) throw new ScrapeError("not_found", "invalid DaoSearch ref");
  return { platform, id };
}

export function createDaoSearchSource(key: string, doFetch: typeof fetch = fetch, timeoutMs = DAOSEARCH_TIMEOUT_MS): ScrapeSource {
  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      // 作品 ID 合并时返回 301，fetch 自动跟随到新地址（同源，保留 Authorization）。
      res = await doFetch(`${DAOSEARCH_BASE}${path}`, {
        headers: { authorization: `Bearer ${key}`, "user-agent": DAOSEARCH_USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new ScrapeError("network", `DaoSearch timed out after ${timeoutMs} ms`);
      throw new ScrapeError("network", error instanceof Error ? error.message : String(error));
    }
    const body = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ScrapeError(
        classifyDaoSearchError(res.status, body?.error?.code),
        `${res.status} ${body?.error?.code ?? ""}`.trim(),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (!body || body.data === undefined) throw new ScrapeError("unavailable", "unexpected DaoSearch response");
    return body.data;
  }

  return {
    id: "daosearch",
    async search(query) {
      const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) });
      const data = await get<DaoSearchResult[]>(`/search?${params}`);
      if (!Array.isArray(data)) throw new ScrapeError("unavailable", "unexpected DaoSearch search response");
      return data.map(toCandidate);
    },
    async getBook(ref) {
      const { platform, id } = parseRef(ref);
      const book = await get<DaoSearchBook>(`/books/${platform}/${encodeURIComponent(id)}`);
      return {
        ...toCandidate(book),
        intro: book.synopsis_zh,
        tags: (book.tags ?? []).map(zh).filter((tag): tag is string => !!tag),
      };
    },
    async check(): Promise<ScrapeQuota> {
      const limits = await get<DaoSearchLimits>("/limits/me");
      return { remaining: limits.remaining ?? null, limit: limits.limit ?? null, resetsAt: limits.resets_at ?? null };
    },
  };
}
