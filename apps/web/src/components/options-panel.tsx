import { useState } from "react";
import { checkChapterPattern, type ProcessOptions } from "@novarium/core";
import { CleaningStepsForm } from "@/components/process-options-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 一本书的整理选项：清洗步骤与本书的章节正则。过滤词表在「设置」中维护。 */
export function OptionsPanel({
  options,
  onChange,
  disabled,
  open,
}: {
  options: ProcessOptions;
  onChange: (next: ProcessOptions) => void;
  disabled?: boolean;
  open?: boolean;
}) {
  const [patternDraft, setPatternDraft] = useState(options.chapterPattern ?? "");
  const [patternError, setPatternError] = useState<string | null>(null);

  function applyPattern() {
    const pattern = patternDraft.trim();
    const problem = pattern ? checkChapterPattern(pattern) : null;
    setPatternError(problem ? `正则无效：${problem}` : null);
    if (!problem) onChange({ ...options, chapterPattern: pattern || null });
  }

  return (
    <details className="rounded-xl border p-4" open={open}>
      <summary className="cursor-pointer text-sm font-medium">整理选项</summary>
      <div className="mt-4 flex flex-col gap-4">
        <CleaningStepsForm value={options} onChange={onChange} disabled={disabled} />
        <p className="text-xs text-muted-foreground">过滤词表（{options.filterWords.length} 个词）在「设置」中维护。</p>
        <details open={!!options.chapterPattern || undefined}>
          <summary className="cursor-pointer text-sm font-medium">章节正则（高级）</summary>
          <div className="mt-2 flex flex-col gap-2">
            <Label htmlFor="chapter-pattern">本书的章节正则</Label>
            <div className="flex gap-2">
              <Input
                id="chapter-pattern"
                value={patternDraft}
                disabled={disabled}
                placeholder="留空只用内置规则，例如 ^个人番外"
                aria-invalid={!!patternError}
                onChange={(e) => setPatternDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyPattern()}
              />
              <Button variant="outline" disabled={disabled} onClick={applyPattern}>
                应用
              </Button>
            </div>
            {patternError && <span className="text-xs text-destructive">{patternError}</span>}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={options.chapterPatternMode === "replace"}
                disabled={disabled}
                onCheckedChange={(v) => onChange({ ...options, chapterPatternMode: v === true ? "replace" : "extend" })}
              />
              只用本书正则，不用内置规则
            </label>
            <span className="text-xs text-muted-foreground">
              默认与内置规则一起使用，任一命中的不超过 40 字的行都是章节标题。
              <br />
              内置规则不是单个正则，不能填到这里。
            </span>
          </div>
        </details>
      </div>
    </details>
  );
}
