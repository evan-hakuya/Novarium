import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ProcessOptions } from "@novarium/core";
import { describeError, fetchBook, fetchChapter, formatBytes } from "@/api/books";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { BookMetadataPanel } from "@/components/book-metadata";
import { STEPS } from "@/components/process-options-form";
import { Button } from "@/components/ui/button";

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
