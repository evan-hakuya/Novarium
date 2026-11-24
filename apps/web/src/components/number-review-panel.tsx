import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isFixable, type ProcessOptions } from "@novarium/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ANOMALY_KINDS, itemKind, type ReviewItem, type ReviewStatus } from "@/lib/number-review";
import { cn } from "@/lib/utils";

type Tab = ReviewStatus | "all";
type KindTab = ReturnType<typeof itemKind> | "all";

const TABS: { value: Tab; label: string }[] = [
  { value: "pending", label: "待处理" },
  { value: "noAction", label: "无需处理" },
  { value: "ignored", label: "已忽略" },
  { value: "fixed", label: "已修复" },
  { value: "all", label: "全部" },
];

const STATUS_TEXT: Record<ReviewStatus, string> = {
  pending: "待处理",
  noAction: "无需处理",
  ignored: "已忽略",
  fixed: "已修复",
};

/** 一次最多渲染的条数；全选与批量操作仍作用于标签页中的全部异常。 */
const MAX_RENDERED = 300;

const without = (list: string[], keys: ReadonlySet<string>) => list.filter((k) => !keys.has(k));
const union = (list: string[], keys: Iterable<string>) => [...new Set([...list, ...keys])];

/**
 * 章节序号异常的逐条处理：修复（移动乱序章节）、忽略、撤销，支持勾选后批量操作。
 * 系统已自动处理的分卷边界显示「无需处理」。
 */
