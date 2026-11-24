import type { ProcessOptions } from "@novarium/core";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type StepKey =
  | "smartLineBreak"
  | "indent"
  | "trimLines"
  | "splitInlineChapterTitles"
  | "mergeDuplicateChapterTitles"
  | "removeDuplicateLines"
  | "paragraphSplit"
  | "removeLineEndNumbers";

export const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: "smartLineBreak", label: "智能分段", hint: "按中文标点合并错误断开的段落。" },
  { key: "indent", label: "段首缩进", hint: "段首加两个全角空格。需要开启智能分段。" },
  { key: "trimLines", label: "去除行首尾空白", hint: "删除每行开头和结尾的空白。" },
  { key: "splitInlineChapterTitles", label: "拆分行内章节标题", hint: "把与正文挤在同一行的章节标题拆到独立一行。" },
  { key: "mergeDuplicateChapterTitles", label: "合并重复章节标题", hint: "合并相邻或隔一行重复出现的同章标题。" },
  { key: "removeDuplicateLines", label: "删除相邻重复行", hint: "删除与上一行完全相同的行。" },
  { key: "paragraphSplit", label: "拆分过长段落", hint: "把过长的段落按句子拆短。" },
  { key: "removeLineEndNumbers", label: "删除行尾数字", hint: "删除长行末尾的数字，常见于抓取残留的页码。" },
];

/** 清洗步骤开关与强制分段开头。过滤词表与章节正则由调用方单独编辑。 */
export function CleaningStepsForm({
  value,
  onChange,
  disabled,
}: {
  value: ProcessOptions;
  onChange: (next: ProcessOptions) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step) => (
          <div key={step.key} className="flex items-start gap-2">
            <Checkbox
              id={`step-${step.key}`}
              checked={value[step.key]}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ ...value, [step.key]: checked === true })}
              className="mt-0.5"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={`step-${step.key}`}>{step.label}</Label>
              <span className="text-xs text-muted-foreground">{step.hint}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="special-start">强制分段的行首文本</Label>
        <Input
          id="special-start"
          value={value.specialStart}
          maxLength={100}
          disabled={disabled}
          placeholder="例如书名；留空表示不启用"
          onChange={(e) => onChange({ ...value, specialStart: e.target.value })}
        />
      </div>
    </div>
  );
}
