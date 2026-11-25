import { drizzle } from "drizzle-orm/d1";
import { createApi, type AppDeps } from "./app";
import { cleanupStaleUploads } from "./cleanup";
import * as schema from "./db/schema";
import { createR2Storage } from "./storage/r2";

function createDeps(env: Env): AppDeps {
  const db = drizzle(env.DB, { schema });
  return {
    runtime: "cloudflare",
    db,
    storage: createR2Storage(env.BOOKS),
    ownerPassword: env.OWNER_PASSWORD || undefined,
    // D1 的 batch 在一个事务中执行。
    batch: async (queries) => {
      await db.batch(queries);
    },
    // Cloudflare 在边缘写入的真实来源 IP，客户端无法伪造。
    clientIp: (c) => c.req.header("cf-connecting-ip"),
  };
}

// Cloudflare Workers 入口。`/api/*` 由 Worker 处理，其余路径由静态资源（SPA）处理。
const api = createApi((c) => createDeps(c.env as Env));

export default {
  fetch(request, env, ctx) {
    return api.fetch(request, env, ctx);
  },
  // Cron Trigger：定时清理导入失败留下的孤立文件。
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupStaleUploads(createDeps(env)));
  },
} satisfies ExportedHandler<Env>;