export function NumberReviewPanel({
  items,
  chapterTitle,
  onJump,
  options,
  onChangeOptions,
  onPatchOptions,
  disabled,
}: {
  items: ReviewItem[];
  chapterTitle: (order: number) => string;
  onJump: (order: number) => void;
  options: ProcessOptions;
  onChangeOptions: (next: ProcessOptions) => void;
  onPatchOptions: (next: ProcessOptions) => void;
  disabled?: boolean;
}) {
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { pending: 0, noAction: 0, ignored: 0, fixed: 0, all: items.length };
    for (const item of items) c[item.status]++;
    return c;
  }, [items]);
  const [tab, setTab] = useState<Tab>(counts.pending > 0 ? "pending" : "all");
  const [kind, setKind] = useState<KindTab>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // 第一行按处理状态筛选，第二行在其中按异常类型筛选。
  const inStatus = useMemo(() => (tab === "all" ? items : items.filter((i) => i.status === tab)), [items, tab]);
  const kindCounts = useMemo(() => {
    const c = Object.fromEntries(ANOMALY_KINDS.map((k) => [k.kind, 0])) as Record<string, number>;
    for (const item of inStatus) c[itemKind(item)]!++;
    return c;
  }, [inStatus]);
  const visible = useMemo(() => (kind === "all" ? inStatus : inStatus.filter((i) => itemKind(i) === kind)), [inStatus, kind]);

  // 切换标签页或处理后，只保留仍在当前标签页中的勾选。
  useEffect(() => {
    const keys = new Set(visible.map((i) => i.key));
    setChecked((prev) => new Set([...prev].filter((k) => keys.has(k))));
  }, [visible]);

  if (items.length === 0) {
    return <section className="rounded-xl border p-4 text-sm font-medium">章节序号：没有发现异常</section>;
  }

  const fix = (keys: string[]) => {
    const set = new Set(keys);
    onChangeOptions({ ...options, numberFixes: union(options.numberFixes, keys), numberIgnores: without(options.numberIgnores, set) });
  };
  const unfix = (keys: string[]) => onChangeOptions({ ...options, numberFixes: without(options.numberFixes, new Set(keys)) });
  const ignore = (keys: string[]) => onPatchOptions({ ...options, numberIgnores: union(options.numberIgnores, keys) });
  const unignore = (keys: string[]) => onPatchOptions({ ...options, numberIgnores: without(options.numberIgnores, new Set(keys)) });

  const batchable = tab === "pending" || tab === "ignored" || tab === "fixed";
  const selected = visible.filter((i) => checked.has(i.key));
  const selectedFixable = selected.filter((i) => i.status === "pending" && isFixable(i.anomaly)).map((i) => i.key);
  const allChecked = visible.length > 0 && selected.length === visible.length;

  const jump = (order: number) => (
    <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onJump(order)}>
      {chapterTitle(order)}
    </button>
  );

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
      <div className="font-medium">
        章节序号：
        {counts.pending > 0 ? `${counts.pending} 处异常待处理，处理完才能提交` : "异常已全部处理"}
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label} {counts[t.value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tabs value={kind} onValueChange={(v) => setKind(v as KindTab)}>
        <TabsList variant="line">
          <TabsTrigger value="all">全部类型 {inStatus.length}</TabsTrigger>
          {ANOMALY_KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind}>
              {k.label} {kindCounts[k.kind]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {batchable && visible.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <label className="flex items-center gap-2 text-muted-foreground">
            <Checkbox
              aria-label="全选"
              checked={allChecked ? true : selected.length > 0 ? "indeterminate" : false}
              disabled={disabled}
              onCheckedChange={(v) => setChecked(v === true ? new Set(visible.map((i) => i.key)) : new Set())}
            />
            {selected.length > 0 ? `已选 ${selected.length} / ${visible.length}` : `全选（${visible.length}）`}
          </label>
          <div className="flex gap-2">
            {tab === "pending" && (
              <>
                <Button size="sm" disabled={disabled || selectedFixable.length === 0} onClick={() => fix(selectedFixable)}>
                  批量修复{selectedFixable.length > 0 && ` ${selectedFixable.length}`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || selected.length === 0}
                  onClick={() => ignore(selected.map((i) => i.key))}
                >
                  批量忽略{selected.length > 0 && ` ${selected.length}`}
                </Button>
              </>
            )}
            {(tab === "ignored" || tab === "fixed") && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || selected.length === 0}
                onClick={() => (tab === "ignored" ? unignore : unfix)(selected.map((i) => i.key))}
              >
                批量撤销{selected.length > 0 && ` ${selected.length}`}
              </Button>
            )}
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-muted-foreground">
          没有{tab === "all" ? "" : TABS.find((t) => t.value === tab)!.label}
          {kind === "all" ? "" : `的${ANOMALY_KINDS.find((k) => k.kind === kind)!.label}`}异常。
        </p>
      ) : (
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {visible.slice(0, MAX_RENDERED).map((item) => (
            <li key={item.key} className="flex items-center gap-3 border-b py-1.5 last:border-b-0">
              {batchable && (
                <Checkbox
                  aria-label="选择"
                  checked={checked.has(item.key)}
                  disabled={disabled}
                  onCheckedChange={(v) =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (v === true) next.add(item.key);
                      else next.delete(item.key);
                      return next;
                    })
                  }
                />
              )}
              <span className={cn("min-w-0 flex-1", item.status !== "pending" && "text-muted-foreground")}>
                <ItemText item={item} jump={jump} />
              </span>
              {tab === "all" && <Badge variant={item.status === "pending" ? "destructive" : "outline"}>{STATUS_TEXT[item.status]}</Badge>}
              <div className="flex shrink-0 gap-1">
                {item.status === "pending" && isFixable(item.anomaly) && (
                  <Button size="xs" disabled={disabled} onClick={() => fix([item.key])}>
                    修复
                  </Button>
                )}
                {item.status === "pending" && (
                  <Button size="xs" variant="outline" disabled={disabled} onClick={() => ignore([item.key])}>
                    忽略
                  </Button>
                )}
                {item.status === "ignored" && (
                  <Button size="xs" variant="ghost" disabled={disabled} onClick={() => unignore([item.key])}>
                    撤销忽略
                  </Button>
                )}
                {item.status === "fixed" && (
                  <Button size="xs" variant="ghost" disabled={disabled} onClick={() => unfix([item.key])}>
                    撤销修复
                  </Button>
                )}
                {item.status === "noAction" && tab !== "all" && (
                  <span className="px-2 text-xs text-muted-foreground">无需处理</span>
                )}
              </div>
            </li>
          ))}
          {visible.length > MAX_RENDERED && (
            <li className="py-1.5 text-muted-foreground">另有 {visible.length - MAX_RENDERED} 条未显示，全选与批量操作包含它们。</li>
          )}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        修复乱序：把章节连同其后的番外等无序号章节，移到同一分卷中按序号应在的位置。缺号与重复编号无法自动修复，请检查原稿或章节正则后忽略。
      </p>
    </section>
  );
}

function ItemText({ item, jump }: { item: ReviewItem; jump: (order: number) => ReactNode }) {
  if (item.status === "fixed") {
    return (
      <>
        乱序：{item.order === null ? item.title : jump(item.order)}（第 {item.number} 章）已移到按序号的位置
      </>
    );
  }
  const a = item.anomaly;
  if (a.kind === "sectionReset") {
    return (
      <>
        分卷边界：{jump(a.order)}（序号从第 {a.previous} 章重置为第 1 章），分卷内单独检查
      </>
    );
  }
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
      乱序：{jump(a.order)}（第 {a.number} 章）不在按序号的位置上
    </>
  );
}
