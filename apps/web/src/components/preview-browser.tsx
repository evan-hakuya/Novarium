import { useEffect, useMemo, useState } from "react";
import type { ProcessOptions } from "@novarium/core";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { NumberReviewPanel } from "@/components/number-review-panel";
import { pendingOrders, reviewNumbers } from "@/lib/number-review";
import { chapterText, type ProcessedVersion } from "@/lib/process";

/**
 * 浏览本地整理结果：章节序号异常的处理与章节正文。
 * 修复会改变正文顺序，由调用方重新整理（onChangeOptions）；忽略只改记录（onPatchOptions）。
 */
export function PreviewBrowser({
  version,
  options,
  onChangeOptions,
  onPatchOptions,
  disabled,
}: {
  version: ProcessedVersion;
  options: ProcessOptions;
  onChangeOptions: (next: ProcessOptions) => void;
  onPatchOptions: (next: ProcessOptions) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const items = useMemo(() => reviewNumbers(version.chapters, options), [version.chapters, options]);
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
        onJump={setSelected}
        options={options}
        onChangeOptions={onChangeOptions}
        onPatchOptions={onPatchOptions}
        disabled={disabled}
      />
      <ChapterBrowser
        chapters={version.chapters}
        selected={selected}
        onSelect={setSelected}
        flagged={flagged}
        renderContent={(c) => <ChapterText text={chapterText(version.text, version.chapters[c.order]!)} />}
      />
    </div>
  );
}
