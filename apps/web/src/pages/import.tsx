import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { booksQueryKey, describeError, formatBytes, importBook, MAX_UPLOAD_BYTES } from "@/api/books";
import { fetchDefaultProcessOptions, processOptionsQueryKey } from "@/api/settings";
import { OptionsPanel } from "@/components/options-panel";
import { PreviewBrowser } from "@/components/preview-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guessBookName } from "@/lib/book-name";
import { useProcessPreview } from "@/lib/use-process-preview";

interface Source {
  file: File;
  bytes: ArrayBuffer;
}

const stepText = { original: "上传原稿", text: "上传整理后的正文", index: "保存章节索引" } as const;

export function ImportPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const { options, preview, processing, error, setError, run, reset } = useProcessPreview();
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    reset();
    setSource(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`文件大小为 ${formatBytes(file.size)}，超过 100 MB 上限。`);
      return;
    }
    const guess = guessBookName(file.name);
    setTitle(guess.title);
    setAuthor(guess.author);
    try {
      const defaults = await queryClient.fetchQuery({
        queryKey: processOptionsQueryKey,
        queryFn: fetchDefaultProcessOptions,
      });
      const src = { file, bytes: await file.arrayBuffer() };
      setSource(src);
      await run(src.bytes, { ...defaults, chapterPattern: null });
    } catch (e) {
      setError(describeError(e));
    }
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
        <OptionsPanel
          key={source.file.name + source.file.lastModified}
          options={options}
          onChange={(next) => void run(source.bytes, next)}
          disabled={uploading}
        />
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
          <PreviewBrowser version={version} />
        </>
      )}
    </div>
  );
}
