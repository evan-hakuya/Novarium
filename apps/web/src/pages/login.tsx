import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { login, sessionQueryKey, type LoginError } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const errorText: Record<LoginError, string> = {
  invalid_password: "密码错误。",
  owner_password_not_configured: "服务端没有设置 OWNER_PASSWORD，暂时无法登录。",
  unknown: "登录失败，请稍后再试。",
};

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginError | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await login(password);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    await navigate({ to: "/" });
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>登录</CardTitle>
        <CardDescription>输入部署时设置的所有者密码。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{errorText[error]}</p>}
          <Button type="submit" disabled={pending || password.length === 0}>
            {pending ? "登录中" : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
