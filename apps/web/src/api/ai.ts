import { useQuery } from "@tanstack/react-query";
import type { LineKind } from "@novarium/core";
import { ApiError, request } from "./books";

/** AI 复核的状态（ADR 0007）。configured：部署配置了 AI；enabled：所有者开启了 AI。 */
export interface AiStatus {
  configured: boolean;
  mode: "binding" | "rest" | null;
  enabled: boolean;
}

export const aiStatusQueryKey = ["settings", "ai"] as const;

export const fetchAiStatus = () => request<AiStatus>("/api/admin/settings/ai");

export const saveAiEnabled = (enabled: boolean) =>
  request<AiStatus>("/api/admin/settings/ai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

export const checkAi = () => request<{ ok: true; mode: AiStatus["mode"] }>("/api/admin/settings/ai/check", { method: "POST" });

/** AI 识别元数据的结果。null 表示 AI 没有给出建议。 */
export interface MetadataSuggestion {
  title: string | null;
  author: string | null;
  intro: string | null;
}

export const suggestMetadata = (fileName: string, head: string) =>
  request<{ suggestion: MetadataSuggestion }>("/api/admin/ai/metadata", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName, head }),
  }).then((r) => r.suggestion);

/** AI 复核章节的一题。 */
export interface LineQuestion {
  id: string;
  prev: string;
  line: string;
  next: string;
  gap: boolean;
}

export const reviewLines = (questions: LineQuestion[], signal?: AbortSignal) =>
  request<{ results: Record<string, { kind: LineKind; confidence: number }> }>("/api/admin/ai/lines", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questions }),
    signal,
  }).then((r) => r.results);

/** 整理页用：AI 已配置且已开启时才显示 AI 按钮。 */
export function useAiAvailable(): boolean {
  const status = useQuery({ queryKey: aiStatusQueryKey, queryFn: fetchAiStatus, staleTime: 60_000 });
  return !!status.data?.configured && status.data.enabled;
}

/** AI 调用失败时的提示。整理不受影响，只用规则继续。 */
export const AI_FALLBACK_TEXT = "AI 不可用，已只用规则识别";

const kindText: Record<string, string> = {
  quota: "今日免费额度已用完",
  busy: "Cloudflare 繁忙",
  timeout: "请求超时",
  unavailable: "调用失败",
};

/** AI 请求失败的原因，例如「今日免费额度已用完」。 */
export function aiFailureReason(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "ai_unavailable") return kindText[error.kind ?? ""] ?? kindText.unavailable;
    if (error.code === "ai_disabled") return "AI 已在设置中关闭";
    if (error.code === "ai_not_configured") return "部署没有配置 AI";
  }
  return kindText.unavailable;
}

/** 整理页的提示文字，例如「AI 不可用，已只用规则识别（今日免费额度已用完）」。 */
export const describeAiFailure = (error: unknown) => `${AI_FALLBACK_TEXT}（${aiFailureReason(error)}）`;
