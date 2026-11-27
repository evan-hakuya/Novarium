import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { ProcessOptions } from "@novarium/core";
import { booksQueryKey, describeError, fetchBook, fetchOriginal, formatBytes, saveNewVersion } from "@/api/books";
import { fetchDefaultProcessOptions, processOptionsQueryKey } from "@/api/settings";
import { AiReviewToolbar } from "@/components/ai-review-toolbar";
import { OptionsPanel } from "@/components/options-panel";
import { PreviewBrowser } from "@/components/preview-browser";
import { Button } from "@/components/ui/button";
import { countPending, reviewNumbers } from "@/lib/number-review";
import { volumeNames } from "@/lib/process";
import { useAiReview } from "@/lib/use-ai-review";
import { useProcessPreview } from "@/lib/use-process-preview";

const route = getRouteApi("/owner/books/$bookId/reprocess");
const stepText = { original: "上传原稿", text: "上传新版本正文", index: "保存章节索引并切换版本" } as const;

// 重新整理：从原稿按新的整理选项生成新版本，保存后切换为当前版本。
export function ReprocessPage() {
  const { bookId } = route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const detail = useQuery({ queryKey: ["books", bookId], queryFn: () => fetchBook(bookId) });
  const original = useQuery({ queryKey: ["books", bookId, "original"], queryFn: () => fetchOriginal(bookId), staleTime: Infinity, gcTime: 0 });
  const { options, preview, processing, error, setError, run, patchOptions } = useProcessPreview();
  const [saveStep, setSaveStep] = useState<string | null>(null);
  const rerun = useCallback((next: ProcessOptions) => original.data && void run(original.data, next), [original.data, run]);
  const review = useAiReview({ bytes: original.data ?? null, preview, processing, onChangeOptions: rerun });
  const pending = useMemo(
    () => (preview ? countPending(reviewNumbers(preview.version.chapters, preview.options)) : 0) + review.pendingCount,
    [preview, review.pendingCount],
  );

  // 初始值为当前版本记录的整理选项。早期版本没有 AI 修正的记录。
  useEffect(() => {
    if (detail.data && original.data && !options) {
      const saved = detail.data.version.options;
      void run(original.data, { ...saved, lineOverrides: saved.lineOverrides ?? [], lineIgnores: saved.lineIgnores ?? [] });
    }
  }, [detail.data, original.data, options, run]);

  async function useLibraryFilterWords() {
    if (!options || !original.data) return;
    const defaults = await queryClient.fetchQuery({ queryKey: processOptionsQueryKey, queryFn: fetchDefaultProcessOptions });
    void run(original.data, { ...options, filterWords: defaults.filterWords, filterMaxLineLength: defaults.filterMaxLineLength });
  }

  async function onSave() {
    if (!preview) return;
    setError(null);
    try {
      await saveNewVersion(
        bookId,
        { text: preview.version.text, chapters: preview.version.chapters, options: preview.options },
        (step) => setSaveStep(stepText[step]),
      );
      await review.clearCache();
      await queryClient.invalidateQueries({ queryKey: ["books", bookId] });
      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      await navigate({ to: "/books/$bookId", params: { bookId } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaveStep(null);
    }
  }

  const loadError = detail.error ?? original.error;
  if (loadError) return <p className="text-sm text-destructive">{describeError(loadError)}</p>;
  if (!detail.data || !original.data || !options) return <p className="text-sm text-muted-foreground">读取原稿…</p>;

  const saving = saveStep !== null;
  const current = detail.data;
  const version = preview?.version;
  // 只要新旧任一版本有卷就显示两边的卷数：分卷规则可能只改卷、不改章节数。
  const before = volumeNames(current.chapters);
  const after = version ? volumeNames(version.chapters) : [];
  const showVolumes = before.length + after.length > 0;
  const volumeChange = {
    before: showVolumes ? ` · ${before.length} 卷` : "",
    after: showVolumes ? ` · ${after.length} 卷` : "",
    renamed: before.length === after.length && before.join("\n") !== after.join("\n"),
  };

  return (
    <div className="flex flex-col gap-4">
      <Link to="/books/$bookId" params={{ bookId }} className="text-sm text-muted-foreground hover:underline">
        ← {current.book.title}
      </Link>
      <h2 className="font-heading text-xl font-semibold">重新整理</h2>
      <p className="text-sm text-muted-foreground">
        从原稿 {current.book.originalName} 按下面的整理选项重新整理。保存后新版本成为当前版本，旧版本被删除，原稿不变。
      </p>

      <OptionsPanel options={options} onChange={(next) => void run(original.data, next)} disabled={saving} open />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        当前版本使用 {options.filterWords.length} 个过滤词。
        <Button variant="outline" size="xs" disabled={saving || processing} onClick={useLibraryFilterWords}>
          改用书库当前的过滤词表
        </Button>
      </div>

      {processing && <p className="text-sm text-muted-foreground">整理中…</p>}
      {saveStep && <p className="text-sm text-muted-foreground">{saveStep}</p>}
      {error && <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p>}

      {version && (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              当前 {current.chapters.length} 章{volumeChange.before} → 新版本 {version.chapters.length} 章{volumeChange.after}
              {volumeChange.renamed && "（卷名有变化）"} · 整理后{" "}
              {formatBytes(version.text.byteLength)}
              {pending > 0 && <span className="text-destructive"> · 还有 {pending} 处章节异常待处理</span>}
            </span>
            <Button onClick={onSave} disabled={processing || saving || pending > 0 || !!review.progress}>
              保存为新版本
            </Button>
          </div>
          <PreviewBrowser
            version={version}
            options={preview.options}
            onChangeOptions={(next) => void run(original.data, next)}
            onPatchOptions={patchOptions}
            aiItems={review.items}
            toolbar={<AiReviewToolbar ai={review} disabled={saving || processing} />}
            disabled={saving || processing}
          />
        </>
      )}
    </div>
  );
}
