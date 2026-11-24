import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChapterItem {
  order: number;
  title: string;
  byteLength: number;
}

/** 左侧章节列表、右侧章节正文。正文由调用方按章节渲染。 */
export function ChapterBrowser({
  chapters,
  renderContent,
}: {
  chapters: ChapterItem[];
  renderContent: (chapter: ChapterItem) => ReactNode;
}) {
  const [selected, setSelected] = useState(0);
  const current = chapters[selected];

  return (
    <div className="grid h-[70svh] grid-cols-[minmax(10rem,16rem)_1fr] overflow-hidden rounded-xl border">
      <ol className="overflow-y-auto border-r py-2 text-sm">
        {chapters.map((c) => (
          <li key={c.order}>
            <button
              type="button"
              onClick={() => setSelected(c.order)}
              className={cn(
                "flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-muted",
                c.order === selected && "bg-muted font-medium",
              )}
            >
              <span className="truncate">{c.title}</span>
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
