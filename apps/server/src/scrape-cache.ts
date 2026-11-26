import { eq } from "drizzle-orm";
import type { AppDeps } from "./app";
import { scrapeCache } from "./db/schema";
import type { ScrapeCache } from "./scrape";

/** 存在 scrape_cache 表中的刮削缓存。 */
export function createDbScrapeCache(db: AppDeps["db"]): ScrapeCache {
  return {
    async get(key) {
      const row = await db.select().from(scrapeCache).where(eq(scrapeCache.key, key)).get();
      return row ? { etag: row.etag, data: row.data, fetchedAt: row.fetchedAt.getTime() } : null;
    },
    async put(key, etag, data) {
      const now = new Date();
      await db
        .insert(scrapeCache)
        .values({ key, etag, data, fetchedAt: now, usedAt: now })
        .onConflictDoUpdate({ target: scrapeCache.key, set: { etag, data, fetchedAt: now, usedAt: now } });
    },
    async touch(key, revalidated) {
      const now = new Date();
      await db
        .update(scrapeCache)
        .set(revalidated ? { usedAt: now, fetchedAt: now } : { usedAt: now })
        .where(eq(scrapeCache.key, key));
    },
  };
}
