import { and, desc, eq, gt, lt } from "drizzle-orm";
import type { AppDeps } from "./app";
import { loginFailures } from "./db/schema";

/** 统计登录失败次数的时间窗口。 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** 同一来源 IP 在窗口内允许的失败次数。 */
export const LOGIN_IP_LIMIT = 5;
/** 整个书库在窗口内允许的失败次数，防止换 IP 绕过单 IP 限制。 */
export const LOGIN_GLOBAL_LIMIT = 50;

type Db = AppDeps["db"];

export type LoginBlock = { scope: "ip" | "global"; retryAfterSeconds: number };

/**
 * 窗口内倒数第 limit 次失败何时移出窗口；失败次数不足 limit 时返回 null。
 * 被限制期间的请求不记为失败，所以限制在这条记录移出窗口时解除。
 */
async function blockedUntil(db: Db, limit: number, ip: string | null, now: number): Promise<number | null> {
  const inWindow = gt(loginFailures.createdAt, new Date(now - LOGIN_WINDOW_MS));
  const row = await db
    .select({ createdAt: loginFailures.createdAt })
    .from(loginFailures)
    .where(ip === null ? inWindow : and(eq(loginFailures.ip, ip), inWindow))
    .orderBy(desc(loginFailures.createdAt))
    .limit(1)
    .offset(limit - 1)
    .get();
  return row ? row.createdAt.getTime() + LOGIN_WINDOW_MS : null;
}

/** 这个 IP 现在能否尝试登录；不能时返回限制范围与剩余等待秒数。 */
export async function checkLoginBlock(db: Db, ip: string, now = Date.now()): Promise<LoginBlock | null> {
  const rules = [
    ["ip", LOGIN_IP_LIMIT, ip],
    ["global", LOGIN_GLOBAL_LIMIT, null],
  ] as const;
  for (const [scope, limit, key] of rules) {
    const until = await blockedUntil(db, limit, key, now);
    if (until !== null && until > now) return { scope, retryAfterSeconds: Math.ceil((until - now) / 1000) };
  }
  return null;
}

/** 记录一次登录失败，并删除已经移出窗口的旧记录。 */
export async function recordLoginFailure(db: Db, ip: string, now = Date.now()): Promise<void> {
  await db.insert(loginFailures).values({ ip, createdAt: new Date(now) });
  await db.delete(loginFailures).where(lt(loginFailures.createdAt, new Date(now - LOGIN_WINDOW_MS)));
}

/** 登录成功后清零这个 IP 的失败计数。全书库计数中这个 IP 的记录也一并删除。 */
export async function clearLoginFailures(db: Db, ip: string): Promise<void> {
  await db.delete(loginFailures).where(eq(loginFailures.ip, ip));
}
