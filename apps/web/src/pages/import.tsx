import { useMemo, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  booksQueryKey,
  describeError,
  findDuplicates,
  formatBytes,
  importBook,
  MAX_UPLOAD_BYTES,
  saveNewVersion,
  type DuplicateBook,
} from "@/api/books";
import { fetchDefaultProcessOptions, processOptionsQueryKey } from "@/api/settings";
import { OptionsPanel } from "@/components/options-panel";
import { PreviewBrowser } from "@/components/preview-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { guessBookName } from "@/lib/book-name";
import { countPending, reviewNumbers } from "@/lib/number-review";
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
  const { options, preview, processing, error, setError, run, reset, patchOptions } = useProcessPreview();
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  // 书库中同名同作者的书；不为 null 时等待所有者选择导入方式。
  const [duplicates, setDuplicates] = useState<DuplicateBook[] | null>(null);

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
    setError(null);
    try {
      const found = await findDuplicates(title, author);
      if (found.length > 0) {
        setDuplicates(found);
        return;
      }
      await importAsNewBook();
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function importAsNewBook() {
    if (!source || !preview) return;
    const { version, options: used } = preview;
    setDuplicates(null);
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

  /** 把这份原稿作为已有书的新版本：替换原稿，按重新整理的流程生成并切换版本。 */
  async function importAsNewVersion(bookId: string) {
    if (!source || !preview) return;
    const { version, options: used } = preview;
    setDuplicates(null);
    setError(null);
    try {
      await saveNewVersion(
        bookId,
        { text: version.text, chapters: version.chapters, options: used },
        (step) => setUploadStep(stepText[step]),
        source.file,
      );
      await queryClient.invalidateQueries({ queryKey: ["books"] });
      await navigate({ to: "/books/$bookId", params: { bookId } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setUploadStep(null);
    }
  }

  const uploading = uploadStep !== null;
  const busy = processing || uploading;
  const version = preview?.version;
  const pending = useMemo(() => (preview ? countPending(reviewNumbers(preview.version.chapters, preview.options)) : 0), [preview]);

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
              {pending > 0 && <span className="text-destructive"> · 还有 {pending} 处章节序号异常待处理</span>}
            </span>
            <Button onClick={onSubmit} disabled={busy || !title.trim() || pending > 0 || duplicates !== null}>
              提交
            </Button>
          </div>
          {duplicates && (
            <section className="flex flex-col gap-3 rounded-xl border border-amber-500/50 bg-amber-50/50 p-4 text-sm dark:bg-amber-950/20">
              <p className="font-medium">
                书库中已有同名同作者的书。选择这份原稿的导入方式：
              </p>
              <ul className="flex flex-col gap-2">
                {duplicates.map((book) => (
                  <li key={book.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3">
                    <span>
                      《{book.title}》{book.author || "佚名"} · {book.chapterCount} 章 · 原稿 {book.originalName} · 更新于{" "}
                      {new Date(book.updatedAt).toLocaleString()}
                    </span>
                    <Button size="sm" disabled={busy} onClick={() => importAsNewVersion(book.id)}>
                      作为这本书的新版本
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                作为新版本：这本书的原稿换成这份原稿，当前版本换成本次整理结果，旧原稿与旧版本被删除。作为新书：书库中另建一本，已有的书不变。
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={importAsNewBook}>
                  作为新书
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDuplicates(null)}>
                  取消
                </Button>
              </div>
            </section>
          )}
          <PreviewBrowser
            version={version}
            options={preview.options}
            onChangeOptions={(next) => source && void run(source.bytes, next)}
            onPatchOptions={patchOptions}
            disabled={busy}
          />
        </>
      )}
    </div>
  );
}
