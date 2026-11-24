import type { ByteRange, StorageProvider } from "./types";

export function createR2Storage(bucket: R2Bucket): StorageProvider {
  return {
    async put(key, data) {
      await bucket.put(key, data);
    },
    async get(key, range?: ByteRange) {
      const object = await bucket.get(key, range ? { range } : undefined);
      return object?.body ?? null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async exists(key) {
      return (await bucket.head(key)) !== null;
    },
  };
}
