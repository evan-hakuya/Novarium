import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { login, sessionQueryKey, type LoginError } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const errorText: Record<Exclude<LoginError, "too_many_attempts">, string> = {
  invalid_password: "密码错误。",
  owner_password_not_configured: "服务端没有设置 OWNER_PASSWORD，暂时无法登录。",
  unknown: "登录失败，请稍后再试。",
};

function formatWait(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<Exclude<LoginError, "too_many_attempts"> | null>(null);
  /** 被限制登录时，可以再试的时间（毫秒时间戳）。 */
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);

  // 被限制时每秒刷新倒计时，到时间后解除。
  useEffect(() => {
    if (blockedUntil === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= blockedUntil) setBlockedUntil(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [blockedUntil]);
  const waitSeconds = blockedUntil === null ? 0 : Math.max(0, Math.ceil((blockedUntil - now) / 1000));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await login(password);
    setPending(false);
    if (!result.ok) {
      if (result.error === "too_many_attempts") {
        setError(null);
        setNow(Date.now());
        setBlockedUntil(Date.now() + result.retryAfterSeconds * 1000);
      } else {
        setError(result.error);
      }
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
          {blockedUntil !== null && (
            <p className="text-sm text-destructive">登录失败次数过多，请 {formatWait(waitSeconds)} 后再试。</p>
          )}
          <Button type="submit" disabled={pending || password.length === 0 || blockedUntil !== null}>
            {pending ? "登录中" : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
