import type { CandidateLine, ChapterDraft, ProcessOptions } from "@novarium/core";
import type { ProcessRequest, ProcessResponse } from "@/workers/process.worker";

export interface ProcessedVersion {
  /** 整理后正文的 UTF-8 字节，即版本文件内容。 */
  text: Uint8Array;
  chapters: ChapterDraft[];
  /** AI 复核的候选行。 */
  candidates: CandidateLine[];
}

/** 在新的 Web Worker 中整理一份原稿。每次调用用一个独立的 Worker，完成后结束它。 */
export function processInWorker(bytes: ArrayBuffer, options: ProcessOptions): Promise<ProcessedVersion> {
  const worker = new Worker(new URL("../workers/process.worker.ts", import.meta.url), { type: "module" });
  return new Promise<ProcessedVersion>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ProcessResponse>) => {
      const data = event.data;
      if (data.ok) resolve({ text: new Uint8Array(data.text), chapters: data.chapters, candidates: data.candidates });
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

/** 卷名，按出现顺序；相邻章节同名的算一卷，与章节列表的分组一致。 */
export function volumeNames(chapters: readonly { volume?: string | null }[]): string[] {
  return chapters.flatMap((c, i) => (c.volume && c.volume !== chapters[i - 1]?.volume ? [c.volume] : []));
}

/**
 * 重新整理时新旧版本的卷数文字。任一版本有卷就两边都显示（分卷规则可能只改卷、不改章节数）；
 * 卷数相同但卷名不同时 renamed 为 true。
 */
export function volumeChange(before: readonly string[], after: readonly string[]) {
  const show = before.length + after.length > 0;
  return {
    before: show ? ` · ${before.length} 卷` : "",
    after: show ? ` · ${after.length} 卷` : "",
    renamed: before.length === after.length && before.join("\n") !== after.join("\n"),
  };
}
