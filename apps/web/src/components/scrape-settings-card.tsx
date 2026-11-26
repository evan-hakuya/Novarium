import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/api/books";
import { checkScrape, clearScrapeKey, fetchScrapeStatus, saveScrapeKey, scrapeFailureReason, scrapeStatusQueryKey } from "@/api/scrape";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 设置页的刮削卡片（ADR 0006）：填写、替换、清除 DaoSearch 密钥，测试连接。 */
export function ScrapeSettingsCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: scrapeStatusQueryKey, queryFn: fetchScrapeStatus });
  const [key, setKey] = useState("");
  const check = useMutation({ mutationFn: checkScrape });
  const onSaved = (next: Awaited<ReturnType<typeof fetchScrapeStatus>>) => {
    queryClient.setQueryData(scrapeStatusQueryKey, next);
    setKey("");
    check.reset();
  };
  const save = useMutation({ mutationFn: saveScrapeKey, onSuccess: onSaved });
  const clear = useMutation({ mutationFn: clearScrapeKey, onSuccess: onSaved });
  const busy = save.isPending || clear.isPending;
  const quota = check.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>刮削</CardTitle>
        <CardDescription>
          从 DaoSearch 读取书名、作者、简介、标签与封面。需要在 DaoSearch 开发者页生成的 API 密钥；没有密钥时不显示刮削功能。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.isError && <p className="text-sm text-destructive">{describeError(status.error)}</p>}
        {status.data && (
          <p className="text-sm text-muted-foreground">
            {status.data.configured ? (
              <>
                当前密钥：<code>{status.data.keyHint}</code>
              </>
            ) : (
              "未填写密钥"
            )}
          </p>
        )}
        <form
          className="flex max-w-xl flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) save.mutate(key.trim());
          }}
        >
          <Label htmlFor="daosearch-key">{status.data?.configured ? "替换密钥" : "API 密钥"}</Label>
          <div className="flex gap-2">
            <Input
              id="daosearch-key"
              type="password"
              autoComplete="off"
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="submit" disabled={busy || !key.trim()}>
              {save.isPending ? "保存中…" : "保存"}
            </Button>
          </div>
          {save.isError && <span className="text-sm text-destructive">{describeError(save.error)}</span>}
        </form>
        {status.data?.configured && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button variant="outline" size="sm" disabled={busy || check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? "测试中…" : "测试连接"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm("清除 DaoSearch 密钥？清除后不显示刮削功能。")) clear.mutate();
              }}
            >
              清除密钥
            </Button>
            {quota && (
              <span className="text-muted-foreground">
                连接正常，今日剩余 {quota.remaining ?? "?"}
                {quota.limit !== null && ` / ${quota.limit}`} 点
              </span>
            )}
            {check.isError && <span className="text-destructive">连接失败：{scrapeFailureReason(check.error)}</span>}
            {clear.isError && <span className="text-destructive">{describeError(clear.error)}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
