import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { ProcessOptions } from "@novarium/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fixAiLines,
  ignoreAiLines,
  LINE_KIND_TEXT,
  unfixAiLines,
  unignoreAiLines,
  type AiReviewItem,
} from "@/lib/ai-review";
import {
  ANOMALY_KINDS,
  canFix,
  countPending,
  isAiItem,
  itemKind,
  type ReviewItem,
  type ReviewKind,
  type ReviewStatus,
} from "@/lib/number-review";
import { cn } from "@/lib/utils";

type Tab = ReviewStatus | "all";
type KindTab = ReviewKind | "all";

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

/** 每种异常的处理方式，只在选中这一类型时显示。 */
const UNFIXABLE_HELP = "无法自动修复，也不挡住导入；多半来自原稿本身，检查无误后可以忽略。";
const KIND_HELP: Record<ReviewKind, string> = {
  outOfOrder: "修复：把这一章连同其后的番外等无序号章节，移到同一分卷中按序号应在的位置。",
  missing: UNFIXABLE_HELP,
  duplicate: UNFIXABLE_HELP,
  numberTypo: "相邻两章用了同一个序号，下一章跳过一个序号。修复：把第二章标题中的序号改为跳过的那个；不挡住导入。",
  sectionReset: "序号重新从 1 开始，视为新的分卷，分卷内单独检查，无需处理。",
  aiLine: "修复即按 AI 的判断修正这一行；置信度不低于 0.8 的判断已自动修复，标为「AI」。",
  notice: "修复后单独成章、不带序号，标为作者公告，不参与序号检查；忽略则保持规则的结果。",
};

/** 一次最多渲染的条数；全选与批量操作仍作用于标签页中的全部异常。 */
const MAX_RENDERED = 300;

/** 标签行放不下时横向滚动，不撑宽页面。 */
const TAB_ROW = "max-w-full justify-start overflow-x-auto pointer-coarse:h-11!";
/** 触屏上行内按钮的可点区域不小于 44px。 */
const TOUCH = "pointer-coarse:h-11 pointer-coarse:px-3";

const without = (list: string[], keys: ReadonlySet<string>) => list.filter((k) => !keys.has(k));
const union = (list: string[], keys: Iterable<string>) => [...new Set([...list, ...keys])];

/**
 * 章节异常的逐条处理：章节序号异常（修复即移动乱序章节）与 AI 复核结果（修复即按 AI 的判断修正这一行），
 * 可以修复、忽略、撤销，支持勾选后批量操作。系统已自动处理的分卷边界显示「无需处理」。
 */
