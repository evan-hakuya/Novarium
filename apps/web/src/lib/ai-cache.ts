import type { AiResult } from "./ai-review";

// AI 复核结果的浏览器缓存（ADR 0007）：IndexedDB，按原稿哈希、行标识、模型与提示词版本缓存。
// 整理完成后删除这本书的缓存；条目 7 天后过期，打开整理页时清理。

const DB_NAME = "novarium";
const STORE = "ai-lines";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry extends AiResult {
  /** `${scope}|${lineId}` */
  key: string;
  /** `${原稿哈希}|${模型}|v${提示词版本}` */
  scope: string;
  hash: string;
  lineId: string;
  at: number;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("scope", "scope");
      store.createIndex("hash", "hash");
      store.createIndex("at", "at");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => (opening = null));
  return opening;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export const cacheScope = (hash: string, model: string, promptVersion: number) => `${hash}|${model}|v${promptVersion}`;

/** 读出一份原稿在当前模型与提示词版本下的全部缓存结果。 */
export async function loadCachedResults(scope: string): Promise<Map<string, AiResult>> {
  const db = await open();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).index("scope").getAll(IDBKeyRange.only(scope));
  await done(tx);
  const now = Date.now();
  return new Map((req.result as Entry[]).filter((e) => now - e.at < TTL_MS).map((e) => [e.lineId, { kind: e.kind, confidence: e.confidence }]));
}

export async function saveCachedResults(scope: string, hash: string, results: ReadonlyMap<string, AiResult>) {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const at = Date.now();
  for (const [lineId, r] of results) store.put({ key: `${scope}|${lineId}`, scope, hash, lineId, at, kind: r.kind, confidence: r.confidence } satisfies Entry);
  await done(tx);
}

/** 删除一份原稿的全部缓存（任何模型与提示词版本）。 */
export async function deleteCachedResults(hash: string) {
  await deleteByIndex("hash", IDBKeyRange.only(hash));
}

/** 删除 7 天前的缓存。 */
export async function deleteExpiredResults() {
  await deleteByIndex("at", IDBKeyRange.upperBound(Date.now() - TTL_MS));
}

async function deleteByIndex(index: string, range: IDBKeyRange) {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  const req = tx.objectStore(STORE).index(index).openKeyCursor(range);
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    tx.objectStore(STORE).delete(cursor.primaryKey);
    cursor.continue();
  };
  await done(tx);
}

/** 原稿的 SHA-256（十六进制）。 */
export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
