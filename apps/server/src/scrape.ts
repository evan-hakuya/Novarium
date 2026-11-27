// 刮削源接口（ADR 0006，GLOSSARY「刮削」「刮削源」）。
// 调用方只依赖这里的类型；新增刮削源时新增一个实现，不改调用方。

/** 已实现的刮削源。 */
export type ScrapeSourceId = "daosearch";

/** 搜索得到的候选作品。 */
export interface ScrapeCandidate {
  /** 作品在刮削源中的 ID，交给 getBook 读取。对调用方是不透明的字符串。 */
  ref: string;
  /** 作品在刮削源的页面，展示数据时附上（DaoSearch 条款要求）。 */
  url: string;
  title: string | null;
  author: string | null;
  coverUrl: string | null;
  /** 作品所在的原发平台，例如 qidian。 */
  platform: string;
}

/** 首发日期。date 精度不定：YYYY-MM-DD、YYYY-MM 或 YYYY；precision 现在为 day、month 或 year，刮削源以后可能增加新值，所以保持 string；estimated 表示是刮削源估算的。 */
export interface Released {
  date: string;
  precision: string;
  estimated: boolean;
}

/** 按 ID 读取到的作品。 */
export interface ScrapedBook extends ScrapeCandidate {
  intro: string | null;
  tags: string[];
  /** 字数（汉字）。 */
  wordCount: number | null;
  status: "ongoing" | "completed" | null;
  released: Released | null;
  genre: string | null;
  subgenre: string | null;
  /** 别名：曾用名、源站给出的其他书名与英文书名，不含当前书名。 */
  aliases: string[];
  authorEn: string | null;
  /** 源站最后更新章节的时间，ISO 8601。 */
  sourceUpdatedAt: string | null;
  /** 平台标记，例如 { key: "signed", label: "Signed", value: "Signed", raw: "true" }。key 的取值见 docs/agents/daosearch.md。 */
  facets: { key: string; label: string; value: string; raw?: string }[];
  mature: boolean | null;
  /** 这本书在源站的页面（https）。 */
  sourceUrl: string | null;
  /** 其他平台上的同一本书。 */
  alsoOn: { platform: string; url: string }[];
  /** 会随时间变化的平台数据（GLOSSARY「快照」）。每次刮削都整体替换。 */
  snapshot: ScrapeSnapshot;
}

/**
 * 快照：源站自己的数据，按平台给出的名称与周期保存，不跨平台换算。
 * 刮削日期取书的 scrapedAt。
 */
export interface ScrapeSnapshot {
  /** 平台的数据项，按源站页面的顺序。label 是平台自己的叫法，例如「月票」；没有中文时为英文名。 */
  metrics: { key: string; label: string; value: number; period: string | null }[];
  /** 平台评分的满分，例如 10；平台没有评分时为 null。只用于 key 为 score 的数据项。 */
  scoreScale: number | null;
  /** 现在所在的榜单。label 是榜单名，channel 是频道名（整个榜单时为 null）；position 从 1 开始；url 是 DaoSearch 上的榜单页。 */
  rankings: { label: string; channel: string | null; position: number; url: string }[];
  /** 源站评分人数。 */
  ratingCount: number | null;
  /** 源站评论数。 */
  commentCount: number | null;
  /** 收录这本书的书单数。 */
  booklistCount: number | null;
  /** 近期更新速度：每周章节数；paused 为 true 表示记录期间没有新章节；days 是统计天数。完结或记录不足时为 null。 */
  pace: { chaptersPerWeek: number; paused: boolean; days: number } | null;
  /** 源站是否仍有这本书：available、removed_at_source（已下架）、withheld_at_source（暂不显示），可能出现新值。since 为 YYYY-MM-DD。 */
  availability: { state: string; since: string | null } | null;
  /** DaoSearch 最近一次读取源站的时间，ISO 8601。 */
  refreshedAt: string | null;
}

/** 刮削源当天的用量。刮削源不提供的项为 null。 */
export interface ScrapeQuota {
  remaining: number | null;
  limit: number | null;
  /** 额度重置的时间，ISO 8601。 */
  resetsAt: string | null;
}

/**
 * 一次请求在本地缓存中的状态，用来提前告诉所有者是否消耗点数：
 * fresh：缓存未过期，不发请求；stale：缓存已过期，内容没变时重新验证不消耗点数；none：没有缓存。
 */
export type CacheStatus = "fresh" | "stale" | "none";

export interface ScrapeSource {
  readonly id: ScrapeSourceId;
  /** 按书名、作者或书页链接搜索，最佳匹配在前。 */
  search(query: string): Promise<ScrapeCandidate[]>;
  getBook(ref: string): Promise<ScrapedBook>;
  /** 只查本地缓存，不请求刮削源。 */
  searchStatus(query: string): Promise<CacheStatus>;
  bookStatus(ref: string): Promise<CacheStatus>;
  /** 测试连接：确认密钥有效并返回当天用量，不消耗点数。 */
  check(): Promise<ScrapeQuota>;
}

/** 刮削源响应的缓存。key 由刮削源决定；fetchedAt 是最近一次从刮削源取得或验证的时间（毫秒）。 */
export interface ScrapeCache {
  get(key: string): Promise<{ etag: string | null; data: unknown; fetchedAt: number } | null>;
  /** 写入新的响应，取得时间记为现在。 */
  put(key: string, etag: string | null, data: unknown): Promise<void>;
  /** 记录一次使用；revalidated 为 true 时把取得时间也更新为现在（304 验证通过）。 */
  touch(key: string, revalidated: boolean): Promise<void>;
}

/**
 * 刮削失败的统一类型。
 * - invalid_key：密钥缺失、无效、已撤销，或账号被封禁。
 * - rate_limited：请求过于频繁，retryAfterSeconds 秒后重试。
 * - quota：当天点数已用完，retryAfterSeconds 秒后重置。
 * - not_found：作品不存在。
 * - unavailable：刮削源出错或维护中（5xx）、响应格式不对。
 * - network：网络错误或超时。
 */
export type ScrapeErrorKind = "invalid_key" | "rate_limited" | "quota" | "not_found" | "unavailable" | "network";

export class ScrapeError extends Error {
  readonly kind: ScrapeErrorKind;
  readonly retryAfterSeconds: number | undefined;
  constructor(kind: ScrapeErrorKind, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ScrapeError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