export function NumberReviewPanel({
  items,
  chapterTitle,
  onJump,
  options,
  onChangeOptions,
  onPatchOptions,
  toolbar,
  disabled,
}: {
  items: ReviewItem[];
  chapterTitle: (order: number) => string;
  /** 跳到章节；line 是要在正文中高亮的一行（AI 条目），不传时跳到章节标题。 */
  onJump: (order: number, line?: string) => void;
  options: ProcessOptions;
  onChangeOptions: (next: ProcessOptions) => void;
  onPatchOptions: (next: ProcessOptions) => void;
  /** 标题右侧的操作区，例如 AI 复核。 */
  toolbar?: ReactNode;
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
  const rowId = useId();
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

  const header = (text: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-medium">章节异常：{text}</span>
      {toolbar}
    </div>
  );

  if (items.length === 0) {
    return <section className="flex flex-col gap-3 rounded-xl border p-4 text-sm">{header("没有发现异常")}</section>;
  }

  // 章节序号异常按 key 记录；AI 复核结果按行记录（见 lib/ai-review.ts）。
  const split = (list: ReviewItem[]) => {
    const ai = list.filter(isAiItem);
    return { numberKeys: list.filter((i) => !isAiItem(i)).map((i) => i.key), ai };
  };
  const apply = (list: ReviewItem[], number: (o: ProcessOptions, keys: string[]) => ProcessOptions, ai: (o: ProcessOptions, items: AiReviewItem[]) => ProcessOptions) => {
    const parts = split(list);
    let next = parts.numberKeys.length ? number(options, parts.numberKeys) : options;
    if (parts.ai.length) next = ai(next, parts.ai);
    return next;
  };
  // 修复会改变分章，需要重新整理；忽略只改记录。
  const fix = (list: ReviewItem[]) =>
    onChangeOptions(
      apply(
        list,
        (o, keys) => ({ ...o, numberFixes: union(o.numberFixes, keys), numberIgnores: without(o.numberIgnores, new Set(keys)) }),
        fixAiLines,
      ),
    );
  const unfix = (list: ReviewItem[]) =>
    onChangeOptions(apply(list, (o, keys) => ({ ...o, numberFixes: without(o.numberFixes, new Set(keys)) }), unfixAiLines));
  const ignore = (list: ReviewItem[]) =>
    onPatchOptions(apply(list, (o, keys) => ({ ...o, numberIgnores: union(o.numberIgnores, keys) }), ignoreAiLines));
  const unignore = (list: ReviewItem[]) =>
    onPatchOptions(apply(list, (o, keys) => ({ ...o, numberIgnores: without(o.numberIgnores, new Set(keys)) }), unignoreAiLines));

  const batchable = tab === "pending" || tab === "ignored" || tab === "fixed";
  const selected = visible.filter((i) => checked.has(i.key));
  const selectedFixable = selected.filter(canFix);
  const allChecked = visible.length > 0 && selected.length === visible.length;

  const jump = (order: number, line?: string) => (
    <button type="button" className="text-left underline underline-offset-2 hover:text-foreground" onClick={() => onJump(order, line)}>
      {chapterTitle(order)}
    </button>
  );

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
      {header(pendingSummary(countPending(items), counts.pending))}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0">
        <TabsList className={TAB_ROW}>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex-none">
              {t.label} {counts[t.value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tabs value={kind} onValueChange={(v) => setKind(v as KindTab)} className="min-w-0">
        <TabsList variant="line" className={TAB_ROW}>
          <TabsTrigger value="all" className="flex-none">
            全部类型 {inStatus.length}
          </TabsTrigger>
          {/* 只列出当前状态下有异常的类型；已选中的类型即使变为 0 也保留，避免选中项消失。 */}
          {ANOMALY_KINDS.filter((k) => kindCounts[k.kind]! > 0 || k.kind === kind).map((k) => (
            <TabsTrigger key={k.kind} value={k.kind} className="flex-none">
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
              className="pointer-coarse:after:-inset-3.5"
              checked={allChecked ? true : selected.length > 0 ? "indeterminate" : false}
              disabled={disabled}
              onCheckedChange={(v) => setChecked(v === true ? new Set(visible.map((i) => i.key)) : new Set())}
            />
            {selected.length > 0 ? `已选 ${selected.length} / ${visible.length}` : `全选（${visible.length}）`}
          </label>
          <div className="flex gap-2">
            {tab === "pending" && (
              <>
                <Button size="sm" className={TOUCH} disabled={disabled || selectedFixable.length === 0} onClick={() => fix(selectedFixable)}>
                  批量修复{selectedFixable.length > 0 && ` ${selectedFixable.length}`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={TOUCH}
                  disabled={disabled || selected.length === 0}
                  onClick={() => ignore(selected)}
                >
                  批量忽略{selected.length > 0 && ` ${selected.length}`}
                </Button>
              </>
            )}
            {(tab === "ignored" || tab === "fixed") && (
              <Button
                size="sm"
                variant="outline"
                className={TOUCH}
                disabled={disabled || selected.length === 0}
                onClick={() => (tab === "ignored" ? unignore : unfix)(selected)}
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
          {visible.slice(0, MAX_RENDERED).map((item, index) => (
            <li key={item.key} className="flex items-center gap-3 border-b py-1.5 last:border-b-0">
              {batchable && (
                <Checkbox
                  aria-labelledby={`${rowId}-${index}`}
                  className="pointer-coarse:after:-inset-3.5"
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
              <span id={`${rowId}-${index}`} className={cn("min-w-0 flex-1", item.status !== "pending" && "text-muted-foreground")}>
                <ItemText item={item} jump={jump} />
              </span>
              {tab === "all" && <Badge variant={item.status === "pending" ? "destructive" : "outline"}>{STATUS_TEXT[item.status]}</Badge>}
              <div className="flex shrink-0 gap-1">
                {canFix(item) && (
                  <Button size="xs" className={TOUCH} disabled={disabled} onClick={() => fix([item])}>
                    修复
                  </Button>
                )}
                {item.status === "pending" && (
                  <Button size="xs" variant="outline" className={TOUCH} disabled={disabled} onClick={() => ignore([item])}>
                    忽略
                  </Button>
                )}
                {item.status === "ignored" && (
                  <Button size="xs" variant="ghost" className={TOUCH} disabled={disabled} onClick={() => unignore([item])}>
                    撤销忽略
                  </Button>
                )}
                {item.status === "fixed" && (
                  <Button size="xs" variant="ghost" className={TOUCH} disabled={disabled} onClick={() => unfix([item])}>
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
      <p className="text-xs text-muted-foreground">{kind === "all" ? "选中一种类型，查看它的处理方式。" : KIND_HELP[kind]}</p>
    </section>
  );
}

/** 面板标题：先说挡住继续的条数，再说只需检查的缺号与重复编号。 */
function pendingSummary(blocking: number, pending: number): string {
  const advisory = pending - blocking;
  if (pending === 0) return "已全部处理";
  const check = advisory > 0 ? `${advisory} 处缺号或重复编号待检查，不影响继续` : "";
  if (blocking === 0) return check;
  return `${blocking} 处待处理，处理完才能继续${check && `；另有 ${check}`}`;
}

type Jump = (order: number, line?: string) => ReactNode;

function ItemText({ item, jump }: { item: ReviewItem; jump: Jump }) {
  if (isAiItem(item)) return <AiItemText item={item} jump={jump} />;
  if (item.status === "fixed") {
    if (item.kind === "numberTypo") {
      return (
        <>
          序号笔误：「{item.title}」已改为第 {item.number + 1} 章{item.order !== null && <>（{jump(item.order)}）</>}
        </>
      );
    }
    return (
      <>
        乱序：{item.order === null ? item.title : jump(item.order)}（第 {item.number} 章）已移到按序号的位置
      </>
    );
  }
  const a = item.anomaly;
  if (a.kind === "numberTypo") {
    return (
      <>
        序号笔误：{jump(a.first)} 之后的 {jump(a.order)} 应为第 {a.number + 1} 章（第 {a.number} 章重复，第 {a.number + 1} 章缺失）
      </>
    );
  }
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

function AiItemText({ item, jump }: { item: AiReviewItem; jump: Jump }) {
  const { ai } = item;
  const line = (
    <>
      「{ai.text}」
      {ai.order !== null && <>（{jump(ai.order, ai.text)}）</>}
    </>
  );
  // 向下取整：0.798 显示为 0.79，不会让未达 0.8 的结果看起来已达标。
  const confidence = ai.confidence === null ? "" : `，置信度 ${(Math.floor(ai.confidence * 100) / 100).toFixed(2)}`;
  const rule = ai.rule ? `规则判为${LINE_KIND_TEXT[ai.rule]}，` : "";
  if (item.status === "fixed") {
    return (
      <>
        <Badge variant="secondary" className="mr-1">
          AI
        </Badge>
        {line} 已设为{LINE_KIND_TEXT[ai.suggested]}
        {confidence && `（${confidence.slice(1)}）`}
      </>
    );
  }
  if (ai.kind === "notice") {
    return (
      <>
        作者公告：{line} {rule}AI 判为作者公告{confidence}
      </>
    );
  }
  return (
    <>
      AI 复核：{line} {rule}AI 判为{LINE_KIND_TEXT[ai.suggested]}
      {confidence}
    </>
  );
}
