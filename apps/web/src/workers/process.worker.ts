/// <reference lib="webworker" />
import { findCandidateLines, processManuscript, type CandidateLine, type ChapterDraft, type ProcessOptions } from "@novarium/core";

// 在 Web Worker 中整理原稿，避免大文件阻塞页面。
export interface ProcessRequest {
  bytes: ArrayBuffer;
  options: ProcessOptions;
}

export type ProcessResponse =
  | { ok: true; text: ArrayBuffer; chapters: ChapterDraft[]; candidates: CandidateLine[] }
  | { ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  try {
    const draft = await processManuscript(new Uint8Array(event.data.bytes), event.data.options);
    // AI 复核的候选行也在 Worker 中找出，避免在页面上再扫一遍正文。
    const candidates = findCandidateLines(draft.text, event.data.options);
    const text = new TextEncoder().encode(draft.text).buffer as ArrayBuffer;
    const response: ProcessResponse = { ok: true, text, chapters: draft.chapters, candidates };
    scope.postMessage(response, [text]);
  } catch (error) {
    const response: ProcessResponse = { ok: false, error: error instanceof Error ? error.message : String(error) };
    scope.postMessage(response);
  }
};
