import { describe, expect, it } from "vitest";
import { cleanupScrapeCache, SCRAPE_CACHE_RETENTION_MS } from "./cleanup";
import { scrapeCache } from "./db/schema";
import { createDbScrapeCache } from "./scrape-routes";
import { createTestApp } from "./test-app";

describe("刮削缓存", () => {
  it("数据库缓存：写入、读取、使用与重新验证", async () => {
    const { deps } = createTestApp();
    const cache = createDbScrapeCache(deps.db);
    expect(await cache.get("/search?q=x")).toBeNull();
    await cache.put("/search?q=x", '"v1"', [{ a: 1 }]);
    await cache.put("/search?q=x", '"v2"', [{ a: 2 }]);
    const entry = await cache.get("/search?q=x");
    expect(entry).toMatchObject({ etag: '"v2"', data: [{ a: 2 }] });
    await deps.db.update(scrapeCache).set({ fetchedAt: new Date(0), usedAt: new Date(0) });
    await cache.touch("/search?q=x", false);
    let row = await deps.db.select().from(scrapeCache).get();
    expect(row?.fetchedAt.getTime()).toBe(0);
    expect(row?.usedAt.getTime()).toBeGreaterThan(0);
    await cache.touch("/search?q=x", true);
    row = await deps.db.select().from(scrapeCache).get();
    expect(row?.fetchedAt.getTime()).toBeGreaterThan(0);
  });

  it("清理只删除超过保留时长没有使用的缓存", async () => {
    const { deps } = createTestApp();
    const now = Date.now();
    const row = (key: string, usedAt: number) => ({ key, etag: null, data: {}, fetchedAt: new Date(usedAt), usedAt: new Date(usedAt) });
    await deps.db.insert(scrapeCache).values([row("old", now - SCRAPE_CACHE_RETENTION_MS - 1), row("recent", now - SCRAPE_CACHE_RETENTION_MS + 60_000)]);
    await cleanupScrapeCache(deps, now);
    expect((await deps.db.select().from(scrapeCache).all()).map((r) => r.key)).toEqual(["recent"]);
  });
});
