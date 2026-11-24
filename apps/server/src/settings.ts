import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { DEFAULT_PROCESS_OPTIONS, parseProcessOptions, type ProcessOptions } from "@novarium/core/validate";
import type { AppDeps } from "./app";
import { settings } from "./db/schema";

type Env = { Variables: { deps: AppDeps } };

/** 默认整理选项（含全书库共用的过滤词表与过滤阈值）在 settings 表中的键。 */
const PROCESS_OPTIONS_KEY = "process_options";

/** 读取默认整理选项。未保存过或已损坏时使用内置默认值。章节正则按书设置，默认值中总是 null。 */
export async function getDefaultProcessOptions(db: AppDeps["db"]): Promise<ProcessOptions> {
  const row = await db.select().from(settings).where(eq(settings.key, PROCESS_OPTIONS_KEY)).get();
  const parsed = row ? parseProcessOptions(row.value) : null;
  return parsed?.ok ? { ...parsed.options, chapterPattern: null } : { ...DEFAULT_PROCESS_OPTIONS };
}

// 书库设置。挂在 /api/admin 下，受 session 保护。
export function createSettingsRoutes() {
  const app = new Hono<Env>();

  app.get("/settings/process-options", async (c) => {
    return c.json({ options: await getDefaultProcessOptions(c.get("deps").db) });
  });

  app.put("/settings/process-options", async (c) => {
    const { db } = c.get("deps");
    const body = await c.req.json().catch(() => null);
    const parsed = parseProcessOptions(body?.options);
    if (!parsed.ok) return c.json({ error: "invalid_options", details: [parsed.error] }, 400);
    const options = { ...parsed.options, chapterPattern: null };
    const now = new Date();
    await db
      .insert(settings)
      .values({ key: PROCESS_OPTIONS_KEY, value: options, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: options, updatedAt: now } });
    return c.json({ options });
  });

  return app;
}
