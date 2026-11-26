import { expect, test } from "@playwright/test";
import { OWNER_PASSWORD } from "./env.ts";
import { manuscript } from "./manuscript.ts";

const CHAPTERS = 1200;
const EXTRAS = 3;
/** 原稿中跳过的章节序号，用来检查异常面板。 */
const MISSING = 50;
/** 应用本书章节正则后重新整理并渲染预览的时间上限。 */
const PATTERN_BUDGET_MS = 10_000;

test("imports a large manuscript", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/import");
  await page.locator("#file").setInputFiles({
    name: "E2E 测试书.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(manuscript(CHAPTERS, EXTRAS, MISSING)),
  });
  await expect(page.getByText(`${CHAPTERS} 章 · 整理后`)).toBeVisible({ timeout: 60_000 });

  await test.step("no scrape button without a DaoSearch key", async () => {
    await expect(page.getByRole("button", { name: "刮削", exact: true })).toHaveCount(0);
  });

  await test.step("book chapter pattern stays within budget", async () => {
    await page.getByText("整理选项").click();
    await page.locator("#chapter-pattern").fill("^个人番外");
    const started = Date.now();
    await page.getByRole("button", { name: "应用" }).click();
    await expect(page.getByText(`${CHAPTERS + EXTRAS} 章 · 整理后`)).toBeVisible({ timeout: PATTERN_BUDGET_MS });
    test.info().annotations.push({ type: "pattern-ms", description: String(Date.now() - started) });
  });

  await test.step("switching chapters scrolls the text back to the top", async () => {
    const article = page.locator("article[data-chapter-scroll]");
    await page.getByRole("button", { name: "第5章 测试", exact: true }).click();
    await article.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect.poll(() => article.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "第6章 测试", exact: true }).click();
    await expect(article.getByRole("heading", { name: "第6章 测试" })).toBeVisible();
    await expect.poll(() => article.evaluate((el) => el.scrollTop)).toBe(0);
  });

  await test.step("phone width shows one column without horizontal overflow", async () => {
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    const article = page.locator("article[data-chapter-scroll]");
    const width = () => page.evaluate(() => document.documentElement.scrollWidth);
    expect(await width()).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "← 章节列表" }).click();
    await expect(article).toBeHidden();
    // 返回列表时停在刚才看的那一章。
    await expect(page.getByRole("button", { name: "第6章 测试", exact: true })).toBeInViewport();
    expect(await width()).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "第7章 测试", exact: true }).click();
    await expect(article.getByRole("heading", { name: "第7章 测试" })).toBeVisible();
    await expect(page.getByRole("button", { name: "第7章 测试", exact: true })).toBeHidden();
    await page.setViewportSize(size);
  });

  await test.step("anomaly panel names each row and lists only present types", async () => {
    await expect(page.getByRole("checkbox", { name: `缺号：缺少第 ${MISSING} 章` })).toBeVisible();
    await expect(page.getByRole("tab", { name: "缺号 1" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^乱序/ })).toHaveCount(0);
    await page.getByRole("button", { name: "忽略", exact: true }).click();
  });

  await page.locator("#title").fill("E2E 测试书");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await expect(page).toHaveURL(/\/books\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByText("E2E 测试书").first()).toBeVisible();
});
