import { useCallback, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { manuscriptHead, type ProcessOptions } from "@novarium/core";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  booksQueryKey,
  describeError,
  emptyDescription,
  findDuplicates,
  formatBytes,
  importBook,
  MAX_UPLOAD_BYTES,
  saveNewVersion,
  type DuplicateBook,
} from "@/api/books";
import { fetchDefaultProcessOptions, processOptionsQueryKey } from "@/api/settings";
import {
  applyScrape,
  fetchScrapeStatus,
  platformName,
  scrapeFailureReason,
  scrapeStatusQueryKey,
  type ScrapedBook,
  type ScrapeField,
} from "@/api/scrape";
import { SuggestionLine, useAiMetadata } from "@/components/ai-metadata";
import { AiReviewToolbar } from "@/components/ai-review-toolbar";
import { OptionsPanel } from "@/components/options-panel";
import { PreviewBrowser } from "@/components/preview-browser";
import { ScrapeDialog, type ScrapeApply } from "@/components/scrape-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { guessBookName } from "@/lib/book-name";
import { countPending, reviewNumbers } from "@/lib/number-review";
import { useAiReview } from "@/lib/use-ai-review";
import { useProcessPreview } from "@/lib/use-process-preview";

interface Source {
  file: File;
  bytes: ArrayBuffer;
}

const stepText = { original: "上传原稿", text: "上传整理后的正文", index: "保存章节索引" } as const;

/** 导入页选定的刮削结果。fields 只含导入成功后才写入的字段（表单以外的）；before 是填入前的表单值，取消时恢复。 */
interface ScrapePick {
  scraped: ScrapedBook;
  fields: ScrapeField[];
  before: { title: string; author: string; intro: string };
}

/** 导入成功后才写入的字段。书名、作者、简介直接填进表单。 */
const lateFieldText: Partial<Record<ScrapeField, string>> = {
  tags: "标签",
  cover: "封面",
  genre: "分类",
  subgenre: "子分类",
  status: "连载状态",
  aliases: "别名",
  authorEn: "作者英文名",
  wordCount: "源站字数",
  released: "首发日期",
  sourceUpdatedAt: "源站更新",
  facets: "平台标记",
  mature: "成人向",
  sourceUrl: "源站链接",
  alsoOn: "其他平台",
};

