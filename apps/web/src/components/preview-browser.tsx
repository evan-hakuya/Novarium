import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProcessOptions } from "@novarium/core";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { NumberReviewPanel } from "@/components/number-review-panel";
import type { AiReviewItem } from "@/lib/ai-review";
import { pendingOrders, reviewNumbers } from "@/lib/number-review";
import { chapterText, type ProcessedVersion } from "@/lib/process";

const NO_AI_ITEMS: AiReviewItem[] = [];

/**
 * 浏览本地整理结果：章节序号异常的处理与章节正文。
 * 修复会改变正文顺序，由调用方重新整理（onChangeOptions）；忽略只改记录（onPatchOptions）。
 */
export function PreviewBrowser({
  version,
  options,
  onChangeOptions,
  onPatchOptions,
  aiItems = NO_AI_ITEMS,
  toolbar,
  disabled,
}: {
  version: ProcessedVersion;
  options: ProcessOptions;
  onChangeOptions: (next: ProcessOptions) => void;
  onPatchOptions: (next: ProcessOptions) => void;
  /** AI 复核结果，与章节序号异常一起显示。 */
  aiItems?: AiReviewItem[];
  toolbar?: ReactNode;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [reveal, setReveal] = useState(0);
  // 最近一次跳转要高亮的行；只在跳转到的那一章显示，换章后不再显示。
  const [target, setTarget] = useState<{ order: number; line?: string }>();
  const items = useMemo(() => [...reviewNumbers(version.chapters, options), ...aiItems], [version.chapters, options, aiItems]);
  const flagged = useMemo(() => pendingOrders(items), [items]);

  // 重新整理后章节可能变少，越界时回到第一章。
  useEffect(() => {
    if (selected >= version.chapters.length) setSelected(0);
  }, [version.chapters.length, selected]);

  return (
    <div className="flex flex-col gap-4">
      <NumberReviewPanel
        items={items}
        chapterTitle={(order) => version.chapters[order]?.title ?? `#${order}`}
        onJump={(order, line) => {
          setSelected(order);
          setTarget({ order, line });
          setReveal((n) => n + 1);
        }}
        options={options}
        onChangeOptions={onChangeOptions}
        onPatchOptions={onPatchOptions}
        toolbar={toolbar}
        disabled={disabled}
      />
      <ChapterBrowser
        chapters={version.chapters}
        selected={selected}
        onSelect={setSelected}
        flagged={flagged}
        revealKey={reveal}
        renderContent={(c) => (
          // 每次跳转换 key 重新挂载，让正文打开高亮行所在的页。
          <ChapterText
            key={`${c.order}:${reveal}`}
            text={chapterText(version.text, version.chapters[c.order]!)}
            highlight={target?.order === c.order ? target.line : undefined}
          />
        )}
      />
    </div>
  );
}
