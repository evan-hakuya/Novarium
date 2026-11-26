// DaoSearch 刮削源（ADR 0006，`docs/agents/daosearch.md`）。只从服务端调用。
import { ScrapeError, type ScrapedBook, type ScrapeErrorKind, type ScrapeQuota, type ScrapeSource } from "./scrape";

export const DAOSEARCH_BASE = "https://daosearch.io/api/v1";
export const DAOSEARCH_USER_AGENT = "Novarium (+https://github.com/evan-hakuya/Novarium)";
export const DAOSEARCH_TIMEOUT_MS = 15_000;
/** 搜索返回的候选数。搜索 5 点与数量无关；补全详情的批量读取每本 1 点。 */
const SEARCH_LIMIT = 10;

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
}

interface DaoSearchBook extends DaoSearchResult {
  url: string;
  title: Text;
  author: Text;
  cover_url: string | null;
  synopsis_zh: string | null;
  tags: Text[] | null;
  word_count: number | null;
  status: string | null;
  released: { date: string } | null;
}

interface DaoSearchBatchItem {
  status: string;
  book: DaoSearchBook | null;
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

function toBook(book: DaoSearchBook): ScrapedBook {
  return {
    ref: `${book.source}/${book.source_book_id}`,
    url: book.url,
    title: zh(book.title),
    author: zh(book.author),
    intro: book.synopsis_zh,
    tags: (book.tags ?? []).map(zh).filter((tag): tag is string => !!tag),
    coverUrl: book.cover_url,
    platform: book.source,
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
      const found = await get<DaoSearchResult[]>(`/search?${params}`);
      if (!Array.isArray(found)) throw new ScrapeError("unavailable", "unexpected DaoSearch search response");
      if (found.length === 0) return [];
      // 搜索结果只有书名、作者与封面；用批量读取补全字数、状态、简介等，按搜索的顺序返回。
      const ids = found.map((item) => `${item.source}:${item.source_book_id}`).join(",");
      const items = await get<DaoSearchBatchItem[]>(`/books?${new URLSearchParams({ ids })}`);
      if (!Array.isArray(items)) throw new ScrapeError("unavailable", "unexpected DaoSearch batch response");
      const seen = new Set<string>();
      const books: ScrapedBook[] = [];
      for (const item of items) {
        if (!item.book) continue;
        const book = toBook(item.book);
        // 两个 ID 合并到同一本书时只保留一次。
        if (seen.has(book.ref)) continue;
        seen.add(book.ref);
        books.push(book);
      }
      return books;
    },
    async getBook(ref) {
      const { platform, id } = parseRef(ref);
      return toBook(await get<DaoSearchBook>(`/books/${platform}/${encodeURIComponent(id)}`));
    },
    async check(): Promise<ScrapeQuota> {
      const limits = await get<DaoSearchLimits>("/limits/me");
      return { remaining: limits.remaining ?? null, limit: limits.limit ?? null, resetsAt: limits.resets_at ?? null };
    },
  };
}
