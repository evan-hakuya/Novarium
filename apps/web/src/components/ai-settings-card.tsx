import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiFailureReason, aiStatusQueryKey, checkAi, fetchAiStatus, saveAiEnabled } from "@/api/ai";
import { describeError } from "@/api/books";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const modeText = { binding: "Workers AI 绑定", rest: "REST 接口（账户 ID 与 API 令牌）" } as const;

/** 设置页的 AI 复核开关（ADR 0007）。默认关闭；开启前提示原稿片段会发送到 Cloudflare。 */
export function AiSettingsCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: aiStatusQueryKey, queryFn: fetchAiStatus });
  const toggle = useMutation({
    mutationFn: saveAiEnabled,
    onSuccess: (next) => queryClient.setQueryData(aiStatusQueryKey, next),
  });
  const check = useMutation({ mutationFn: checkAi });

  const onToggle = (enabled: boolean) => {
    if (enabled && !window.confirm("开启后，在整理页点击 AI 按钮时，原稿片段会发送到 Cloudflare 处理。确定开启？")) return;
    toggle.mutate(enabled);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 复核</CardTitle>
        <CardDescription>
          整理时可以手动让 AI 识别书名、作者、简介，并复核章节划分。使用 Cloudflare Workers AI，按调用计费，每天有免费额度。AI 出错时只用规则整理。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.isError && <p className="text-sm text-destructive">{describeError(status.error)}</p>}
        {status.data && !status.data.configured && (
          <p className="text-sm text-muted-foreground">
            未配置。Cloudflare 部署需要 <code>ai</code> 绑定；Docker 部署需要设置环境变量 <code>WORKERS_AI_ACCOUNT_ID</code> 与{" "}
            <code>WORKERS_AI_TOKEN</code>。
          </p>
        )}
        <div className="flex items-center gap-2">
          <Checkbox
            id="ai-enabled"
            checked={!!status.data?.enabled}
            disabled={!status.data?.configured || toggle.isPending}
            onCheckedChange={(checked) => onToggle(checked === true)}
          />
          <Label htmlFor="ai-enabled">开启 AI 复核</Label>
        </div>
        {toggle.isError && <p className="text-sm text-destructive">{describeError(toggle.error)}</p>}
        {status.data?.configured && status.data.mode && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">调用方式：{modeText[status.data.mode]}</span>
            <Button variant="outline" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? "测试中…" : "测试连接"}
            </Button>
            {check.isSuccess && <span className="text-muted-foreground">连接正常</span>}
            {check.isError && <span className="text-destructive">连接失败：{aiFailureReason(check.error)}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
