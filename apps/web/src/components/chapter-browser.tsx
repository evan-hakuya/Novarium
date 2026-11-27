import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChapterItem {
  order: number;
  title: string;
  byteLength: number;
  /** 所属卷名；没有卷时为 null 或不提供。 */
  volume?: string | null;
  notice: boolean;
}

/** 正文区域自己滚动（宽屏两栏）；窄屏一栏时由页面滚动。 */
const scrollsItself = (el: Element) => getComputedStyle(el).overflowY === "auto";

/**
 * 左侧章节列表、右侧章节正文。正文由调用方按章节渲染。
 * 窄屏（md 以下）只显示一栏：先显示列表，选中章节后显示正文，「← 章节列表」返回。
 * 窄屏正文由页面滚动；列表限高，几百章时不把后面的内容推出页面。
 * 章节有所属卷时，列表按卷分组：卷名行可以展开、收起这一卷的章节，开始时全部展开。
 * 打开或跳转到收起的卷中的章节时，这一卷自动展开。
 * 传入 selected 与 onSelect 时由调用方控制当前章节；flagged 中的章节在列表中标出。
 * revealKey 每变一次（例如从异常面板跳转），就把正文滚入视口并把焦点移到章节标题。
 * 正文中有高亮行（[data-highlight]，见 ChapterText 的 highlight）时，改为滚到并聚焦这一行。
 */
