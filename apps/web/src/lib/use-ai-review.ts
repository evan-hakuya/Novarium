import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_LINE_BATCH_SIZE, AI_LINE_PROMPT_VERSION, AI_LINES_PER_RUN, AI_QUOTA_PERCENT_PER_LINE, type ProcessOptions } from "@novarium/core";
import { describeAiFailure, reviewLines, useAiAvailable, type LineQuestion } from "@/api/ai";
import { ApiError } from "@/api/books";
import { cacheScope, deleteCachedResults, deleteExpiredResults, hashBytes, loadCachedResults, saveCachedResults } from "@/lib/ai-cache";
import { autoApply, reviewAiLines, undoAllAiFixes, unjudgedCandidates, type AiResult, type ReviewScope } from "@/lib/ai-review";
import type { Preview } from "@/lib/use-process-preview";

const MODEL = "clef";
/** 题目只写每行前 50 字，多发一些留给服务端截断。 */
const clip = (s: string) => [...s].slice(0, 100).join("");

/** Workers AI 偶尔返回 internal error 或容量不足：每批最多再试两次。额度用完与未开启不重试。 */
const RETRY_DELAYS_MS = [1000, 3000];

async function reviewWithRetry(questions: LineQuestion[], signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await reviewLines(questions, signal);
    } catch (e) {
      const retryable = e instanceof ApiError && e.code === "ai_unavailable" && e.kind !== "quota";
      const delay = RETRY_DELAYS_MS[attempt];
      if (!retryable || delay === undefined || signal.aborted) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export interface AiReviewProgress {
  done: number;
  total: number;
}

/**
 * 整理预览中的 AI 复核章节（ADR 0007）：只在所有者确认后调用，每批 64 行，可取消；
 * 结果缓存在浏览器，置信度不低于 0.8 的不一致判断直接采用为行级修正。
 */
export function useAiReview({
  bytes,
  preview,
  processing,
  onChangeOptions,
}: {
  bytes: ArrayBuffer | null;
  preview: Preview | null;
  processing: boolean;
  onChangeOptions: (next: ProcessOptions) => void;
}) {
  const available = useAiAvailable();
  const [hash, setHash] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, AiResult>>(new Map());
  const [progress, setProgress] = useState<AiReviewProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(preview);
  latest.current = preview;
  const currentHash = useRef(hash);
  currentHash.current = hash;

  // 换原稿时计算哈希并读出缓存的结果；每次打开整理页清理一次过期缓存。
  useEffect(() => {
    void deleteExpiredResults().catch(() => {});
  }, []);
  useEffect(() => {
    let stale = false;
    setHash(null);
    setResults(new Map());
    setError(null);
    if (!bytes) return;
    void (async () => {
      const h = await hashBytes(bytes);
      if (stale) return;
      setHash(h);
      const cached = await loadCachedResults(cacheScope(h, MODEL, AI_LINE_PROMPT_VERSION)).catch(() => new Map<string, AiResult>());
      if (!stale) setResults(cached);
    })();
    return () => {
      stale = true;
      abort.current?.abort();
    };
  }, [bytes]);

  // 新到的结果中，置信度高的不一致判断直接采用。整理进行中时等待最新预览。
  useEffect(() => {
    if (!preview || processing || results.size === 0) return;
    const next = autoApply(preview.version.candidates, preview.options, results);
    if (next) onChangeOptions(next);
  }, [preview, processing, results, onChangeOptions]);

  const items = useMemo(
    () => (preview ? reviewAiLines(preview.version.candidates, preview.version.chapters, preview.options, results) : []),
    [preview, results],
  );
  const unjudged = useMemo(
    () => (preview ? unjudgedCandidates(preview.version.candidates, preview.options, results) : []),
    [preview, results],
  );
  const unjudgedSuspicious = useMemo(() => unjudged.filter((c) => c.suspicious), [unjudged]);

  const start = useCallback(async (scope: ReviewScope) => {
    if (!preview || !hash || progress) return;
    const pool = scope === "suspicious" ? unjudgedSuspicious : unjudged;
    const batch = pool.slice(0, AI_LINES_PER_RUN);
    if (batch.length === 0) return;
    const percent = Math.max(0.1, batch.length * AI_QUOTA_PERCENT_PER_LINE).toFixed(1);
    const what = scope === "suspicious" ? "可疑行" : "候选行";
    const more = pool.length > batch.length ? `（共 ${pool.length} 行未判断，单次最多 ${AI_LINES_PER_RUN} 行，其余可以再次复核）` : "";
    if (!window.confirm(`AI 复核 ${batch.length} 个${what}${more}，预计占用每日免费额度约 ${percent}%。这些行及其上下文会发送到 Cloudflare 处理。确定开始？`)) return;

    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setProgress({ done: 0, total: batch.length });
    const cacheKey = cacheScope(hash, MODEL, AI_LINE_PROMPT_VERSION);
    try {
      for (let i = 0; i < batch.length; i += AI_LINE_BATCH_SIZE) {
        const chunk = batch.slice(i, i + AI_LINE_BATCH_SIZE);
        const got = await reviewWithRetry(
          chunk.map((c) => ({ id: c.id, prev: clip(c.prev), line: clip(c.text), next: clip(c.next), gap: c.gap })),
          controller.signal,
        );
        const fresh = new Map(Object.entries(got));
        await saveCachedResults(cacheKey, hash, fresh).catch(() => {});
        // 换了原稿时，旧原稿的结果只留在缓存里。
        if (currentHash.current !== hash) break;
        setResults((prev) => new Map([...prev, ...fresh]));
        // 取消时保留已经返回的结果，不再发送下一批。
        if (controller.signal.aborted) break;
        setProgress({ done: Math.min(i + chunk.length, batch.length), total: batch.length });
      }
    } catch (e) {
      // 取消时正在进行的一批被中止，不算失败。
      if (!controller.signal.aborted) setError(describeAiFailure(e));
    } finally {
      abort.current = null;
      setProgress(null);
    }
  }, [preview, hash, progress, unjudged, unjudgedSuspicious]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  const undoAll = useCallback(() => {
    const current = latest.current;
    if (current) onChangeOptions(undoAllAiFixes(current.options));
  }, [onChangeOptions]);

  /** 整理完成后删除这份原稿的缓存。 */
  const clearCache = useCallback(async () => {
    if (hash) await deleteCachedResults(hash).catch(() => {});
  }, [hash]);

  return {
    available,
    items,
    pendingCount: items.filter((i) => i.status === "pending").length,
    fixedCount: preview?.options.lineOverrides.length ?? 0,
    unjudgedCount: unjudged.length,
    unjudgedSuspiciousCount: unjudgedSuspicious.length,
    ready: !!hash,
    progress,
    error,
    start,
    cancel,
    undoAll,
    clearCache,
  };
}

export type AiReview = ReturnType<typeof useAiReview>;
