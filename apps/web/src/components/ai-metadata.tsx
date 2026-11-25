import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { manuscriptHead } from "@novarium/core";
import { describeAiFailure, suggestMetadata, useAiAvailable, type MetadataSuggestion } from "@/api/ai";
import { Button } from "@/components/ui/button";

/**
 * 整理页的 AI 识别元数据（ADR 0007）：只在点击时调用；结果作为建议，不直接覆盖表单。
 * 换原稿时用新的 key 重新挂载，清空旧建议。
 */
export function useAiMetadata(source: { file: File; bytes: ArrayBuffer } | null) {
  const available = useAiAvailable();
  const [suggestion, setSuggestion] = useState<MetadataSuggestion | null>(null);
  const [sourceKey, setSourceKey] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: async (src: { file: File; bytes: ArrayBuffer }) =>
      suggestMetadata(src.file.name, await manuscriptHead(new Uint8Array(src.bytes))),
    onSuccess: (result, src) => {
      setSuggestion(result);
      setSourceKey(src.file);
    },
  });
  // 换了原稿时，旧建议不再适用。
  const current = source && sourceKey === source.file ? suggestion : null;
  const empty = current && !current.title && !current.author && !current.intro;
  return {
    available,
    suggestion: current,
    empty,
    pending: mutation.isPending,
    error: mutation.isError && mutation.variables?.file === source?.file ? describeAiFailure(mutation.error) : null,
    run: () => source && mutation.mutate(source),
  };
}

/** 字段下方的一行建议：与当前值相同（含已采用）或没有建议时不显示。 */
export function SuggestionLine({ value, current, onAdopt }: { value: string | null; current: string; onAdopt: () => void }) {
  if (!value || value === current.trim()) return null;
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">AI 建议</span>
      <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words">{value}</span>
      <Button type="button" size="xs" variant="outline" onClick={onAdopt}>
        采用
      </Button>
    </div>
  );
}
