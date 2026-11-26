import { describe, expect, it } from "vitest";
import { cleanupScrapeCache, SCRAPE_CACHE_RETENTION_MS } from "./cleanup";
import { scrapeCache } from "./db/schema";
import { createTestApp } from "./test-app";

describe("刮削缓存", () => {
  it("清理只删除超过保留时长没有使用的缓存", async () => {
    const { deps } = createTestApp();
    const now = Date.now();
    const row = (key: string, usedAt: number) => ({ key, etag: null, data: {}, fetchedAt: new Date(usedAt), usedAt: new Date(usedAt) });
    await deps.db.insert(scrapeCache).values([row("old", now - SCRAPE_CACHE_RETENTION_MS - 1), row("recent", now - SCRAPE_CACHE_RETENTION_MS + 60_000)]);
    await cleanupScrapeCache(deps, now);
    expect((await deps.db.select().from(scrapeCache).all()).map((r) => r.key)).toEqual(["recent"]);
  });
});
