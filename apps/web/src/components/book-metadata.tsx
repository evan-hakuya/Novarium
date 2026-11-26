import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  booksQueryKey,
  coverUrl,
  deleteBook,
  describeError,
  MAX_COVER_BYTES,
  removeCover,
  updateBook,
  uploadCover,
  type BookDetail,
  type BookMetadata,
} from "@/api/books";
import { fetchScrapeStatus, scrapeStatusQueryKey } from "@/api/scrape";
import { ScrapeDialog } from "@/components/scrape-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Book = BookDetail["book"];

/** 封面图；没有封面时显示书名占位。 */
export function BookCover({ book, className }: { book: { id: string; title: string; coverKey: string | null }; className?: string }) {
  const src = coverUrl(book);
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted ${className ?? ""}`}>
      {src ? (
        <img src={src} alt={`${book.title} 封面`} className="h-full w-full object-cover" />
      ) : (
        <span className="line-clamp-3 px-2 text-center text-xs text-muted-foreground">{book.title}</span>
      )}
    </div>
  );
}

/** 书的元数据：查看、编辑书名、作者、简介、标签与封面，以及删除书。 */
export function BookMetadataPanel({ book }: { book: Book }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BookMetadata>(() => pick(book));
  const [tagInput, setTagInput] = useState("");
  const [scraping, setScraping] = useState(false);
  // 没有填写刮削源密钥时不显示刮削入口。
  const scrapeStatus = useQuery({ queryKey: scrapeStatusQueryKey, queryFn: fetchScrapeStatus, staleTime: 60_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: booksQueryKey });

  const save = useMutation({
    mutationFn: (m: BookMetadata) => updateBook(book.id, m),
    onSuccess: async () => {
      await refresh();
      setEditing(false);
    },
  });
  const cover = useMutation({ mutationFn: (file: File) => uploadCover(book.id, file), onSuccess: refresh });
  const uncover = useMutation({ mutationFn: () => removeCover(book.id), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: () => deleteBook(book.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["books", book.id] });
      await refresh();
      await navigate({ to: "/" });
    },
  });
  const error = [save, cover, uncover, remove].find((m) => m.isError)?.error;

  function addTag() {
    const tag = tagInput.trim();
    if (tag && !draft.tags.includes(tag)) setDraft({ ...draft, tags: [...draft.tags, tag] });
    setTagInput("");
  }
  function onTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagInput && draft.tags.length > 0) {
      setDraft({ ...draft, tags: draft.tags.slice(0, -1) });
    }
  }
  function onCoverFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) {
      cover.reset();
      window.alert("封面不能超过 5 MB。");
      return;
    }
    cover.mutate(file);
  }
  function onDelete() {
    const ok = window.confirm(`删除《${book.title}》？原稿、正文、封面与章节都会被删除，不能恢复。阅读客户端将读不到这本书。`);
    if (ok) remove.mutate();
  }

  const busy = save.isPending || cover.isPending || uncover.isPending || remove.isPending;

  return (
    <section className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row">
      <div className="flex flex-col items-center gap-2">
        <BookCover book={book} className="h-40 w-28" />
        <label className="cursor-pointer text-xs text-primary hover:underline">
          {book.coverKey ? "更换封面" : "上传封面"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              onCoverFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {book.coverKey && (
          <button type="button" className="text-xs text-muted-foreground hover:underline" disabled={busy} onClick={() => uncover.mutate()}>
            移除封面
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {editing ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="meta-title">书名</Label>
                <Input id="meta-title" value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="meta-author">作者</Label>
                <Input id="meta-author" value={draft.author} maxLength={100} onChange={(e) => setDraft({ ...draft, author: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-intro">简介</Label>
              <Textarea id="meta-intro" rows={4} maxLength={5000} value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meta-tags">标签</Label>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
                {draft.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      aria-label={`移除标签 ${tag}`}
                      onClick={() => setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) })}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
                <input
                  id="meta-tags"
                  className="min-w-24 flex-1 bg-transparent text-sm outline-none"
                  value={tagInput}
                  maxLength={20}
                  placeholder={draft.tags.length ? "" : "输入后按回车添加"}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={onTagKey}
                  onBlur={addTag}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                最多 20 个，每个不超过 20 字。阅读客户端把标签显示为分类，发现页按标签列出书；新增标签后重新导入书源才会出现新的入口。
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !draft.title.trim()} onClick={() => save.mutate(draft)}>
                {save.isPending ? "保存中…" : "保存"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(pick(book));
                  setEditing(false);
                }}
              >
                取消
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {book.tags.length > 0 ? (
                book.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">没有标签</span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{book.intro || "没有简介。"}</p>
            {book.scrapeUrl && (
              <p className="text-xs text-muted-foreground">
                资料来源：
                <a className="underline" href={book.scrapeUrl} target="_blank" rel="noreferrer">
                  DaoSearch
                </a>
                {book.scrapedAt && `（${new Date(book.scrapedAt).toLocaleDateString("zh-CN")} 刮削）`}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(pick(book));
                  setEditing(true);
                }}
              >
                编辑信息
              </Button>
              {scrapeStatus.data?.configured && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setScraping(true)}>
                  刮削
                </Button>
              )}
              <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
                {remove.isPending ? "删除中…" : "删除这本书"}
              </Button>
            </div>
          </>
        )}
        {error && <p className="text-sm text-destructive">{describeError(error)}</p>}
      </div>
      <ScrapeDialog book={book} open={scraping} onOpenChange={setScraping} />
    </section>
  );
}

const pick = (book: Book): BookMetadata => ({ title: book.title, author: book.author, intro: book.intro, tags: book.tags });