export function ImportPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const { options, preview, processing, error, setError, run, reset, patchOptions } = useProcessPreview();
  const [uploadStep, setUploadStep] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [intro, setIntro] = useState("");
  const ai = useAiMetadata(source);
  // 错误显示在引发它的那一步：整理出错在「检查章节」，导入出错在「确认导入」。
  const [errorAt, setErrorAt] = useState<"process" | "import">("process");
  const rerun = useCallback(
    (next: ProcessOptions) => {
      if (!source) return;
      setErrorAt("process");
      void run(source.bytes, next);
    },
    [source, run],
  );
  const review = useAiReview({ bytes: source?.bytes ?? null, preview, processing, onChangeOptions: rerun });
  // 书库中同名同作者的书；不为 null 时等待所有者选择导入方式。
  const [duplicates, setDuplicates] = useState<DuplicateBook[] | null>(null);
  // 没有填写刮削源密钥时不显示刮削入口。
  const scrapeStatus = useQuery({ queryKey: scrapeStatusQueryKey, queryFn: fetchScrapeStatus, staleTime: 60_000 });
  const [scraping, setScraping] = useState(false);
  const [scrapePick, setScrapePick] = useState<ScrapePick | null>(null);
  // 书已导入、但写入刮削的标签或封面失败时，显示原因与书的链接。
  const [scrapeFailure, setScrapeFailure] = useState<{ bookId: string; what: string; reason: string } | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    reset();
    setSource(null);
    setScrapePick(null);
    setScrapeFailure(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`文件大小为 ${formatBytes(file.size)}，超过 100 MB 上限。`);
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const guess = guessBookName(file.name, await manuscriptHead(new Uint8Array(bytes), 1000));
      setTitle(guess.title);
      setAuthor(guess.author);
      setIntro("");
      const defaults = await queryClient.fetchQuery({
        queryKey: processOptionsQueryKey,
        queryFn: fetchDefaultProcessOptions,
      });
      const src = { file, bytes };
      setSource(src);
      await run(src.bytes, { ...defaults, chapterPattern: null });
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function onSubmit() {
    if (!source || !preview) return;
    setErrorAt("import");
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
    setErrorAt("import");
    setError(null);
    try {
      const id = await importBook(
        { title, author, intro, original: source.file, text: version.text, chapters: version.chapters, options: used },
        (step) => setUploadStep(stepText[step]),
      );
      await review.clearCache();
      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      if (!(await applyPickAfterImport(id))) return;
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
    setErrorAt("import");
    setError(null);
    try {
      await saveNewVersion(
        bookId,
        { text: version.text, chapters: version.chapters, options: used },
        (step) => setUploadStep(stepText[step]),
        source.file,
      );
      await review.clearCache();
      await queryClient.invalidateQueries({ queryKey: ["books"] });
      if (!(await applyPickAfterImport(bookId))) return;
      await navigate({ to: "/books/$bookId", params: { bookId } });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setUploadStep(null);
    }
  }

  /**
   * 导入成功后写入选定的标签与封面，并记下刮削来源。读取作品通常命中服务端缓存，不再扣点。
   * 失败时书照常导入，页面显示原因与书的链接，返回 false。
   */
  async function applyPickAfterImport(bookId: string): Promise<boolean> {
    if (!scrapePick) return true;
    try {
      await applyScrape(bookId, scrapePick.scraped.ref, scrapePick.fields);
      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      return true;
    } catch (e) {
      const what =
        scrapePick.fields.length > 0 ? `写入刮削的${scrapePick.fields.map((f) => lateFieldText[f]).join("、")}` : "记下刮削来源";
      reset();
      setSource(null);
      setScrapePick(null);
      setScrapeFailure({ bookId, what, reason: scrapeFailureReason(e) });
      return false;
    }
  }

  /** 取消刮削：恢复填入前的书名、作者、简介，导入时不写入刮削结果。 */
  function cancelScrape() {
    if (!scrapePick) return;
    setTitle(scrapePick.before.title);
    setAuthor(scrapePick.before.author);
    setIntro(scrapePick.before.intro);
    setScrapePick(null);
  }

  const uploading = uploadStep !== null;

  /** 对比页确认后：书名、作者、简介写进表单；标签与封面记下，导入成功后写入。 */
  const onScrapeApply: ScrapeApply = async (scraped, fields) => {
    const chosen = new Set(fields);
    // 再次刮削时保留最初的表单值，取消时恢复到刮削前。
    const before = scrapePick?.before ?? { title, author, intro };
    if (chosen.has("title") && scraped.title?.trim()) setTitle(scraped.title.trim());
    if (chosen.has("author") && scraped.author?.trim()) setAuthor(scraped.author.trim());
    if (chosen.has("intro") && scraped.intro?.trim()) setIntro(scraped.intro.trim());
    setScrapePick({ scraped, fields: fields.filter((f) => f in lateFieldText), before });
  };
  const scrapeConfigured = !!scrapeStatus.data?.configured;
  const busy = processing || uploading;
  const version = preview?.version;
  const pending = useMemo(
    () => (preview ? countPending(reviewNumbers(preview.version.chapters, preview.options)) : 0) + review.pendingCount,
    [preview, review.pendingCount],
  );
  const suggestion = ai.suggestion;
  const adoptAll = () => {
    if (!suggestion) return;
    if (suggestion.title) setTitle(suggestion.title);
    if (suggestion.author) setAuthor(suggestion.author);
    if (suggestion.intro) setIntro(suggestion.intro);
  };
  const hasNewSuggestion =
    !!suggestion &&
    ((!!suggestion.title && suggestion.title !== title.trim()) ||
      (!!suggestion.author && suggestion.author !== author.trim()) ||
      (!!suggestion.intro && suggestion.intro !== intro.trim()));

  // 导入按钮禁用的全部原因，显示在按钮旁并作为它的描述。
  const blockers = [
    processing && "整理中",
    uploading && "导入中",
    !title.trim() && "填写书名后才能导入",
    pending > 0 && `还有 ${pending} 处章节异常待处理`,
    review.progress && "AI 复核进行中",
    duplicates && "先在下方选择导入方式",
  ].filter((b): b is string => !!b);
  const errorLine = error && <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p>;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← 书库
        </Link>
        <h2 className="font-heading text-xl font-semibold">导入</h2>
      </div>

      <Step n={1} title="原稿">
        <div className="flex flex-col gap-2">
          <Label htmlFor="file">TXT 文件，不超过 100 MB</Label>
          <Input id="file" type="file" accept=".txt,text/plain" disabled={busy} onChange={onFile} />
        </div>
        {processing && <p className="text-sm text-muted-foreground">整理中：{source?.file.name}</p>}
        {!version && errorLine}
        {scrapeFailure && (
          <p className="text-sm text-destructive">
            书已导入，但{scrapeFailure.what}失败：{scrapeFailure.reason}。请到
            <Link to="/books/$bookId" params={{ bookId: scrapeFailure.bookId }} className="underline">
              书详情页
            </Link>
            重新刮削。
          </p>
        )}
      </Step>

      {source && (
        <Step n={2} title="书目信息">
          {(ai.available || scrapeConfigured) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {scrapeConfigured && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setScraping(true)}>
                  刮削
                </Button>
              )}
              {ai.available && (
                <Button size="sm" variant="outline" disabled={busy || ai.pending} onClick={ai.run}>
                  {ai.pending ? "AI 识别中…" : "AI 识别元数据"}
                </Button>
              )}
              {hasNewSuggestion && (
                <Button size="sm" variant="ghost" disabled={uploading} onClick={adoptAll}>
                  全部采用
                </Button>
              )}
              {ai.empty && <span className="text-muted-foreground">AI 没有在原稿开头找到书名、作者或简介。</span>}
              {ai.error && <span className="text-destructive">{ai.error}</span>}
            </div>
          )}
          {scrapePick && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span>
                刮削来源：
                <a className="underline" href={scrapePick.scraped.url} target="_blank" rel="noreferrer">
                  《{scrapePick.scraped.title ?? "（无书名）"}》{platformName(scrapePick.scraped.platform)} · DaoSearch
                </a>
                {scrapePick.fields.length > 0 && `。导入后写入${scrapePick.fields.map((f) => lateFieldText[f]).join("、")}`}
              </span>
              <Button size="sm" variant="ghost" disabled={uploading} onClick={cancelScrape}>
                取消刮削
              </Button>
            </div>
          )}
          {scrapeConfigured && (
            <ScrapeDialog
              target={{ title, author, intro, tags: [], coverUrl: null, ...emptyDescription }}
              onApply={onScrapeApply}
              open={scraping}
              onOpenChange={setScraping}
            />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">书名</Label>
              <Input id="title" value={title} disabled={uploading} onChange={(e) => setTitle(e.target.value)} />
              <SuggestionLine value={suggestion?.title ?? null} current={title} onAdopt={() => suggestion?.title && setTitle(suggestion.title)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="author">作者</Label>
              <Input
                id="author"
                value={author}
                disabled={uploading}
                aria-describedby={author.trim() ? undefined : "author-hint"}
                onChange={(e) => setAuthor(e.target.value)}
              />
              {!author.trim() && (
                <p id="author-hint" className="text-xs text-muted-foreground">
                  没有从文件名或原稿开头识别出作者，可以手动填写{scrapeConfigured || ai.available ? "，或用上方的刮削、AI 识别" : ""}。
                </p>
              )}
              <SuggestionLine value={suggestion?.author ?? null} current={author} onAdopt={() => suggestion?.author && setAuthor(suggestion.author)} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="intro">简介</Label>
              <Textarea id="intro" rows={3} value={intro} disabled={uploading} onChange={(e) => setIntro(e.target.value)} />
              <SuggestionLine value={suggestion?.intro ?? null} current={intro} onAdopt={() => suggestion?.intro && setIntro(suggestion.intro)} />
            </div>
          </div>
        </Step>
      )}

      {options && source && (
        <Step n={3} title="检查章节">
          <OptionsPanel
            key={source.file.name + source.file.lastModified}
            options={options}
            onChange={rerun}
            disabled={uploading}
          />
          {version && (
            <PreviewBrowser
              version={version}
              options={preview.options}
              onChangeOptions={rerun}
              onPatchOptions={patchOptions}
              aiItems={review.items}
              toolbar={<AiReviewToolbar ai={review} disabled={busy} />}
              disabled={busy}
            />
          )}
          {version && errorAt === "process" && errorLine}
        </Step>
      )}

      {version && (
        <>
          <Step n={4} title="确认导入">
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p id="import-status" className="text-muted-foreground">
                {version.chapters.length} 章 · 整理后 {formatBytes(version.text.byteLength)} · 原稿原样保留
                {blockers.length > 0 && <span className="text-destructive"> · {blockers.join(" · ")}</span>}
              </p>
              <Button aria-describedby="import-status" onClick={onSubmit} disabled={blockers.length > 0}>
                导入这本书
              </Button>
            </div>
            {uploadStep && <p className="text-sm text-muted-foreground">{uploadStep}</p>}
            {errorAt === "import" && errorLine}
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
          </Step>
        </>
      )}
    </div>
  );
}

/** 导入流程中的一步。编号表示先后顺序：先检查章节，再填书目信息，最后导入。 */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`import-step-${n}`} className="flex flex-col gap-3">
      <h3 id={`import-step-${n}`} className="font-heading text-base font-semibold">
        <span className="mr-2 text-muted-foreground tabular-nums">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}
