import { Button } from "@/components/ui/button";
import type { AiReview } from "@/lib/use-ai-review";

/**
 * 章节异常面板右上的 AI 复核操作：复核可疑行（主要）、复核全部（次要）、进度与取消、撤销全部 AI 修正。
 * AI 未开启时不显示。
 */
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
      {ai.unjudgedCount === 0 ? (
        <span className="text-muted-foreground">AI 已复核全部候选行</span>
      ) : (
        <>
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled || !ai.ready}
            title="发送全部还没判断的候选行，包括编号连续、正文正常的章节标题"
            onClick={() => void ai.start("all")}
          >
            复核全部（{ai.unjudgedCount} 行）
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || !ai.ready || ai.unjudgedSuspiciousCount === 0}
            onClick={() => void ai.start("suspicious")}
          >
            {ai.unjudgedSuspiciousCount === 0 ? "可疑行已复核" : `AI 复核可疑行（${ai.unjudgedSuspiciousCount} 行）`}
          </Button>
        </>
      )}
    </div>
  );
}
