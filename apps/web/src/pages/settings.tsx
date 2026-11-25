import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProcessOptions } from "@novarium/core";
import { describeError } from "@/api/books";
import { fetchDefaultProcessOptions, processOptionsQueryKey, saveDefaultProcessOptions } from "@/api/settings";
import { AiSettingsCard } from "@/components/ai-settings-card";
import { CleaningStepsForm } from "@/components/process-options-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: processOptionsQueryKey, queryFn: fetchDefaultProcessOptions });
  const [draft, setDraft] = useState<ProcessOptions | null>(null);
  const [wordsText, setWordsText] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (saved.data && !draft) {
      setDraft(saved.data);
      setWordsText(saved.data.filterWords.join("\n"));
    }
  }, [saved.data, draft]);

  const save = useMutation({
    mutationFn: saveDefaultProcessOptions,
    onSuccess: (options) => {
      queryClient.setQueryData(processOptionsQueryKey, options);
      setDraft(options);
      setWordsText(options.filterWords.join("\n"));
      setDone(true);
    },
  });

  if (saved.isError) return <p className="text-sm text-destructive">{describeError(saved.error)}</p>;
  if (!draft) return <p className="text-sm text-muted-foreground">加载中</p>;

  const update = (next: ProcessOptions) => {
    setDraft(next);
    setDone(false);
  };
  const words = wordsText.split("\n").map((w) => w.trim()).filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-heading text-xl font-semibold">设置</h2>
      <Card>
        <CardHeader>
          <CardTitle>默认整理选项</CardTitle>
          <CardDescription>新导入的书以这些选项开始整理。导入预览中可以为单本书调整。</CardDescription>
        </CardHeader>
        <CardContent>
          <CleaningStepsForm value={draft} onChange={update} disabled={save.isPending} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>过滤词表</CardTitle>
          <CardDescription>全书库共用。整理时删除含过滤词的行，用来去掉广告、网址等杂质。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="filter-words">过滤词（每行一个）</Label>
            <Textarea
              id="filter-words"
              rows={8}
              value={wordsText}
              disabled={save.isPending}
              placeholder={"例如：\n请牢记收藏\n最新最快无防盗"}
              onChange={(e) => {
                setWordsText(e.target.value);
                setDone(false);
              }}
            />
          </div>
          <div className="flex max-w-60 flex-col gap-2">
            <Label htmlFor="filter-max">过滤阈值（字）</Label>
            <Input
              id="filter-max"
              type="number"
              min={0}
              value={draft.filterMaxLineLength}
              disabled={save.isPending}
              onChange={(e) => update({ ...draft, filterMaxLineLength: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
            <span className="text-xs text-muted-foreground">
              只删除不超过这个长度的行，避免误删含过滤词的正文段落。0 表示不限长度。
            </span>
          </div>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button disabled={save.isPending} onClick={() => save.mutate({ ...draft, filterWords: words })}>
          {save.isPending ? "保存中…" : "保存"}
        </Button>
        {done && <span className="text-sm text-muted-foreground">已保存</span>}
        {save.isError && <span className="text-sm text-destructive">{describeError(save.error)}</span>}
      </div>
      <AiSettingsCard />
    </div>
  );
}
