import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChapterItem {
  order: number;
  title: string;
  byteLength: number;
  /** 所属卷名；没有卷时为 null 或不提供。 */
  volume?: string | null;
}

/** 正文区域自己滚动（宽屏两栏）；窄屏一栏时由页面滚动。 */
const scrollsItself = (el: Element) => getComputedStyle(el).overflowY === "auto";

/**
 * 左侧章节列表、右侧章节正文。正文由调用方按章节渲染。
 * 窄屏（md 以下）只显示一栏：先显示列表，选中章节后显示正文，「← 章节列表」返回。
 * 窄屏正文由页面滚动；列表限高，几百章时不把后面的内容推出页面。
 * 章节有所属卷时，列表在每卷第一章前显示不可点击的卷名。
 * 传入 selected 与 onSelect 时由调用方控制当前章节；flagged 中的章节在列表中标出。
 */
export function ChapterBrowser({
  chapters,
  renderContent,
  selected: controlled,
  onSelect,
  flagged,
}: {
  chapters: ChapterItem[];
  renderContent: (chapter: ChapterItem) => ReactNode;
  selected?: number;
  onSelect?: (order: number) => void;
  flagged?: ReadonlySet<number>;
}) {
  const [own, setOwn] = useState(0);
  const selected = controlled ?? own;
  const select = onSelect ?? setOwn;
  const current = chapters[selected];
  const listRef = useRef<HTMLOListElement>(null);
  const articleRef = useRef<HTMLElement>(null);
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

  return (
    <div className="rounded-xl border md:grid md:h-[70svh] md:grid-cols-[minmax(10rem,16rem)_1fr] md:overflow-hidden">
      <ol ref={listRef} className={cn("max-h-[60svh] overflow-y-auto py-2 text-sm md:max-h-none md:border-r", reading && "max-md:hidden")}>
        {chapters.map((c, i) => (
          <li key={c.order}>
            {c.volume && c.volume !== chapters[i - 1]?.volume && (
              <div
                role="heading"
                aria-level={3}
                className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground"
              >
                {c.volume}
              </div>
            )}
            <button
              type="button"
              data-order={c.order}
              onClick={() => {
                select(c.order);
                setReading(true);
              }}
              className={cn(
                "flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted pointer-coarse:py-3",
                c.order === selected && "bg-muted font-medium",
                flagged?.has(c.order) && "text-amber-700 dark:text-amber-400",
              )}
            >
              <span className="truncate">
                {flagged?.has(c.order) && <span aria-label="序号异常">⚠ </span>}
                {c.title}
              </span>
              {c.byteLength === 0 && <span className="shrink-0 text-xs text-muted-foreground">空</span>}
            </button>
          </li>
        ))}
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
            <h2 className="mb-4 font-heading text-lg font-semibold">{current.title}</h2>
            {renderContent(current)}
          </>
        )}
      </article>
    </div>
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

export function ChapterText({ text }: { text: string }) {
  const starts = useMemo(() => pageStarts(text), [text]);
  const [page, setPage] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPage(0), [text]);

  if (!text) return <div className="pb-6 text-muted-foreground">（本章没有正文）</div>;
  const current = Math.min(page, starts.length - 1);
  const body = text.slice(starts[current], starts[current + 1] ?? text.length);
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
      <div className="whitespace-pre-wrap pb-6 leading-8">{body}</div>
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
