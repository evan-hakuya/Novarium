import { useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { checkChapterPattern, type ProcessOptions } from "@novarium/core";
import { booksQueryKey, describeError, formatBytes, importBook, MAX_UPLOAD_BYTES } from "@/api/books";
import { fetchDefaultProcessOptions, processOptionsQueryKey } from "@/api/settings";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { CleaningStepsForm } from "@/components/process-options-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guessBookName } from "@/lib/book-name";
import { chapterText, processInWorker, type ProcessedVersion } from "@/lib/process";

/** 一次整理的结果，连同生成它的整理选项。提交时版本记录这份选项。 */
interface Preview {
  version: ProcessedVersion;
  options: ProcessOptions;
}

interface Source {
  file: File;
  bytes: ArrayBuffer;
}

const stepText = { original: "上传原稿", text: "上传整理后的正文", index: "保存章节索引" } as const;

export function ImportPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  // 预览中正在编辑的整理选项。改动后重新整理，结果到达前继续显示上一次的预览。
  const [options, setOptions] = useState<ProcessOptions | null>(null);
  const [patternDraft, setPatternDraft] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  // 只采用最近一次整理的结果。
  const runId = useRef(0);

  async function run(src: Source, opts: ProcessOptions) {
    const id = ++runId.current;
    setOptions(opts);
    setProcessing(true);
    setError(null);
    try {
      // Worker 会接管传入的缓冲区，所以每次传一份副本。
      const version = await processInWorker(src.bytes.slice(0), opts);
      if (id !== runId.current) return;
      if (version.text.byteLength > MAX_UPLOAD_BYTES) {
        setError("整理后的正文超过 100 MB 上限。");
        setPreview(null);
        return;
      }
      setPreview({ version, options: opts });
    } catch (e) {
      if (id === runId.current) setError(`整理失败：${describeError(e)}`);
    } finally {
      if (id === runId.current) setProcessing(false);
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(null);
    setSource(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`文件大小为 ${formatBytes(file.size)}，超过 100 MB 上限。`);
      return;
    }
    const guess = guessBookName(file.name);
    setTitle(guess.title);
    setAuthor(guess.author);
    setPatternDraft("");
    setPatternError(null);
    try {
      const defaults = await queryClient.fetchQuery({
        queryKey: processOptionsQueryKey,
        queryFn: fetchDefaultProcessOptions,
      });
      const src = { file, bytes: await file.arrayBuffer() };
      setSource(src);
      await run(src, { ...defaults, chapterPattern: null });
    } catch (e) {
      setError(describeError(e));
    }
  }

  function changeOptions(next: ProcessOptions) {
    if (source) void run(source, next);
  }

  function applyPattern() {
    if (!options) return;
    const pattern = patternDraft.trim();
    const problem = pattern ? checkChapterPattern(pattern) : null;
    setPatternError(problem ? `正则无效：${problem}` : null);
    if (!problem) changeOptions({ ...options, chapterPattern: pattern || null });
  }

  async function onSubmit() {
    if (!source || !preview) return;
    const { version, options: used } = preview;
    setError(null);
    try {
      const id = await importBook(
        { title, author, original: source.file, text: version.text, chapters: version.chapters, options: used },
        (step) => setUploadStep(stepText[step]),
      );
      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      await navigate({ to: "/books/$bookId", params: { bookId: id } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setUploadStep(null);
    }
  }

  const uploading = uploadStep !== null;
  const busy = processing || uploading;
  const version = preview?.version;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← 书库
      </Link>
      <h2 className="font-heading text-xl font-semibold">导入</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">原稿（TXT，不超过 100 MB）</Label>
        <Input id="file" type="file" accept=".txt,text/plain" disabled={busy} onChange={onFile} />
      </div>

      {processing && <p className="text-sm text-muted-foreground">整理中：{source?.file.name}</p>}
      {uploadStep && <p className="text-sm text-muted-foreground">{uploadStep}</p>}
      {error && <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p>}

      {options && source && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">整理选项</summary>
          <div className="mt-4 flex flex-col gap-4">
            <CleaningStepsForm value={options} onChange={changeOptions} disabled={uploading} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="chapter-pattern">本书的章节正则</Label>
              <div className="flex gap-2">
                <Input
                  id="chapter-pattern"
                  value={patternDraft}
                  disabled={uploading}
                  placeholder="留空使用内置规则，例如 ^卷.+$"
                  aria-invalid={!!patternError}
                  onChange={(e) => setPatternDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyPattern()}
                />
                <Button variant="outline" disabled={uploading} onClick={applyPattern}>
                  应用
                </Button>
              </div>
              {patternError && <span className="text-xs text-destructive">{patternError}</span>}
              <span className="text-xs text-muted-foreground">
                每行单独匹配。过滤词表（{options.filterWords.length} 个词）在「设置」中维护。
              </span>
            </div>
          </div>
        </details>
      )}

      {version && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">书名</Label>
              <Input id="title" value={title} disabled={uploading} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="author">作者</Label>
              <Input id="author" value={author} disabled={uploading} onChange={(e) => setAuthor(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {version.chapters.length} 章 · 整理后 {formatBytes(version.text.byteLength)}
            </span>
            <Button onClick={onSubmit} disabled={busy || !title.trim()}>
              提交
            </Button>
          </div>
          <ChapterBrowser
            key={version.chapters.length + ":" + version.text.byteLength}
            chapters={version.chapters}
            renderContent={(c) => <ChapterText text={chapterText(version.text, version.chapters[c.order]!)} />}
          />
        </>
      )}
    </div>
  );
}
