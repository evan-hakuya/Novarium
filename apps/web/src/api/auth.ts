export interface Session {
  authenticated: boolean;
  // 服务端是否设置了 OWNER_PASSWORD。
  configured: boolean;
}

export const sessionQueryKey = ["auth", "session"] as const;

export async function fetchSession(): Promise<Session> {
  const res = await fetch("/api/auth/session");
  if (!res.ok) throw new Error(`session check failed: HTTP ${res.status}`);
  return res.json();
}

export type LoginError = "invalid_password" | "owner_password_not_configured" | "too_many_attempts" | "unknown";

export type LoginResult =
  | { ok: true }
  | { ok: false; error: Exclude<LoginError, "too_many_attempts"> }
  /** 登录失败次数过多。retryAfterSeconds 秒后才能再试。 */
  | { ok: false; error: "too_many_attempts"; retryAfterSeconds: number };

export async function login(password: string): Promise<LoginResult> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    return { ok: false, error: "too_many_attempts", retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 60 };
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  const error = body?.error === "invalid_password" || body?.error === "owner_password_not_configured" ? body.error : "unknown";
  return { ok: false, error };
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
