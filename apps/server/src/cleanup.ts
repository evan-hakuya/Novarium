import { inArray, lt } from "drizzle-orm";
import type { AppDeps } from "./app";
import { pendingUploads, scrapeCache } from "./db/schema";

/** 上传后超过这个时长仍未被提交引用的文件视为孤立文件。 */
export const STALE_UPLOAD_MS = 60 * 60 * 1000;
/** 每次清理最多处理的文件数，避免撞上 Workers 的子请求上限。 */
export const CLEANUP_BATCH = 50;
/** 刮削缓存超过这个时长没有使用时删除。 */
export const SCRAPE_CACHE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 删除超过保留时长没有使用的刮削缓存。 */
export async function cleanupScrapeCache(deps: Pick<AppDeps, "db">, now = Date.now()): Promise<void> {
  await deps.db.delete(scrapeCache).where(lt(scrapeCache.usedAt, new Date(now - SCRAPE_CACHE_RETENTION_MS)));
}

/** 删除导入失败留下的孤立文件，返回删除的数量。 */
export async function cleanupStaleUploads(deps: Pick<AppDeps, "db" | "storage">, now = Date.now()): Promise<number> {
  const { db, storage } = deps;
  const stale = await db
    .select({ key: pendingUploads.key })
    .from(pendingUploads)
    .where(lt(pendingUploads.createdAt, new Date(now - STALE_UPLOAD_MS)))
    .orderBy(pendingUploads.createdAt)
    .limit(CLEANUP_BATCH);
  const keys = stale.map((row) => row.key);
  // 先删文件再删记录：中途失败时记录还在，下次清理会重试。
  for (const key of keys) await storage.delete(key);
  if (keys.length > 0) await db.delete(pendingUploads).where(inArray(pendingUploads.key, keys));
  console.log(JSON.stringify({ message: "stale uploads cleaned", deleted: keys.length }));
  return keys.length;
}
