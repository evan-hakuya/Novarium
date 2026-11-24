import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { describeError, fetchBook, fetchChapter, formatBytes } from "@/api/books";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";

const route = getRouteApi("/owner/books/$bookId");

export function BookPage() {
  const { bookId } = route.useParams();
  const detail = useQuery({ queryKey: ["books", bookId], queryFn: () => fetchBook(bookId) });

  if (detail.isPending) return <p className="text-sm text-muted-foreground">加载中</p>;
  if (detail.isError) return <p className="text-sm text-destructive">{describeError(detail.error)}</p>;
  const { book, chapters } = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← 书库
      </Link>
      <div>
        <h2 className="font-heading text-xl font-semibold">{book.title}</h2>
        <p className="text-sm text-muted-foreground">
          {book.author || "佚名"} · {chapters.length} 章 · 原稿 {book.originalName}（{formatBytes(book.originalSize)}）
        </p>
      </div>
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
