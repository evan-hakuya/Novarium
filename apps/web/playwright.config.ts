import { defineConfig, devices } from "@playwright/test";
import { OWNER_PASSWORD, PORT } from "./e2e/env.ts";

// 每次运行用新的临时数据目录和独立端口，不碰 dev:bg 的本地书库；
// --local 关掉 AI 远程绑定，--var 注入测试密码，因此不需要 .dev.vars 和 Cloudflare 登录。
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      'D="$(mktemp -d)"',
      'pnpm exec wrangler d1 migrations apply DB --local --persist-to "$D"',
      `pnpm exec wrangler dev --local --port ${PORT} --persist-to "$D" --var OWNER_PASSWORD:${OWNER_PASSWORD}`,
    ].join(" && "),
    cwd: "../server",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
