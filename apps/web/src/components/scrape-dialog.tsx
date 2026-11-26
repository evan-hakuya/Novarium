import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BookDescription } from "@/api/books";
import {
  fetchScrapedBook,
  formatDate,
  formatFacet,
  formatReleased,
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

/** 对比页「现有」一列的值：书详情页取这本书，导入页取导入表单（描述字段为空）。 */
export interface ScrapeTarget extends BookDescription {
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

/** 只读字段：所有者不能编辑，再次刮削时按刮削结果整体替换。 */
const READ_ONLY_FIELDS = new Set<ScrapeField>(["authorEn", "wordCount", "released", "sourceUpdatedAt", "facets", "mature", "sourceUrl", "alsoOn"]);

const matureText = (mature: boolean | null) => (mature === null ? null : mature ? "是" : "否");

function ScrapeCompare({ target, onApply, onDone, scraped, onBack }: FlowProps & { scraped: ScrapedBook; onBack: () => void }) {
  const newAliases = scraped.aliases.filter((a) => !target.aliases.includes(a));
  // 刮削结果里有值的项。
  const scrapedHas: Record<ScrapeField, boolean> = {
    title: !!scraped.title?.trim(),
    author: !!scraped.author?.trim(),
    intro: !!scraped.intro?.trim(),
    tags: scraped.tags.length > 0,
    cover: !!scraped.coverUrl,
    genre: !!scraped.genre?.trim(),
    subgenre: !!scraped.subgenre?.trim(),
    status: !!scraped.status,
    aliases: scraped.aliases.length > 0,
    authorEn: !!scraped.authorEn?.trim(),
    wordCount: scraped.wordCount !== null,
    released: !!scraped.released,
    sourceUpdatedAt: !!scraped.sourceUpdatedAt,
    facets: scraped.facets.length > 0,
    mature: scraped.mature !== null,
    sourceUrl: !!scraped.sourceUrl,
    alsoOn: scraped.alsoOn.length > 0,
  };
  const empty: Record<ScrapeField, boolean> = {
    title: !target.title.trim(),
    author: !target.author.trim(),
    intro: !target.intro.trim(),
    tags: target.tags.length === 0,
    cover: !target.coverUrl,
    genre: !target.genre,
    subgenre: !target.subgenre,
    status: !target.serialStatus,
    aliases: target.aliases.length === 0,
    authorEn: !target.authorEn,
    wordCount: target.sourceWordCount === null,
    released: !target.released,
    sourceUpdatedAt: !target.sourceUpdatedAt,
    facets: !target.facets?.length,
    mature: target.mature === null,
    sourceUrl: !target.sourceUrl,
    alsoOn: !target.alsoOn?.length,
  };
  // 只读字段勾选后按刮削结果替换：刮削结果为空而现有值不为空时，也可以勾选，用来清空源站已删除的值。
  const available = Object.fromEntries(
    (Object.keys(scrapedHas) as ScrapeField[]).map((f) => [f, scrapedHas[f] || (READ_ONLY_FIELDS.has(f) && !empty[f])]),
  ) as Record<ScrapeField, boolean>;
  // 刮削结果有值、现有值为空的项默认勾选。
  const [chosen, setChosen] = useState<Set<ScrapeField>>(
    () => new Set((Object.keys(scrapedHas) as ScrapeField[]).filter((f) => scrapedHas[f] && empty[f])),
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
    { field: "genre", label: "分类", current: target.genre, next: scraped.genre },
    { field: "subgenre", label: "子分类", current: target.subgenre, next: scraped.subgenre },
    {
      field: "status",
      label: "连载状态",
      current: target.serialStatus && statusText[target.serialStatus],
      next: scraped.status && statusText[scraped.status],
    },
    {
      field: "aliases",
      label: "别名",
      current: target.aliases.join("、"),
      next: newAliases.length > 0 ? `合并：${newAliases.join("、")}` : "没有新别名",
    },
    { field: "authorEn", label: "作者英文名", current: target.authorEn, next: scraped.authorEn },
    { field: "wordCount", label: "源站字数", current: formatWordCount(target.sourceWordCount), next: formatWordCount(scraped.wordCount) },
    { field: "released", label: "首发日期", current: formatReleased(target.released), next: formatReleased(scraped.released) },
    { field: "sourceUpdatedAt", label: "源站更新", current: formatDate(target.sourceUpdatedAt), next: formatDate(scraped.sourceUpdatedAt) },
    {
      field: "facets",
      label: "平台标记",
      current: target.facets?.map(formatFacet).join("、"),
      next: scraped.facets.map(formatFacet).join("、"),
    },
    { field: "mature", label: "成人向", current: matureText(target.mature), next: matureText(scraped.mature) },
    {
      field: "sourceUrl",
      label: "源站链接",
      current: <span className="break-all">{target.sourceUrl}</span>,
      next: <span className="break-all">{scraped.sourceUrl}</span>,
    },
    {
      field: "alsoOn",
      label: "其他平台",
      current: target.alsoOn?.map((e) => platformName(e.platform)).join("、"),
      next: scraped.alsoOn.map((e) => platformName(e.platform)).join("、"),
    },
  ];

  return (
    <>
      <DialogTitle>对比并写入</DialogTitle>
      <DialogDescription>
        勾选要写入的项。标签与别名合并进现有的值，不删除已有的。来源：
        <a className="underline" href={scraped.url} target="_blank" rel="noreferrer">
          {platformName(scraped.platform)} · DaoSearch
        </a>
      </DialogDescription>
      <div className="grid max-h-[60vh] grid-cols-[auto_auto_1fr_1fr] items-start gap-x-3 gap-y-3 overflow-y-auto text-sm">
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
            <div className="min-w-0 break-words">
              {scrapedHas[row.field] ? row.next : <span className="text-muted-foreground">{available[row.field] ? "（清空）" : "（无）"}</span>}
            </div>
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
