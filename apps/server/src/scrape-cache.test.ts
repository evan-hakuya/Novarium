import { describe, expect, it } from "vitest";
import { scrapeCache } from "./db/schema";
import { createDbScrapeCache } from "./scrape-cache";
import { createTestApp } from "./test-app";

describe("数据库刮削缓存", () => {
  it("写入、读取、使用与重新验证", async () => {
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
});
