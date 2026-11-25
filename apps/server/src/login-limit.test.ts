import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_GLOBAL_LIMIT, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS } from "./login-limit";
import * as schema from "./db/schema";
import { createTestApp, ORIGIN, PASSWORD } from "./test-app";

describe("登录失败次数限制", () => {
  let app: ReturnType<typeof createTestApp>;
  const start = new Date("2026-11-25T00:00:00Z").getTime();
  let logs: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    app = createTestApp();
    logs = [];
    vi.spyOn(console, "warn").mockImplementation((line: string) => void logs.push(line));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const login = (password: string, ip = "203.0.113.1") =>
    app.fetchApi("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-test-ip": ip },
      body: JSON.stringify({ password }),
    });
  const fail = async (times: number, ip?: string) => {
    for (let i = 0; i < times; i++) expect((await login("wrong", ip)).status).toBe(401);
  };

  it("同一 IP 失败 5 次后返回 429，密码正确也不行，窗口结束后恢复", async () => {
    await fail(LOGIN_IP_LIMIT - 1);
    vi.setSystemTime(start + 60_000);
    await fail(1);

    const blocked = await login(PASSWORD);
    expect(blocked.status).toBe(429);
    // 第一次失败在 start，15 分钟后移出窗口；现在是 start + 1 分钟。
    expect(blocked.headers.get("retry-after")).toBe(String((LOGIN_WINDOW_MS - 60_000) / 1000));
    expect(await blocked.json()).toEqual({ error: "too_many_attempts", retryAfterSeconds: 840 });
    expect((await login(PASSWORD, "198.51.100.7")).status).toBe(200);

    vi.setSystemTime(start + LOGIN_WINDOW_MS + 1);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it("登录成功后清零该 IP 的失败计数", async () => {
    await fail(LOGIN_IP_LIMIT - 1);
    expect((await login(PASSWORD)).status).toBe(200);
    await fail(LOGIN_IP_LIMIT - 1);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it("全书库失败 50 次后，所有 IP 都暂停到窗口结束", async () => {
    for (let i = 0; i < LOGIN_GLOBAL_LIMIT; i++) await fail(1, `10.0.${Math.floor(i / 4)}.${i % 4}`);
    const res = await login(PASSWORD, "192.0.2.99");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBe(LOGIN_WINDOW_MS / 1000);
    vi.setSystemTime(start + LOGIN_WINDOW_MS + 1);
    expect((await login(PASSWORD, "192.0.2.99")).status).toBe(200);
  });

  it("删除移出窗口的记录；日志不含密码", async () => {
    await fail(3);
    vi.setSystemTime(start + LOGIN_WINDOW_MS + 1);
    await fail(1);
    expect(await app.deps.db.select().from(schema.loginFailures)).toHaveLength(1);

    await fail(LOGIN_IP_LIMIT - 1);
    await login(PASSWORD);
    const parsed = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.filter((l) => l.message === "login failed")).toHaveLength(3 + 1 + (LOGIN_IP_LIMIT - 1));
    expect(parsed.at(-1)).toMatchObject({ message: "login rate limited", ip: "203.0.113.1", scope: "ip" });
    expect(logs.join("\n")).not.toMatch(/wrong|test-password/);
  });
});
