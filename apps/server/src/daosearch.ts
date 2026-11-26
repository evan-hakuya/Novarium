// DaoSearch 刮削源（ADR 0006，`docs/agents/daosearch.md`）。只从服务端调用。
import {
  ScrapeError,
  type Released,
  type ScrapeCache,
  type ScrapeCandidate,
  type ScrapedBook,
  type ScrapeSnapshot,
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
/** /sources 的缓存时长。DaoSearch 说明它很少变化，建议缓存；过期后同样带 ETag 重新验证。 */
export const DAOSEARCH_SOURCES_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

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
  released: Released | null;
  genre?: Text | null;
  subgenre?: Text | null;
  other_names?: { name: string | null; name_translated: string | null }[] | null;
  updated_at?: string | null;
  facets?: { key: string; label: string; value_label: string }[] | null;
  mature?: boolean;
  source_url?: string | null;
  also_on?: { source: string; url: string }[] | null;
  metrics?: { key: string; label?: string; value: number; period?: string }[] | null;
  rankings?:
    | { board_label: string; board_zh: string | null; channel_label: string | null; channel_zh: string | null; position: number; url: string }[]
    | null;
  source_rating_count?: number | null;
  source_comment_count?: number | null;
  booklist_count?: number | null;
  pace?: { chapters_per_week: number; paused: boolean; days: number } | null;
  availability?: { state: string; since: string | null } | null;
  refreshed_at?: string | null;
}

/** /sources 里每个平台的说明，只用到数据项的中文名与评分满分。 */
interface DaoSearchSourceInfo {
  source: string;
  score_scale: number | null;
  metrics: { key: string; zh: string | null }[];
}

/** 一个平台的数据项中文名与评分满分。 */
interface PlatformInfo {
  metricNames: Map<string, string>;
  scoreScale: number | null;
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
/** 只接受 https 链接，避免把 javascript: 等地址放进页面。 */
const https = (url: string | null | undefined) => (url && /^https:\/\//.test(url) ? url : null);

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

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** 更新速度。缺少每周章节数或统计天数时整体为 null，避免显示不完整的数字。 */
function toPace(pace: DaoSearchBook["pace"]): ScrapeSnapshot["pace"] {
  const chaptersPerWeek = count(pace?.chapters_per_week);
  const days = count(pace?.days);
  return pace && chaptersPerWeek !== null && days !== null ? { chaptersPerWeek, paused: !!pace.paused, days } : null;
}

function toSnapshot(book: DaoSearchBook, info: PlatformInfo | null): ScrapeSnapshot {
  return {
    metrics: (book.metrics ?? [])
      .filter((m) => m.key && count(m.value) !== null)
      .map((m) => ({ key: m.key, label: info?.metricNames.get(m.key) ?? m.label ?? m.key, value: m.value, period: m.period ?? null })),
    scoreScale: info?.scoreScale ?? null,
    rankings: (book.rankings ?? []).flatMap((r) => {
      const url = https(r.url);
      return url && count(r.position) !== null
        ? [{ label: r.board_zh ?? r.board_label, channel: r.channel_zh ?? r.channel_label, position: r.position, url }]
        : [];
    }),
    ratingCount: count(book.source_rating_count),
    commentCount: count(book.source_comment_count),
    booklistCount: count(book.booklist_count),
    pace: toPace(book.pace),
    availability: book.availability?.state ? { state: book.availability.state, since: book.availability.since ?? null } : null,
    refreshedAt: book.refreshed_at ?? null,
  };
}

function toBook(book: DaoSearchBook, info: PlatformInfo | null): ScrapedBook {
  const title = zh(book.title);
  const aliases: string[] = [];
  for (const raw of [...(book.other_names ?? []).map((n) => n.name ?? n.name_translated), book.title?.en]) {
    const name = raw?.trim();
    if (name && name !== title && !aliases.includes(name)) aliases.push(name);
  }
  return {
    ...toCandidate(book),
    intro: book.synopsis_zh,
    tags: (book.tags ?? []).map(zh).filter((tag): tag is string => !!tag),
    wordCount: book.word_count ?? null,
    status: book.status === "ongoing" || book.status === "completed" ? book.status : null,
    released: book.released
      ? { date: book.released.date, precision: book.released.precision, estimated: !!book.released.estimated }
      : null,
    genre: zh(book.genre),
    subgenre: zh(book.subgenre),
    aliases,
    authorEn: book.author?.en ?? null,
    sourceUpdatedAt: book.updated_at ?? null,
    facets: (book.facets ?? []).filter((f) => f.label && f.value_label).map((f) => ({ key: f.key, label: f.label, value: f.value_label })),
    mature: typeof book.mature === "boolean" ? book.mature : null,
    sourceUrl: https(book.source_url),
    alsoOn: (book.also_on ?? []).flatMap((e) => {
      const url = https(e.url);
      return url && e.source ? [{ platform: e.source, url }] : [];
    }),
    snapshot: toSnapshot(book, info),
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
  async function getCached<T>(path: string, valid: (data: unknown) => boolean, maxAgeMs = DAOSEARCH_CACHE_MS): Promise<T> {
    if (!cache) return get<T>(path);
    const entry = await cache.get(path);
    const usable = entry && valid(entry.data) ? entry : null;
    if (usable && now() - usable.fetchedAt < maxAgeMs) {
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

  /**
   * 数据项的中文名来自 /sources（1 点，缓存 7 天，过期后 304 不扣点）。
   * 读取失败时不影响刮削，快照里改用作品响应给出的英文名。
   */
  async function platformInfo(source: string): Promise<PlatformInfo | null> {
    try {
      const sources = await getCached<DaoSearchSourceInfo[]>("/sources", Array.isArray, DAOSEARCH_SOURCES_CACHE_MS);
      const found = sources.find((s) => s.source === source);
      if (!found) return null;
      const metricNames = new Map<string, string>();
      for (const m of found.metrics ?? []) if (m.key && m.zh) metricNames.set(m.key, m.zh);
      return { metricNames, scoreScale: count(found.score_scale) };
    } catch {
      return null;
    }
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
      const book = await getCached<DaoSearchBook>(`/books/${platform}/${encodeURIComponent(id)}`, isBook);
      return toBook(book, await platformInfo(book.source));
    },
    async check(): Promise<ScrapeQuota> {
      const limits = await get<DaoSearchLimits>("/limits/me");
      return { remaining: limits.remaining ?? null, limit: limits.limit ?? null, resetsAt: limits.resets_at ?? null };
    },
  };
}
