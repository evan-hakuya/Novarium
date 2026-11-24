import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createApi, type AppDeps } from "./app";
import { createSessionValue, SESSION_COOKIE } from "./auth";
import * as schema from "./db/schema";
import { createFsStorage } from "./storage/fs";
import { versionTextKey } from "./storage/keys";

// 测试用的完整应用：内存 SQLite + 临时目录存储，与 Node 入口使用同一套迁移。

export const ORIGIN = "https://novarium.example";
export const PASSWORD = "test-password";
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export function createTestApp() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  const deps: AppDeps = {
    runtime: "node",
    db,
    storage: createFsStorage(mkdtempSync(join(tmpdir(), "novarium-test-"))),
    ownerPassword: PASSWORD,
    batch: async (queries) => {
      sqlite.transaction(() => {
        for (const query of queries) (query as unknown as { run(): unknown }).run();
      })();
    },
  };
  const api = createApi(() => deps);
  const fetchApi = async (path: string, init?: RequestInit) => api.request(new URL(path, ORIGIN).toString(), init);
  return { deps, fetchApi };
}

export async function ownerCookieHeader() {
  return `${SESSION_COOKIE}=${await createSessionValue(PASSWORD)}`;
}

/** 绕过导入流程，直接写入一本书。 */
export async function addBook(deps: AppDeps, id: string, title: string, author: string, chapterTexts: [string, string][]) {
  const versionId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let offset = 0;
  const index = chapterTexts.map(([chapterTitle, body], order) => {
    const byteLength = encoder.encode(body).length;
    const entry = { versionId, ord: order, title: chapterTitle, number: order + 1, byteOffset: offset, byteLength };
    offset += byteLength;
    return entry;
  });
  await deps.storage.put(versionTextKey(id, versionId), encoder.encode(chapterTexts.map(([, body]) => body).join("")));
  const now = new Date();
  await deps.db.insert(schema.versions).values({ id: versionId, bookId: id, options: {}, textSize: offset, chapterCount: index.length, createdAt: now });
  await deps.db.insert(schema.chapters).values(index);
  await deps.db.insert(schema.books).values({ id, title, author, originalName: `${title}.txt`, originalSize: offset, currentVersionId: versionId, createdAt: now, updatedAt: now });
}
