import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChapterItem {
  order: number;
  title: string;
  byteLength: number;
}

/**
 * 左侧章节列表、右侧章节正文。正文由调用方按章节渲染。
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

  // 由外部跳转到某一章时，把它滚动到列表可见范围内。
  useEffect(() => {
    listRef.current?.querySelector(`[data-order="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="grid h-[70svh] grid-cols-[minmax(10rem,16rem)_1fr] overflow-hidden rounded-xl border">
      <ol ref={listRef} className="overflow-y-auto border-r py-2 text-sm">
        {chapters.map((c) => (
          <li key={c.order}>
            <button
              type="button"
              data-order={c.order}
              onClick={() => select(c.order)}
              className={cn(
                "flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted",
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
      <article className="overflow-y-auto p-6">
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

export function ChapterText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap leading-8">{text || <span className="text-muted-foreground">（本章没有正文）</span>}</div>;
}
