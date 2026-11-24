import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable, Writable } from "node:stream";
import type { ByteRange, StorageProvider } from "./types";

export function createFsStorage(root: string): StorageProvider {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    if (path !== base && !path.startsWith(base + sep)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return path;
  };

  return {
    async put(key, data) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      if (data instanceof Uint8Array) {
        await writeFile(path, data);
        return;
      }
      await data.pipeTo(Writable.toWeb(createWriteStream(path)) as WritableStream<Uint8Array>);
    },
    async get(key, range?: ByteRange) {
      const path = pathOf(key);
      if (!(await exists(path))) return null;
      if (range && range.length === 0) return new ReadableStream({ start: (c) => c.close() });
      const stream = createReadStream(
        path,
        range ? { start: range.offset, end: range.offset + range.length - 1 } : undefined,
      );
      return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async exists(key) {
      return exists(pathOf(key));
    },
    async size(key) {
      try {
        const s = await stat(pathOf(key));
        return s.isFile() ? s.size : null;
      } catch {
        return null;
      }
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
