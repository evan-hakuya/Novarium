import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchScrapedBook,
  formatWordCount,
  platformName,
  SCRAPE_STALE_MS,
  scrapeBookQueryKey,
  scrapeFailureReason,
  scrapeSearchQueryKey,
  searchScrape,
  statusText,
  type ScrapeCandidate,
  type ScrapedBook,
  type ScrapeField,
} from "@/api/scrape";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 对比页「现有」一列的值：书详情页取这本书，导入页取导入表单。 */
export interface ScrapeTarget {
  title: string;
  author: string;
  intro: string;
  tags: string[];
  /** 现有封面的地址；没有封面时为 null。 */
  coverUrl: string | null;
}

/** 所有者在对比页确认后调用，写入勾选的字段。抛出的错误显示在对比页。 */
export type ScrapeApply = (scraped: ScrapedBook, fields: ScrapeField[]) => Promise<void>;

interface FlowProps {
  target: ScrapeTarget;
  onApply: ScrapeApply;
  onDone: () => void;
}

/** 刮削对话框（ADR 0006）：搜索 DaoSearch，选定作品，逐项勾选后交给 onApply。 */
export function ScrapeDialog({
  target,
  onApply,
  open,
  onOpenChange,
}: Omit<FlowProps, "onDone"> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* 每次打开都从搜索开始。 */}
        {open && <ScrapeFlow target={target} onApply={onApply} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ScrapeFlow({ target, onApply, onDone }: FlowProps) {
  const [query, setQuery] = useState(target.title);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [picked, setPicked] = useState<ScrapeCandidate | null>(null);
  const search = useQuery({
    queryKey: scrapeSearchQueryKey(submitted ?? "", target.author.trim()),
    queryFn: () => searchScrape(submitted!, target.author.trim()),
    enabled: submitted !== null,
    staleTime: SCRAPE_STALE_MS,
    gcTime: SCRAPE_STALE_MS,
    retry: false,
  });

  if (picked) return <ScrapeDetail target={target} onApply={onApply} candidate={picked} onBack={() => setPicked(null)} onDone={onDone} />;
  const searching = search.isFetching;

  return (
    <>
      <DialogTitle>刮削</DialogTitle>
      <DialogDescription>
        在 DaoSearch 搜索这本书。可以输入书名、作者，或粘贴 DaoSearch 与源站的书页链接。搜索消耗 5 点，查看详情消耗 1 点，6 小时内重复的请求不消耗点数。
      </DialogDescription>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          if (!q) return;
          // 同一关键词失败后再次提交时重新请求。
          if (q === submitted && search.isError) void search.refetch();
          else setSubmitted(q);
        }}
      >
        <Input aria-label="搜索关键词" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" disabled={searching || !query.trim()}>
          {searching ? "搜索中…" : "搜索"}
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
                    {target.author.trim() && result.author?.trim() === target.author.trim() && (
                      <Badge variant="secondary" className="ml-2">
                        作者一致
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {platformName(result.platform)}
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

/** 点击候选后才读取详情（每本 1 点），读完进入对比页。 */
function ScrapeDetail({ candidate, onBack, ...props }: FlowProps & { candidate: ScrapeCandidate; onBack: () => void }) {
  const detail = useQuery({
    queryKey: scrapeBookQueryKey(candidate.ref),
    queryFn: () => fetchScrapedBook(candidate.ref),
    staleTime: SCRAPE_STALE_MS,
    gcTime: SCRAPE_STALE_MS,
    retry: false,
  });
  if (detail.data) return <ScrapeCompare {...props} scraped={detail.data} onBack={onBack} />;
  return (
    <>
      <DialogTitle>{candidate.title ?? "（无书名）"}</DialogTitle>
      <DialogDescription>{detail.isError ? scrapeFailureReason(detail.error) : "读取详情中…"}</DialogDescription>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onBack}>
          返回结果
        </Button>
      </div>
    </>
  );
}

function ScrapeCompare({ target, onApply, onDone, scraped, onBack }: FlowProps & { scraped: ScrapedBook; onBack: () => void }) {
  const available: Record<ScrapeField, boolean> = {
    title: !!scraped.title?.trim(),
    author: !!scraped.author?.trim(),
    intro: !!scraped.intro?.trim(),
    tags: scraped.tags.length > 0,
    cover: !!scraped.coverUrl,
  };
  const empty: Record<ScrapeField, boolean> = {
    title: !target.title.trim(),
    author: !target.author.trim(),
    intro: !target.intro.trim(),
    tags: target.tags.length === 0,
    cover: !target.coverUrl,
  };
  // 现有值为空的项默认勾选。
  const [chosen, setChosen] = useState<Set<ScrapeField>>(
    () => new Set((Object.keys(available) as ScrapeField[]).filter((f) => available[f] && empty[f])),
  );
  const apply = useMutation({
    mutationFn: () => onApply(scraped, [...chosen]),
    onSuccess: onDone,
  });
  const toggle = (field: ScrapeField, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  const newTags = scraped.tags.filter((t) => !target.tags.includes(t));
  const ownCover = target.coverUrl;

  const rows: { field: ScrapeField; label: string; current: ReactNode; next: ReactNode }[] = [
    { field: "title", label: "书名", current: target.title, next: scraped.title },
    { field: "author", label: "作者", current: target.author, next: scraped.author },
    {
      field: "intro",
      label: "简介",
      current: <span className="line-clamp-6 whitespace-pre-wrap">{target.intro}</span>,
      next: <span className="line-clamp-6 whitespace-pre-wrap">{scraped.intro}</span>,
    },
    {
      field: "tags",
      label: "标签",
      current: target.tags.join("、"),
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
        {[formatWordCount(scraped.wordCount), scraped.status && statusText[scraped.status], scraped.releasedAt && `首发 ${scraped.releasedAt}`]
          .filter(Boolean)
          .map((text) => ` · ${text}`)
          .join("")}
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
