import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/api/books";
import {
  bookSourceQueryKey,
  createToken,
  deleteToken,
  fetchBookSource,
  fetchTokens,
  legadoImportLink,
  revokeToken,
  tokensQueryKey,
  type AccessToken,
} from "@/api/tokens";
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
  // 当前展开书源的访问令牌。
  const [openId, setOpenId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createToken,
    onSuccess: ({ token, bookSource, importUrl }) => {
      queryClient.setQueryData(bookSourceQueryKey(token.id), { bookSource, importUrl });
      setOpenId(token.id);
      setName("");
      void queryClient.invalidateQueries({ queryKey: tokensQueryKey });
    },
  });

  const revoke = useMutation({
    mutationFn: revokeToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensQueryKey }),
  });

  const remove = useMutation({
    mutationFn: deleteToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensQueryKey }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate(name);
  }

  function onRevoke(token: AccessToken) {
    if (window.confirm(`撤销「${token.name}」后，使用它的阅读客户端会立即无法读取书库。确定撤销？`)) {
      if (openId === token.id) setOpenId(null);
      revoke.mutate(token.id);
    }
  }

  function onDelete(token: AccessToken) {
    const effect = token.revokedAt ? "" : "使用它的阅读客户端会立即无法读取书库，";
    if (window.confirm(`删除「${token.name}」后，${effect}这条记录不能恢复。确定删除？`)) {
      if (openId === token.id) setOpenId(null);
      remove.mutate(token.id);
    }
  }

  const mutationError = [create, revoke, remove].find((m) => m.isError)?.error;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-heading text-xl font-semibold">访问令牌</h2>
      <Card>
        <CardHeader>
          <CardTitle>新建访问令牌</CardTitle>
          <CardDescription>
            每个阅读客户端用一个访问令牌。每个访问令牌有一份书源，导入「阅读」（Legado）即可使用。
          </CardDescription>
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
        </CardContent>
      </Card>

      {tokens.isError && <p className="text-sm text-destructive">{describeError(tokens.error)}</p>}
      {mutationError && <p className="text-sm text-destructive">{describeError(mutationError)}</p>}
      {tokens.data?.length === 0 && <p className="text-sm text-muted-foreground">还没有访问令牌。</p>}
      <ul className="flex flex-col gap-3">
        {tokens.data?.map((token) => {
          const active = !token.revokedAt;
          const open = openId === token.id;
          return (
            <li key={token.id}>
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 font-medium">
                        {token.name}
                        {!active && <Badge variant="destructive">已撤销</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        创建于 {formatTime(token.createdAt)} · 最近使用 {formatTime(token.lastUsedAt)}
                        {token.revokedAt && ` · 撤销于 ${formatTime(token.revokedAt)}`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {active && token.viewable && (
                        <Button variant="outline" size="sm" onClick={() => setOpenId(open ? null : token.id)}>
                          {open ? "收起书源" : "查看书源"}
                        </Button>
                      )}
                      {active && (
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={revoke.isPending}
                          onClick={() => onRevoke(token)}
                        >
                          撤销
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => onDelete(token)}>
                        删除
                      </Button>
                    </div>
                  </div>
                  {active && !token.viewable && (
                    <p className="text-xs text-muted-foreground">这个访问令牌创建时没有保存明文，无法再次查看书源。</p>
                  )}
                  {open && <BookSourcePanel tokenId={token.id} />}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BookSourcePanel({ tokenId }: { tokenId: string }) {
  const source = useQuery({ queryKey: bookSourceQueryKey(tokenId), queryFn: () => fetchBookSource(tokenId) });
  const [copied, setCopied] = useState<"url" | "json" | null>(null);

  if (source.isPending) return <p className="text-sm text-muted-foreground">读取书源…</p>;
  if (source.isError) return <p className="text-sm text-destructive">{describeError(source.error)}</p>;

  const { importUrl } = source.data;
  const json = JSON.stringify(source.data.bookSource, null, 2);
  async function copy(kind: "url" | "json", text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
  }

  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <p className="text-xs text-muted-foreground">书源和导入地址都含访问令牌，不要分享。</p>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">网络导入</h3>
        <p className="text-xs text-muted-foreground">
          在「阅读」中选择「书源管理 → 网络导入」，粘贴这个地址。手机上也可以直接点「在阅读中打开」。
        </p>
        <Input readOnly value={importUrl} onFocus={(e) => e.target.select()} />
        <div className="flex gap-2">
          <Button size="sm" onClick={() => copy("url", importUrl)}>
            {copied === "url" ? "已复制" : "复制导入地址"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={legadoImportLink(importUrl)}>在阅读中打开</a>
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">书源 JSON</h3>
        <p className="text-xs text-muted-foreground">在「阅读」中选择「书源管理 → 剪贴板导入」。</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{json}</pre>
        <div>
          <Button size="sm" variant="outline" onClick={() => copy("json", json)}>
            {copied === "json" ? "已复制" : "复制书源 JSON"}
          </Button>
        </div>
      </section>
    </div>
  );
}
