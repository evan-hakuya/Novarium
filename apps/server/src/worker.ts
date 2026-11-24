import { drizzle } from "drizzle-orm/d1";
import { createApi } from "./app";
import * as schema from "./db/schema";
import { createR2Storage } from "./storage/r2";

// Cloudflare Workers 入口。`/api/*` 由 Worker 处理，其余路径由静态资源（SPA）处理。
const api = createApi((c) => {
  const env = c.env as Env;
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
  };
});

export default {
  fetch(request, env, ctx) {
    return api.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
