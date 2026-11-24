/// <reference lib="webworker" />
import { processManuscript, type ChapterDraft, type ProcessOptions } from "@novarium/core";

// 在 Web Worker 中整理原稿，避免大文件阻塞页面。
export interface ProcessRequest {
  bytes: ArrayBuffer;
  options: ProcessOptions;
}

export type ProcessResponse =
  | { ok: true; text: ArrayBuffer; chapters: ChapterDraft[] }
  | { ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  try {
    const draft = await processManuscript(new Uint8Array(event.data.bytes), event.data.options);
    const text = new TextEncoder().encode(draft.text).buffer as ArrayBuffer;
    const response: ProcessResponse = { ok: true, text, chapters: draft.chapters };
    scope.postMessage(response, [text]);
  } catch (error) {
    const response: ProcessResponse = { ok: false, error: error instanceof Error ? error.message : String(error) };
    scope.postMessage(response);
  }
};
