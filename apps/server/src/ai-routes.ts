import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { AiError, type AiClient, type AiMode } from "./ai";
import type { AppDeps } from "./app";
import { settings } from "./db/schema";

type Env = { Variables: { deps: AppDeps } };

/** AI 总开关在 settings 表中的键。默认关闭（ADR 0007）。 */
const AI_ENABLED_KEY = "ai_enabled";

export interface AiStatus {
  /** 部署是否配置了 AI（`ai` 绑定，或 REST 的账户 ID 与令牌）。 */
  configured: boolean;
  mode: AiMode | null;
  /** 所有者是否开启了 AI。未配置时总是 false。 */
  enabled: boolean;
}

export async function getAiStatus(deps: AppDeps): Promise<AiStatus> {
  if (!deps.ai) return { configured: false, mode: null, enabled: false };
  const row = await deps.db.select().from(settings).where(eq(settings.key, AI_ENABLED_KEY)).get();
  return { configured: true, mode: deps.ai.mode, enabled: row?.value === true };
}

/**
 * 供 AI 功能的路由使用：未配置返回 503 ai_not_configured，未开启返回 409 ai_disabled，
 * 可用时返回客户端。
 */
export async function requireAi(c: Context<Env>): Promise<AiClient | Response> {
  const deps = c.get("deps");
  const status = await getAiStatus(deps);
  if (!deps.ai || !status.configured) return c.json({ error: "ai_not_configured" }, 503);
  if (!status.enabled) return c.json({ error: "ai_disabled" }, 409);
  return deps.ai;
}

/** 把 AiError 转成统一的响应：502 ai_unavailable，带 kind。前端据此提示「AI 不可用，已只用规则识别」。 */
export function aiErrorResponse(c: Context<Env>, error: unknown) {
  if (!(error instanceof AiError)) throw error;
  // 只记录类型与 Cloudflare 返回的文字，不记录令牌与原稿内容。
  console.warn(JSON.stringify({ message: "ai request failed", kind: error.kind, detail: error.message.slice(0, 200) }));
  return c.json({ error: "ai_unavailable", kind: error.kind }, 502);
}

// AI 设置。挂在 /api/admin 下，受 session 保护。
export function createAiRoutes() {
  const app = new Hono<Env>();

  app.get("/settings/ai", async (c) => c.json(await getAiStatus(c.get("deps"))));

  app.put("/settings/ai", async (c) => {
    const deps = c.get("deps");
    const body = await c.req.json().catch(() => null);
    if (typeof body?.enabled !== "boolean") return c.json({ error: "invalid_body" }, 400);
    if (!deps.ai) return c.json({ error: "ai_not_configured" }, 503);
    const now = new Date();
    await deps.db
      .insert(settings)
      .values({ key: AI_ENABLED_KEY, value: body.enabled, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: body.enabled, updatedAt: now } });
    return c.json(await getAiStatus(deps));
  });

  // 测试连接：用一道与原稿无关的小题调用 clef，开关关闭时也可以测试。
  app.post("/settings/ai/check", async (c) => {
    const { ai } = c.get("deps");
    if (!ai) return c.json({ error: "ai_not_configured" }, 503);
    try {
      const result = await ai.run<{ answers?: Record<string, { choice?: string }> }>("clef", {
        state: "第一章 开端",
        questions: {
          q: { type: "choice", instructions: "这一行是不是小说的章节标题？", criteria: { yes: "是章节标题", no: "不是章节标题" } },
        },
      });
      if (!result?.answers?.q?.choice) throw new AiError("unavailable", "unexpected clef response");
      return c.json({ ok: true, mode: ai.mode });
    } catch (error) {
      return aiErrorResponse(c, error);
    }
  });

  return app;
}
