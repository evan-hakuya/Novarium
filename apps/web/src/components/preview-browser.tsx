import { useEffect, useMemo, useState, type ReactNode } from "react";
import { findNumberAnomalies, type NumberAnomaly, type ProcessOptions } from "@novarium/core";
import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { Button } from "@/components/ui/button";
import { chapterText, type ProcessedVersion } from "@/lib/process";

/** 列表中最多显示的异常条数，其余只计数。 */
const MAX_LISTED = 50;

/**
 * 浏览本地整理结果：章节序号检查与章节正文。
 * 「按序号重排」只改整理选项，由调用方重新整理；系统不自动重排。
 */
export function PreviewBrowser({
  version,
  options,
  onChangeOptions,
  disabled,
}: {
  version: ProcessedVersion;
  options: ProcessOptions;
  onChangeOptions: (next: ProcessOptions) => void;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const findings = useMemo(() => findNumberAnomalies(version.chapters), [version.chapters]);
  const sectionResets = useMemo(() => findings.filter((a) => a.kind === "sectionReset"), [findings]);
  const anomalies = useMemo(() => findings.filter((a) => a.kind !== "sectionReset"), [findings]);
  const flagged = useMemo(() => new Set(findings.flatMap(anomalyOrders)), [findings]);

  // 重新整理后章节可能变少，越界时回到第一章。
  useEffect(() => {
    if (selected >= version.chapters.length) setSelected(0);
  }, [version.chapters.length, selected]);

  const jump = (order: number) => (
    <button
      type="button"
      className="underline underline-offset-2 hover:text-foreground"
      onClick={() => setSelected(order)}
    >
      {version.chapters[order]?.title ?? `#${order}`}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">
            章节序号：{anomalies.length === 0 ? "没有发现异常" : `发现 ${anomalies.length} 处异常`}
            {sectionResets.length > 0 && `，${sectionResets.length} 个分卷边界候选`}
            {options.reorderByNumber && "（已按序号重排）"}
          </span>
          {options.reorderByNumber ? (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => onChangeOptions({ ...options, reorderByNumber: false })}
            >
              恢复原顺序
            </Button>
          ) : (
            anomalies.some((a) => a.kind === "outOfOrder") && (
              <Button size="sm" disabled={disabled} onClick={() => onChangeOptions({ ...options, reorderByNumber: true })}>
                按序号重排
              </Button>
            )
          )}
        </div>
        {findings.length > 0 && (
          <>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-muted-foreground">
              {findings.slice(0, MAX_LISTED).map((a, i) => (
                <li key={i}>
                  <AnomalyText anomaly={a} jump={jump} />
                </li>
              ))}
              {findings.length > MAX_LISTED && <li>另有 {findings.length - MAX_LISTED} 处未列出。</li>}
            </ul>
            <p className="text-xs text-muted-foreground">
              序号从较大值重置到第一章时，系统标记为分卷边界候选。候选已经自动用于分卷内检查，无需额外点击确认。按序号重排只处理分卷内部的乱序。
            </p>
          </>
        )}
      </section>
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

function anomalyOrders(a: NumberAnomaly): number[] {
  if (a.kind === "sectionReset") return [a.order];
  if (a.kind === "missing") return [a.after];
  if (a.kind === "duplicate") return a.orders;
  return [a.order];
}

function AnomalyText({ anomaly: a, jump }: { anomaly: NumberAnomaly; jump: (order: number) => ReactNode }) {
  if (a.kind === "sectionReset") return <>分卷边界候选：{jump(a.order)}（序号从第 {a.previous} 章重置为第 1 章）</>;
  if (a.kind === "missing") {
    const range = a.from === a.to ? `${a.from}` : `${a.from}–${a.to}`;
    return (
      <>
        缺号：缺少第 {range} 章，位于 {jump(a.after)} 之后
      </>
    );
  }
  if (a.kind === "duplicate") {
    return (
      <>
        重复编号：第 {a.number} 章出现 {a.orders.length} 次（
        {a.orders.map((o, i) => (
          <span key={o}>
            {i > 0 && "、"}
            {jump(o)}
          </span>
        ))}
        ）
      </>
    );
  }
  return (
    <>
      乱序：{jump(a.order)}（第 {a.number} 章）排在第 {a.previous} 章之后
    </>
  );
}