export function ChapterBrowser({
  chapters,
  renderContent,
  selected: controlled,
  onSelect,
  flagged,
  revealKey,
}: {
  chapters: ChapterItem[];
  renderContent: (chapter: ChapterItem) => ReactNode;
  selected?: number;
  onSelect?: (order: number) => void;
  flagged?: ReadonlySet<number>;
  revealKey?: number;
}) {
  const [own, setOwn] = useState(0);
  const selected = controlled ?? own;
  const select = onSelect ?? setOwn;
  const current = chapters[selected];
  // 每章所属卷的第一章下标；没有卷时为 null。卷名可能重复，用第一章下标区分卷。
  const groups = useMemo(() => {
    const starts: (number | null)[] = [];
    chapters.forEach((c, i) => {
      starts.push(!c.volume ? null : c.volume === chapters[i - 1]?.volume ? starts[i - 1]! : i);
    });
    return starts;
  }, [chapters]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  // 换章或外部跳转时展开当前章所在的卷。在渲染中更新，使下面的 effect 滚动列表时这一章已经显示。
  const [opened, setOpened] = useState(`${selected}:${revealKey}`);
  if (opened !== `${selected}:${revealKey}`) {
    setOpened(`${selected}:${revealKey}`);
    const g = groups[selected];
    if (g != null && collapsed.has(g)) setCollapsed(new Set([...collapsed].filter((s) => s !== g)));
  }
  const toggle = (g: number) => setCollapsed((prev) => (prev.has(g) ? new Set([...prev].filter((s) => s !== g)) : new Set(prev).add(g)));
  const listRef = useRef<HTMLOListElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 窄屏当前显示正文还是列表；宽屏两栏都显示，不受它影响。
  const [reading, setReading] = useState(false);
  const shown = useRef({ selected, reading });

  // 换章（含外部跳转）：正文从头开始，列表滚到这一章，窄屏切到正文。首次渲染不滚动，避免页面跳动。
  useEffect(() => {
    if (shown.current.selected === selected) return;
    shown.current.selected = selected;
    listRef.current?.querySelector(`[data-order="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    articleRef.current?.scrollTo({ top: 0 });
    setReading(true);
  }, [selected]);

  // 窄屏切换栏后，把页面滚到正文开头，或滚回列表中的当前章。
  useEffect(() => {
    if (shown.current.reading === reading) return;
    shown.current.reading = reading;
    if (!articleRef.current || scrollsItself(articleRef.current)) return;
    if (reading) articleRef.current?.scrollIntoView({ block: "start" });
    else listRef.current?.querySelector(`[data-order="${selected}"]`)?.scrollIntoView({ block: "center" });
  }, [reading, selected]);

  // 外部跳转：窄屏先切到正文，正文显示后再滚动并聚焦，跳到当前章时也有反馈。
  const reveal = useRef({ seen: revealKey, pending: false });
  useEffect(() => {
    if (revealKey !== reveal.current.seen) {
      reveal.current = { seen: revealKey, pending: true };
      setReading(true);
    }
    if (!reveal.current.pending || !reading) return;
    reveal.current.pending = false;
    const article = articleRef.current;
    if (!article) return;
    const mark = article.querySelector<HTMLElement>("[data-highlight]");
    if (mark) {
      mark.scrollIntoView({ block: "center" });
      mark.focus({ preventScroll: true });
      return;
    }
    // 宽屏正文自己滚动：跳到已选中的章节时 selected 不变，要在这里把正文滚回开头。
    if (scrollsItself(article)) {
      article.scrollTo({ top: 0 });
      rootRef.current?.scrollIntoView({ block: "start" });
    } else article.scrollIntoView({ block: "start" });
    headingRef.current?.focus({ preventScroll: true });
  }, [revealKey, reading]);

  return (
    <div
      ref={rootRef}
      className="scroll-mt-4 rounded-xl border md:grid md:h-[70svh] md:grid-cols-[minmax(10rem,16rem)_1fr] md:overflow-hidden"
    >
      <ol ref={listRef} className={cn("max-h-[60svh] overflow-y-auto py-2 text-sm md:max-h-none md:border-r", reading && "max-md:hidden")}>
        {chapters.map((c, i) => {
          const hidden = groups[i] != null && collapsed.has(groups[i]!);
          if (hidden && groups[i] !== i) return null;
          return (
          <li key={c.order}>
            {groups[i] === i && (
              <VolumeRow
                title={c.volume!}
                count={groups.filter((g) => g === i).length}
                flagged={!!flagged && chapters.some((d, k) => groups[k] === i && flagged.has(d.order))}
                open={!collapsed.has(i)}
                onToggle={() => toggle(i)}
              />
            )}
            {!hidden && (
              <button
                type="button"
                data-order={c.order}
                onClick={() => {
                  select(c.order);
                  setReading(true);
                }}
                className={cn(
                  "flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted pointer-coarse:py-3",
                  c.volume && "pl-8",
                  c.order === selected && "bg-muted font-medium",
                  flagged?.has(c.order) && "text-amber-700 dark:text-amber-400",
                )}
              >
                <span className="truncate">
                  {flagged?.has(c.order) && <span aria-label="序号异常">⚠ </span>}
                  {c.title}
                </span>
                {c.byteLength === 0 && <span className="shrink-0 text-xs text-muted-foreground">空</span>}
                {c.notice && <span className="shrink-0 text-xs text-muted-foreground">作者公告</span>}
              </button>
            )}
          </li>
          );
        })}
      </ol>
      <article
        ref={articleRef}
        data-chapter-scroll
        className={cn("scroll-mt-4 px-4 pt-4 md:overflow-y-auto md:px-6 md:pt-6", !reading && "max-md:hidden")}
      >
        <Button variant="ghost" size="sm" className="-ml-2 mb-2 pointer-coarse:h-11 md:hidden" onClick={() => setReading(false)}>
          ← 章节列表
        </Button>
        {current && (
          <>
            <h2 ref={headingRef} tabIndex={-1} className="mb-4 font-heading text-lg font-semibold outline-none">
              {current.title}
            </h2>
            {renderContent(current)}
          </>
        )}
      </article>
    </div>
  );
}

/** 章节列表中的卷名行：点击展开或收起这一卷的章节。收起时如果卷内有异常章节，仍显示提示。 */
function VolumeRow({ title, count, flagged, open, onToggle }: { title: string; count: number; flagged: boolean; open: boolean; onToggle: () => void }) {
  return (
    <h3>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-1 px-2 pt-3 pb-1.5 text-left text-base font-semibold hover:bg-muted pointer-coarse:py-3",
          flagged && !open && "text-amber-700 dark:text-amber-400",
        )}
      >
        <ChevronRightIcon aria-hidden className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} />
        <span className="truncate">
          {flagged && !open && <span aria-label="含序号异常">⚠ </span>}
          {title}
        </span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{count} 章</span>
      </button>
    </h3>
  );
}

/** 每页显示的大约字数。章节正则没匹配到时，一章可能有整本书那么长，一次渲染会让页面卡住。 */
const PAGE_CHARS = 20_000;

/** 把正文切成页，尽量在换行处断开。返回每页的起始下标。 */
function pageStarts(text: string): number[] {
  const starts = [0];
  while (text.length - starts.at(-1)! > PAGE_CHARS) {
    const from = starts.at(-1)!;
    const cut = text.lastIndexOf("\n", from + PAGE_CHARS);
    starts.push(cut > from ? cut + 1 : from + PAGE_CHARS);
  }
  return starts;
}

/** 在正文中找到去掉首尾空白后等于 line 的那一行，返回它的位置与所在页（starts 见 pageStarts）；找不到时为 null。 */
export function locateLine(text: string, line: string, starts = pageStarts(text)): { start: number; end: number; page: number } | null {
  if (!line) return null;
  for (let at = text.indexOf(line); at >= 0; at = text.indexOf(line, at + 1)) {
    const lineStart = text.lastIndexOf("\n", at) + 1;
    const newline = text.indexOf("\n", at);
    if (text.slice(lineStart, newline < 0 ? text.length : newline).trim() !== line) continue;
    const page = starts.filter((s) => s <= lineStart).length - 1;
    return { start: at, end: at + line.length, page };
  }
  return null;
}

/**
 * 章节正文，分页显示。传入 highlight 时，打开它所在的页并用 <mark data-highlight> 标出这一行；
 * 调用方要在每次跳转时换 key 重新挂载，使初始页指向高亮行。
 */
export function ChapterText({ text, highlight }: { text: string; highlight?: string }) {
  const starts = useMemo(() => pageStarts(text), [text]);
  const hit = useMemo(() => (highlight ? locateLine(text, highlight, starts) : null), [text, highlight, starts]);
  const [page, setPage] = useState(() => hit?.page ?? 0);
  const topRef = useRef<HTMLDivElement>(null);
  // 换章时回到第一页。在渲染中重置，不在 effect 中，否则首次挂载也会把高亮行所在的页改回第一页。
  const [shownText, setShownText] = useState(text);
  if (shownText !== text) {
    setShownText(text);
    setPage(0);
  }

  if (!text) return <div className="pb-6 text-muted-foreground">（本章没有正文）</div>;
  const current = Math.min(page, starts.length - 1);
  const pageStart = starts[current]!;
  const pageEnd = starts[current + 1] ?? text.length;
  const body = text.slice(pageStart, pageEnd);
  const marked = hit && hit.start >= pageStart && hit.end <= pageEnd;
  const pages = starts.length;
  const go = (p: number) => {
    setPage(p);
    // 宽屏正文区域自己滚动；窄屏由页面滚动，滚回正文开头。
    const scroller = topRef.current?.closest("[data-chapter-scroll]");
    if (!scroller) return;
    if (scrollsItself(scroller)) scroller.scrollTo({ top: 0 });
    else scroller.scrollIntoView({ block: "start" });
  };

  return (
    <div ref={topRef}>
      <div className="whitespace-pre-wrap pb-6 leading-8">
        {marked ? (
          <>
            {text.slice(pageStart, hit.start)}
            <mark data-highlight tabIndex={-1} className="rounded-sm bg-amber-200 px-0.5 text-foreground outline-none dark:bg-amber-500/40">
              {text.slice(hit.start, hit.end)}
            </mark>
            {text.slice(hit.end, pageEnd)}
          </>
        ) : (
          body
        )}
      </div>
      {/* 固定在正文区域底部的工具栏，滚动到任何位置都能翻页。 */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-background/95 px-4 py-2 text-sm text-muted-foreground backdrop-blur md:-mx-6 md:px-6">
        <span>本章 {text.length.toLocaleString()} 字</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={current === 0} onClick={() => go(current - 1)}>
              上一页
            </Button>
            <span>
              第 {current + 1} / {pages} 页
            </span>
            <Button size="sm" variant="outline" disabled={current === pages - 1} onClick={() => go(current + 1)}>
              下一页
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
