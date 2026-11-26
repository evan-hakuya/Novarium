// DaoSearch 刮削源（ADR 0006，`docs/agents/daosearch.md`）。只从服务端调用。
import {
  ScrapeError,
  type ScrapeCache,
  type ScrapeCandidate,
  type ScrapedBook,
  type ScrapeErrorKind,
  type ScrapeQuota,
  type ScrapeSource,
} from "./scrape";

export const DAOSEARCH_BASE = "https://daosearch.io/api/v1";
export const DAOSEARCH_USER_AGENT = "Novarium (+https://github.com/evan-hakuya/Novarium)";
export const DAOSEARCH_TIMEOUT_MS = 15_000;
/** 搜索返回的候选数。搜索 5 点，与数量无关。 */
const SEARCH_LIMIT = 10;
/** 搜索与作品响应的缓存时长，与 DaoSearch 声明的 x-cache-seconds 一致。过期后带 ETag 重新验证，304 不消耗点数。 */
export const DAOSEARCH_CACHE_MS = 6 * 60 * 60 * 1000;

const PLATFORMS = new Set(["qidian", "fanqie", "jjwxc", "faloo", "qimao", "zongheng", "seventeenk", "sfacg", "ciweimao"]);
/** 作品 ID 只允许字母、数字、下划线与连字符，避免「..」等路径段把请求带到别的端点。 */
const BOOK_ID = /^[A-Za-z0-9_-]+$/;

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
  word_count: number | null;
  status: string | null;
  released: { date: string } | null;
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

function toBook(book: DaoSearchBook): ScrapedBook {
  return {
    ...toCandidate(book),
    intro: book.synopsis_zh,
    tags: (book.tags ?? []).map(zh).filter((tag): tag is string => !!tag),
    wordCount: book.word_count ?? null,
    status: book.status === "ongoing" || book.status === "completed" ? book.status : null,
    releasedAt: book.released?.date ?? null,
  };
}

/** ref 的格式是「平台/作品 ID」，例如 qidian/1010868264。 */
function parseRef(ref: string): { platform: string; id: string } {
  const slash = ref.indexOf("/");
  const platform = ref.slice(0, slash);
  const id = ref.slice(slash + 1);
  if (slash < 1 || !BOOK_ID.test(id) || !PLATFORMS.has(platform)) throw new ScrapeError("not_found", "invalid DaoSearch ref");
  return { platform, id };
}

export interface DaoSearchOptions {
  timeoutMs?: number;
  /** 搜索与作品响应的缓存。不提供时每次都请求。 */
  cache?: ScrapeCache;
  now?: () => number;
}

export function createDaoSearchSource(key: string, doFetch: typeof fetch = fetch, options: DaoSearchOptions = {}): ScrapeSource {
  const { timeoutMs = DAOSEARCH_TIMEOUT_MS, cache, now = Date.now } = options;

  /** 发请求。带 etag 时可能返回 notModified（304）。 */
  async function request<T>(path: string, etag?: string | null): Promise<{ notModified: true } | { notModified: false; data: T; etag: string | null }> {
    let res: Response;
    try {
      // 作品 ID 合并时返回 301，fetch 自动跟随到新地址（同源，保留 Authorization）。
      res = await doFetch(`${DAOSEARCH_BASE}${path}`, {
        headers: {
          authorization: `Bearer ${key}`,
          "user-agent": DAOSEARCH_USER_AGENT,
          accept: "application/json",
          ...(etag ? { "if-none-match": etag } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new ScrapeError("network", `DaoSearch timed out after ${timeoutMs} ms`);
      throw new ScrapeError("network", error instanceof Error ? error.message : String(error));
    }
    if (res.status === 304 && etag) return { notModified: true };
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
    return { notModified: false, data: body.data, etag: res.headers.get("etag") };
  }

  async function get<T>(path: string): Promise<T> {
    const result = await request<T>(path);
    // 不带 etag 时不会返回 notModified；这一行只用于收窄类型。
    if (result.notModified) throw new ScrapeError("unavailable", "unexpected 304");
    return result.data;
  }

  /** 带缓存的读取：缓存未过期时不发请求；过期后带 ETag 重新验证。出错时不写缓存。 */
  async function getCached<T>(path: string, valid: (data: unknown) => boolean): Promise<T> {
    if (!cache) return get<T>(path);
    const entry = await cache.get(path);
    const usable = entry && valid(entry.data) ? entry : null;
    if (usable && now() - usable.fetchedAt < DAOSEARCH_CACHE_MS) {
      await cache.touch(path, false);
      return usable.data as T;
    }
    const result = await request<T>(path, usable?.etag);
    if (result.notModified) {
      await cache.touch(path, true);
      return usable!.data as T;
    }
    if (!valid(result.data)) throw new ScrapeError("unavailable", "unexpected DaoSearch response");
    await cache.put(path, result.etag, result.data);
    return result.data;
  }

  return {
    id: "daosearch",
    async search(query) {
      const params = new URLSearchParams({ q: query, limit: String(SEARCH_LIMIT) });
      const found = await getCached<DaoSearchResult[]>(`/search?${params}`, Array.isArray);
      return found.map(toCandidate);
    },
    async getBook(ref) {
      const { platform, id } = parseRef(ref);
      const isBook = (data: unknown) => !!data && typeof data === "object" && "source_book_id" in data;
      return toBook(await getCached<DaoSearchBook>(`/books/${platform}/${encodeURIComponent(id)}`, isBook));
    },
    async check(): Promise<ScrapeQuota> {
      const limits = await get<DaoSearchLimits>("/limits/me");
      return { remaining: limits.remaining ?? null, limit: limits.limit ?? null, resetsAt: limits.resets_at ?? null };
    },
  };
}
