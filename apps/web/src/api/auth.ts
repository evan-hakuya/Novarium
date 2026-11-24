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

export type LoginError = "invalid_password" | "owner_password_not_configured" | "unknown";

export async function login(password: string): Promise<{ ok: true } | { ok: false; error: LoginError }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  const error = body?.error === "invalid_password" || body?.error === "owner_password_not_configured" ? body.error : "unknown";
  return { ok: false, error };
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
