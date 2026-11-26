import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { booksQueryKey, coverUrl, type BookDetail } from "@/api/books";
import {
  applyScrape,
  formatWordCount,
  platformName,
  scrapeFailureReason,
  searchScrape,
  statusText,
  type ScrapedBook,
  type ScrapeField,
} from "@/api/scrape";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Book = BookDetail["book"];

/** 刮削对话框（ADR 0006）：搜索 DaoSearch，选定作品，逐项勾选后写入。 */
export function ScrapeDialog({ book, open, onOpenChange }: { book: Book; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* 每次打开都从搜索开始。 */}
        {open && <ScrapeFlow book={book} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ScrapeFlow({ book, onDone }: { book: Book; onDone: () => void }) {
  const [query, setQuery] = useState(book.title);
  const [picked, setPicked] = useState<ScrapedBook | null>(null);
  const search = useMutation({ mutationFn: (q: string) => searchScrape(book.id, q) });

  if (picked) return <ScrapeCompare book={book} scraped={picked} onBack={() => setPicked(null)} onDone={onDone} />;

  return (
    <>
      <DialogTitle>刮削</DialogTitle>
      <DialogDescription>在 DaoSearch 搜索这本书。可以输入书名、作者，或粘贴 DaoSearch 与源站的书页链接。每次搜索约消耗 15 点。</DialogDescription>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search.mutate(query.trim());
        }}
      >
        <Input aria-label="搜索关键词" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" disabled={search.isPending || !query.trim()}>
          {search.isPending ? "搜索中…" : "搜索"}
        </Button>
      </form>
      {search.isError && <p className="text-sm text-destructive">{scrapeFailureReason(search.error)}</p>}
      {search.data?.length === 0 && <p className="text-sm text-muted-foreground">没有找到结果。换个关键词，或粘贴书页链接试试。</p>}
      {search.data && search.data.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {search.data.map((result) => (
            <li key={result.ref}>
              <button type="button" className="flex w-full gap-3 p-3 text-left hover:bg-muted" onClick={() => setPicked(result)}>
                <RemoteCover url={result.coverUrl} title={result.title} />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{result.title ?? "（无书名）"}</span>
                  <span className="text-sm text-muted-foreground">
                    {result.author ?? "佚名"}
                    {book.author.trim() && result.author?.trim() === book.author.trim() && (
                      <Badge variant="secondary" className="ml-2">
                        作者一致
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      platformName(result.platform),
                      formatWordCount(result.wordCount),
                      result.status && statusText[result.status],
                      result.releasedAt && `首发 ${result.releasedAt}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** 刮削源的封面直接从刮削源加载，不发送来源页地址。 */
function RemoteCover({ url, title, className = "h-20 w-14" }: { url: string | null; title: string | null; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded border bg-muted ${className}`}>
      {url ? (
        <img src={url} alt={`${title ?? ""} 封面`} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">无封面</span>
      )}
    </div>
  );
}

function ScrapeCompare({ book, scraped, onBack, onDone }: { book: Book; scraped: ScrapedBook; onBack: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const available: Record<ScrapeField, boolean> = {
    title: !!scraped.title?.trim(),
    author: !!scraped.author?.trim(),
    intro: !!scraped.intro?.trim(),
    tags: scraped.tags.length > 0,
    cover: !!scraped.coverUrl,
  };
  const empty: Record<ScrapeField, boolean> = {
    title: !book.title.trim(),
    author: !book.author.trim(),
    intro: !book.intro.trim(),
    tags: book.tags.length === 0,
    cover: !book.coverKey,
  };
  // 现有值为空的项默认勾选。
  const [chosen, setChosen] = useState<Set<ScrapeField>>(
    () => new Set((Object.keys(available) as ScrapeField[]).filter((f) => available[f] && empty[f])),
  );
  const apply = useMutation({
    mutationFn: () => applyScrape(book.id, scraped.ref, [...chosen]),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: booksQueryKey });
      onDone();
    },
  });
  const toggle = (field: ScrapeField, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  const newTags = scraped.tags.filter((t) => !book.tags.includes(t));
  const ownCover = coverUrl(book);

  const rows: { field: ScrapeField; label: string; current: ReactNode; next: ReactNode }[] = [
    { field: "title", label: "书名", current: book.title, next: scraped.title },
    { field: "author", label: "作者", current: book.author, next: scraped.author },
    {
      field: "intro",
      label: "简介",
      current: <span className="line-clamp-6 whitespace-pre-wrap">{book.intro}</span>,
      next: <span className="line-clamp-6 whitespace-pre-wrap">{scraped.intro}</span>,
    },
    {
      field: "tags",
      label: "标签",
      current: book.tags.join("、"),
      next: newTags.length > 0 ? `合并：${newTags.join("、")}` : scraped.tags.length > 0 ? "没有新标签" : null,
    },
    {
      field: "cover",
      label: "封面",
      current: ownCover ? <img src={ownCover} alt="现有封面" className="h-24 w-16 rounded border object-cover" /> : null,
      next: scraped.coverUrl ? <RemoteCover url={scraped.coverUrl} title={scraped.title} className="h-24 w-16" /> : null,
    },
  ];

  return (
    <>
      <DialogTitle>对比并写入</DialogTitle>
      <DialogDescription>
        勾选要写入的项。标签合并进现有标签，不删除已有标签。来源：
        <a className="underline" href={scraped.url} target="_blank" rel="noreferrer">
          {platformName(scraped.platform)} · DaoSearch
        </a>
      </DialogDescription>
      <div className="grid grid-cols-[auto_3rem_1fr_1fr] items-start gap-x-3 gap-y-3 text-sm">
        <span />
        <span />
        <span className="text-xs text-muted-foreground">现有</span>
        <span className="text-xs text-muted-foreground">刮削</span>
        {rows.map((row) => (
          <div key={row.field} className="contents">
            <Checkbox
              id={`scrape-${row.field}`}
              checked={chosen.has(row.field)}
              disabled={!available[row.field] || apply.isPending}
              onCheckedChange={(c) => toggle(row.field, c === true)}
            />
            <label htmlFor={`scrape-${row.field}`} className="font-medium">
              {row.label}
            </label>
            <div className="min-w-0 break-words text-muted-foreground">{empty[row.field] ? "（空）" : row.current}</div>
            <div className="min-w-0 break-words">{available[row.field] ? row.next : <span className="text-muted-foreground">（无）</span>}</div>
          </div>
        ))}
      </div>
      {apply.isError && <p className="text-sm text-destructive">{scrapeFailureReason(apply.error)}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={apply.isPending} onClick={onBack}>
          返回结果
        </Button>
        <Button disabled={apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? "写入中…" : chosen.size > 0 ? `写入 ${chosen.size} 项` : "只记下来源"}
        </Button>
      </div>
    </>
  );
}
