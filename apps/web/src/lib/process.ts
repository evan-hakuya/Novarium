import type { ChapterDraft, ProcessOptions } from "@novarium/core";
import type { ProcessRequest, ProcessResponse } from "@/workers/process.worker";

export interface ProcessedVersion {
  /** 整理后正文的 UTF-8 字节，即版本文件内容。 */
  text: Uint8Array;
  chapters: ChapterDraft[];
}

/** 在新的 Web Worker 中整理一份原稿。每次调用用一个独立的 Worker，完成后结束它。 */
export function processInWorker(bytes: ArrayBuffer, options: ProcessOptions): Promise<ProcessedVersion> {
  const worker = new Worker(new URL("../workers/process.worker.ts", import.meta.url), { type: "module" });
  return new Promise<ProcessedVersion>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ProcessResponse>) => {
      const data = event.data;
      if (data.ok) resolve({ text: new Uint8Array(data.text), chapters: data.chapters });
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => reject(new Error(event.message || "worker failed"));
    const request: ProcessRequest = { bytes, options };
    worker.postMessage(request, [bytes]);
  }).finally(() => worker.terminate());
}

const decoder = new TextDecoder();

/** 按章节的字节范围从版本正文中读出章节正文。 */
export function chapterText(text: Uint8Array, chapter: ChapterDraft): string {
  return decoder.decode(text.subarray(chapter.byteOffset, chapter.byteOffset + chapter.byteLength));
}
