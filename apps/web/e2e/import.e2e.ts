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
    await page.getByText("章节正则（高级）").click();
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

  await test.step("anomaly panel names each row; a missing number does not block import", async () => {
    await expect(page.getByRole("checkbox", { name: `缺号：缺少第 ${MISSING} 章` })).toBeVisible();
    await expect(page.getByRole("tab", { name: "缺号 1" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^乱序/ })).toHaveCount(0);
    await expect(page.getByText("1 处缺号或重复编号待检查，不影响继续")).toBeVisible();
    await expect(page.getByText("选中一种类型，查看它的处理方式。")).toBeVisible();
    await page.getByRole("tab", { name: "缺号 1" }).click();
    await expect(page.getByText("无法自动修复，也不挡住导入", { exact: false })).toBeVisible();
  });

  await test.step("a chapter link in the anomaly panel reveals and focuses that chapter", async () => {
    const panel = page.locator("section").filter({ hasText: "章节异常" });
    const heading = page.locator("article[data-chapter-scroll] h2");
    const size = page.viewportSize()!;
    for (const width of [size.width, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : size.height });
      for (let i = 0; i < 2; i++) {
        // 第二次跳到已选中的章节，且先把正文读到中间，也要回到标题。
        await page.locator("article[data-chapter-scroll]").evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
        await page.evaluate(() => window.scrollTo(0, 0));
        await panel.getByRole("button", { name: `第${MISSING - 1}章 测试`, exact: true }).click();
        await expect(heading).toHaveText(`第${MISSING - 1}章 测试`);
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport();
      }
    }
    await page.setViewportSize(size);
  });

  await test.step("the page follows the import steps", async () => {
    const steps = page.getByRole("heading", { level: 3 }).filter({ hasText: /^\d/ });
    await expect(steps).toHaveText(["1原稿", "2书目信息", "3检查章节", "4确认导入"]);
  });

  await page.locator("#title").fill("");
  const importButton = page.getByRole("button", { name: "导入这本书", exact: true });
  await expect(importButton).toBeDisabled();
  await expect(importButton).toHaveAccessibleDescription(/填写书名后才能导入/);
  await page.locator("#title").fill("E2E 测试书");
  await importButton.click();
  await expect(page).toHaveURL(/\/books\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByText("E2E 测试书").first()).toBeVisible();
  await expect(page.getByText("当前版本有 1 处缺号未忽略")).toBeVisible();
});
