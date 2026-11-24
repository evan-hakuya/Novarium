export interface Health {
  ok: boolean;
  runtime: "cloudflare" | "node";
  checks: { db: "ok" | "error"; storage: "ok" | "error" };
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch("/api/health");
  // 503 也带有检查结果，照常解析。
  if (!res.ok && res.status !== 503) throw new Error(`health check failed: HTTP ${res.status}`);
  return res.json();
}
