import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ProcessOptions } from "@novarium/core";
import { describeError, fetchBook, fetchChapter, formatBytes } from "@/api/books";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { BookMetadataPanel } from "@/components/book-metadata";
import { STEPS } from "@/components/process-options-form";
import { Button } from "@/components/ui/button";
import { isAdvisory, itemKind, reviewNumbers } from "@/lib/number-review";

const route = getRouteApi("/owner/books/$bookId");

export function BookPage() {
  const { bookId } = route.useParams();
  const detail = useQuery({ queryKey: ["books", bookId], queryFn: () => fetchBook(bookId) });

  if (detail.isPending) return <p className="text-sm text-muted-foreground">加载中</p>;
  if (detail.isError) return <p className="text-sm text-destructive">{describeError(detail.error)}</p>;
  const { book, version, chapters } = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← 书库
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold">{book.title}</h2>
          <p className="text-sm text-muted-foreground">
            {book.author || "佚名"} · {chapters.length} 章 · 原稿 {book.originalName}（{formatBytes(book.originalSize)}）
          </p>
          <OptionsSummary options={version.options} />
        </div>
        <Button variant="outline" asChild>
          <Link to="/books/$bookId/reprocess" params={{ bookId }}>
            重新整理
          </Link>
        </Button>
      </div>
      <BookMetadataPanel key={`${book.id}:${book.title}:${book.coverKey}`} book={book} />
      <NumberNotice bookId={bookId} chapters={chapters} options={version.options} />
      <ChapterBrowser chapters={chapters} renderContent={(c) => <RemoteChapter bookId={bookId} order={c.order} />} />
    </div>
  );
}

function RemoteChapter({ bookId, order }: { bookId: string; order: number }) {
  const chapter = useQuery({
    queryKey: ["books", bookId, "chapters", order],
    queryFn: () => fetchChapter(bookId, order),
    staleTime: Infinity,
  });
  if (chapter.isPending) return <p className="text-sm text-muted-foreground">加载中</p>;
  if (chapter.isError) return <p className="text-sm text-destructive">{describeError(chapter.error)}</p>;
  return <ChapterText text={chapter.data.content} />;
}

/** 当前版本中还没忽略的缺号与重复编号。导入时不挡住，这里提醒所有者到重新整理中检查。 */
function NumberNotice({
  bookId,
  chapters,
  options,
}: {
  bookId: string;
  chapters: { order: number; title: string; number: number | null; volume: string | null }[];
  options: Partial<ProcessOptions>;
}) {
  const advisory = reviewNumbers(chapters, { numberIgnores: options.numberIgnores ?? [], numberFixes: options.numberFixes ?? [] }).filter(
    (i) => i.status === "pending" && isAdvisory(i),
  );
  const count = (kind: string) => advisory.filter((i) => itemKind(i) === kind).length;
  const parts = [
    [count("missing"), "缺号"],
    [count("duplicate"), "重复编号"],
    [count("numberTypo"), "序号笔误"],
  ].flatMap(([n, label]) => (n ? [`${n} 处${label}`] : []));
  if (parts.length === 0) return null;
  return (
    <p className="text-sm text-amber-700 dark:text-amber-400">
      当前版本有 {parts.join("、")}未忽略，可能是原稿本身的问题。可以在
      <Link to="/books/$bookId/reprocess" params={{ bookId }} className="underline underline-offset-2">
        重新整理
      </Link>
      中检查或忽略。
    </p>
  );
}

/** 当前版本的整理选项摘要。 */
function OptionsSummary({ options }: { options: Partial<ProcessOptions> }) {
  const steps = STEPS.filter((s) => options[s.key]).map((s) => s.label);
  const parts = [
    `清洗：${steps.join("、") || "无"}`,
    `章节正则：${
      !options.chapterPattern
        ? "内置规则"
        : options.chapterPatternMode === "extend"
          ? `内置规则 + ${options.chapterPattern}`
          : options.chapterPattern
    }`,
    ...(options.numberFixes?.length ? [`修复序号异常 ${options.numberFixes.length} 处`] : []),
    ...(options.numberIgnores?.length ? [`忽略序号异常 ${options.numberIgnores.length} 处`] : []),
    ...(options.lineOverrides?.length ? [`AI 修正 ${options.lineOverrides.length} 处`] : []),
    `过滤词 ${options.filterWords?.length ?? 0} 个（阈值 ${options.filterMaxLineLength || "不限"}）`,
  ];
  return <p className="mt-1 text-xs text-muted-foreground">整理选项 · {parts.join(" · ")}</p>;
}
