import { Button } from "@/components/ui/button";
import type { AiReview } from "@/lib/use-ai-review";

/** 章节异常面板右上的 AI 复核操作：开始、进度与取消、撤销全部 AI 修正。AI 未开启时不显示。 */
export function AiReviewToolbar({ ai, disabled }: { ai: AiReview; disabled?: boolean }) {
  if (!ai.available) return null;
  if (ai.progress) {
    const percent = Math.round((ai.progress.done / ai.progress.total) * 100);
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        AI 复核中 {ai.progress.done}/{ai.progress.total}
        <Button size="xs" variant="outline" onClick={ai.cancel}>
          取消
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
      {ai.error && <span className="text-destructive">{ai.error}</span>}
      {ai.fixedCount > 0 && (
        <Button size="xs" variant="ghost" disabled={disabled} onClick={ai.undoAll}>
          撤销全部 AI 修正
        </Button>
      )}
      <Button size="xs" variant="outline" disabled={disabled || !ai.ready || ai.unjudgedCount === 0} onClick={() => void ai.start()}>
        {ai.unjudgedCount === 0 ? "AI 已复核全部候选行" : `AI 复核章节（${ai.unjudgedCount} 行未判断）`}
      </Button>
    </div>
  );
}
