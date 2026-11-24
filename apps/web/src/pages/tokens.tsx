import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/api/books";
import { createToken, fetchTokens, revokeToken, tokensQueryKey, type AccessToken } from "@/api/tokens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "从未");

export function TokensPage() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: tokensQueryKey, queryFn: fetchTokens });
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; json: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: createToken,
    onSuccess: (result) => {
      setCreated({ name: result.token.name, json: JSON.stringify(result.bookSource, null, 2) });
      setCopied(false);
      setName("");
      void queryClient.invalidateQueries({ queryKey: tokensQueryKey });
    },
  });

  const revoke = useMutation({
    mutationFn: revokeToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensQueryKey }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate(name);
  }

  async function onCopy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.json);
    setCopied(true);
  }

  function onRevoke(token: AccessToken) {
    if (window.confirm(`撤销「${token.name}」后，使用它的阅读客户端会立即无法读取书库。确定撤销？`)) {
      revoke.mutate(token.id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-heading text-xl font-semibold">访问令牌</h2>
      <Card>
        <CardHeader>
          <CardTitle>新建访问令牌</CardTitle>
          <CardDescription>每个阅读客户端用一个访问令牌。创建后会生成一份书源，导入「阅读」（Legado）即可使用。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-60 flex-1 flex-col gap-2">
              <Label htmlFor="token-name">名称</Label>
              <Input
                id="token-name"
                value={name}
                maxLength={50}
                placeholder="例如：我的手机"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "创建中…" : "创建"}
            </Button>
          </form>
          {create.isError && <p className="mt-3 text-sm text-destructive">{describeError(create.error)}</p>}
        </CardContent>
      </Card>

      {created && (
        <Card>
          <CardHeader>
            <CardTitle>「{created.name}」的书源</CardTitle>
            <CardDescription>
              这份书源含访问令牌明文，只显示这一次。复制后在「阅读」中选择「书源管理 → 剪贴板导入」。不要分享它。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{created.json}</pre>
            <div className="flex gap-2">
              <Button onClick={onCopy}>{copied ? "已复制" : "复制书源"}</Button>
              <Button variant="ghost" onClick={() => setCreated(null)}>
                关闭
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tokens.isError && <p className="text-sm text-destructive">{describeError(tokens.error)}</p>}
      {revoke.isError && <p className="text-sm text-destructive">{describeError(revoke.error)}</p>}
      {tokens.data?.length === 0 && <p className="text-sm text-muted-foreground">还没有访问令牌。</p>}
      <ul className="flex flex-col gap-3">
        {tokens.data?.map((token) => (
          <li key={token.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 font-medium">
                    {token.name}
                    {token.revokedAt && <Badge variant="destructive">已撤销</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    创建于 {formatTime(token.createdAt)} · 最近使用 {formatTime(token.lastUsedAt)}
                    {token.revokedAt && ` · 撤销于 ${formatTime(token.revokedAt)}`}
                  </div>
                </div>
                {!token.revokedAt && (
                  <Button variant="destructive" size="sm" disabled={revoke.isPending} onClick={() => onRevoke(token)}>
                    撤销
                  </Button>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
