import type { Context, Env, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

// 所有者登录：密码来自部署时设置的 OWNER_PASSWORD，登录后发放签名 session cookie。
// session 不落库：cookie 内容是到期时间加 HMAC 签名，签名密钥由 OWNER_PASSWORD 派生，
// 因此修改 OWNER_PASSWORD 会让所有已发放的 session 失效。

export const SESSION_COOKIE = "novarium_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

async function hmacKey(ownerPassword: string) {
  const secret = await crypto.subtle.digest("SHA-256", encoder.encode(`novarium-session:${ownerPassword}`));
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(ownerPassword: string, payload: string): Promise<Uint8Array> {
  const key = await hmacKey(ownerPassword);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

// 等长摘要的常数时间比较，避免按字节提前返回泄露时间差。
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
};

export async function verifyPassword(ownerPassword: string, candidate: string): Promise<boolean> {
  // 两边都先做 HMAC，再比较等长摘要，比较时间与密码长度无关。
  const [expected, actual] = await Promise.all([
    sign(ownerPassword, `password:${ownerPassword}`),
    sign(ownerPassword, `password:${candidate}`),
  ]);
  return equalBytes(expected, actual);
}

export async function createSessionValue(ownerPassword: string, now = Date.now()): Promise<string> {
  const expiresAt = String(now + SESSION_TTL_MS);
  return `${expiresAt}.${toHex(await sign(ownerPassword, `session:${expiresAt}`))}`;
}

export async function isValidSession(ownerPassword: string, value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const [expiresAt, sig] = value.split(".");
  if (!expiresAt || !sig || !/^\d+$/.test(expiresAt) || Number(expiresAt) <= now) return false;
  const actual = fromHex(sig);
  if (!actual) return false;
  return equalBytes(await sign(ownerPassword, `session:${expiresAt}`), actual);
}

export function setSessionCookie(c: Context, value: string) {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

// 保护所有者才能访问的 API。未设置 OWNER_PASSWORD 时，所有者 API 一律拒绝。
export function requireOwner<E extends Env>(
  getOwnerPassword: (c: Context<E>) => string | undefined,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const ownerPassword = getOwnerPassword(c);
    if (!ownerPassword || !(await isValidSession(ownerPassword, getCookie(c, SESSION_COOKIE)))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
