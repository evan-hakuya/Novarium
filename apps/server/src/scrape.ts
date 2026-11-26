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

/** 按 ID 读取到的作品。 */
export interface ScrapedBook extends ScrapeCandidate {
  intro: string | null;
  tags: string[];
  /** 字数（汉字）。 */
  wordCount: number | null;
  status: "ongoing" | "completed" | null;
  /** 首发日期，精度不定：YYYY-MM-DD、YYYY-MM 或 YYYY。 */
  releasedAt: string | null;
}

/** 刮削源当天的用量。刮削源不提供的项为 null。 */
export interface ScrapeQuota {
  remaining: number | null;
  limit: number | null;
  /** 额度重置的时间，ISO 8601。 */
  resetsAt: string | null;
}

export interface ScrapeSource {
  readonly id: ScrapeSourceId;
  /** 按书名、作者或书页链接搜索，最佳匹配在前。 */
  search(query: string): Promise<ScrapeCandidate[]>;
  getBook(ref: string): Promise<ScrapedBook>;
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
