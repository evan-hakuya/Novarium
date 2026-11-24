import { useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { DEFAULT_PROCESS_OPTIONS } from "@novarium/core";
import { booksQueryKey, describeError, formatBytes, importBook, MAX_UPLOAD_BYTES } from "@/api/books";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guessBookName } from "@/lib/book-name";
import { chapterText, processInWorker, type ProcessedVersion } from "@/lib/process";

type Stage =
  | { kind: "idle" }
  | { kind: "processing"; file: File }
  | { kind: "preview"; file: File; version: ProcessedVersion }
  | { kind: "uploading"; file: File; version: ProcessedVersion; step: string }
  | { kind: "error"; message: string; file?: File; version?: ProcessedVersion };

const stepText = { original: "上传原稿", text: "上传整理后的正文", index: "保存章节索引" } as const;

export function ImportPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStage({ kind: "error", message: `文件大小为 ${formatBytes(file.size)}，超过 100 MB 上限。` });
      return;
    }
    const guess = guessBookName(file.name);
    setTitle(guess.title);
    setAuthor(guess.author);
    setStage({ kind: "processing", file });
    try {
      const version = await processInWorker(await file.arrayBuffer(), DEFAULT_PROCESS_OPTIONS);
      if (version.text.byteLength > MAX_UPLOAD_BYTES) {
        setStage({ kind: "error", message: "整理后的正文超过 100 MB 上限。" });
        return;
      }
      setStage({ kind: "preview", file, version });
    } catch (error) {
      setStage({ kind: "error", message: `整理失败：${describeError(error)}` });
    }
  }

  async function onSubmit() {
    if (stage.kind !== "preview" && !(stage.kind === "error" && stage.file && stage.version)) return;
    const file = stage.file!;
    const version = stage.version!;
    try {
      const id = await importBook(
        { title, author, original: file, text: version.text, chapters: version.chapters, options: DEFAULT_PROCESS_OPTIONS },
        (step) => setStage({ kind: "uploading", file, version, step: stepText[step] }),
      );
      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      await navigate({ to: "/books/$bookId", params: { bookId: id } });
    } catch (error) {
      setStage({ kind: "error", message: describeError(error), file, version });
    }
  }

  const version = stage.kind === "preview" || stage.kind === "uploading" || stage.kind === "error" ? stage.version : undefined;
  const busy = stage.kind === "processing" || stage.kind === "uploading";

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

      {stage.kind === "processing" && <p className="text-sm text-muted-foreground">整理中：{stage.file.name}</p>}
      {stage.kind === "uploading" && <p className="text-sm text-muted-foreground">{stage.step}</p>}
      {stage.kind === "error" && <p className="whitespace-pre-wrap text-sm text-destructive">{stage.message}</p>}

      {version && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">书名</Label>
              <Input id="title" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="author">作者</Label>
              <Input id="author" value={author} disabled={busy} onChange={(e) => setAuthor(e.target.value)} />
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
            chapters={version.chapters}
            renderContent={(c) => <ChapterText text={chapterText(version.text, version.chapters[c.order]!)} />}
          />
        </>
      )}
    </div>
  );
}
