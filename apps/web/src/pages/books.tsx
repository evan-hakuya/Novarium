import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { booksQueryKey, describeError, fetchBooks, formatBytes } from "@/api/books";
import { fetchHealth } from "@/api/health";
import { BookCover } from "@/components/book-metadata";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function BooksPage() {
  const books = useQuery({ queryKey: booksQueryKey, queryFn: fetchBooks });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-semibold">书库</h2>
        <Button asChild>
          <Link to="/import">导入</Link>
        </Button>
      </div>
      {books.isError && <p className="text-sm text-destructive">{describeError(books.error)}</p>}
      {books.data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>书库还是空的</CardTitle>
            <CardDescription>点「导入」上传第一本 TXT。</CardDescription>
          </CardHeader>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {books.data?.map((book) => (
          <li key={book.id}>
            <Link to="/books/$bookId" params={{ bookId: book.id }}>
              <Card className="transition-colors hover:bg-muted/50">
                <div className="flex items-start gap-4 px-6">
                  <BookCover book={book} className="h-20 w-14" />
                  <div className="flex min-w-0 flex-col gap-2">
                    <CardHeader className="px-0">
                      <CardTitle>{book.title}</CardTitle>
                      <CardDescription>{book.author || "佚名"}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-0 text-sm text-muted-foreground">
                      {book.chapterCount} 章 · {formatBytes(book.textSize)}
                    </CardContent>
                  </div>
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <HealthFooter />
    </div>
  );
}

function HealthFooter() {
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  return (
    <footer className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      服务状态
      {health.isPending && <Badge variant="outline">检查中</Badge>}
      {health.isError && <Badge variant="destructive">无法连接</Badge>}
      {health.data && (
        <>
          <Badge variant={health.data.ok ? "outline" : "destructive"}>{health.data.ok ? "正常" : "异常"}</Badge>
          <span>{health.data.runtime}</span>
        </>
      )}
    </footer>
  );
}
