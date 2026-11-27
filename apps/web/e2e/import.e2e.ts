import { expect, test } from "@playwright/test";
import { OWNER_PASSWORD } from "./env.ts";
import { manuscript } from "./manuscript.ts";

const CHAPTERS = 1200;
/** 原稿中的作者公告章节数（见 manuscript.ts）。 */
const NOTICES = 1;
const EXTRAS = 3;
/** 原稿中跳过的章节序号，用来检查异常面板。 */
const MISSING = 50;
/** 应用本书章节正则后重新整理并渲染预览的时间上限。 */
const PATTERN_BUDGET_MS = 10_000;

const login = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.locator("#password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/);
};

test("imports a large manuscript", async ({ page }) => {
  await login(page);

  await page.goto("/import");
  await page.locator("#file").setInputFiles({
    name: "E2E 测试书.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(manuscript(CHAPTERS, EXTRAS, MISSING)),
  });
  await expect(page.getByText(`${CHAPTERS + NOTICES} 章 · 整理后`)).toBeVisible({ timeout: 60_000 });

  await test.step("author notices are tagged chapters", async () => {
    await expect(page.getByRole("button", { name: "上架感言 作者公告", exact: true })).toBeVisible();
  });

  await test.step("no scrape button without a DaoSearch key", async () => {
    await expect(page.getByRole("button", { name: "刮削", exact: true })).toHaveCount(0);
  });

  await test.step("book chapter pattern stays within budget", async () => {
    await page.getByText("整理选项").click();
    await page.getByText("章节正则（高级）").click();
    await page.locator("#chapter-pattern").fill("^个人番外");
    const started = Date.now();
    await page.getByRole("button", { name: "应用" }).click();
    await expect(page.getByText(`${CHAPTERS + NOTICES + EXTRAS} 章 · 整理后`)).toBeVisible({ timeout: PATTERN_BUDGET_MS });
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

  await test.step("an empty author explains how to fill it", async () => {
    await page.locator("#author").fill("");
    await expect(page.locator("#author-hint")).toBeVisible();
    await expect(page.locator("#author")).toHaveAttribute("aria-describedby", "author-hint");
    // 没有刮削源密钥也没有 AI 时，不提到这两个入口。
    await expect(page.locator("#author-hint")).not.toContainText("刮削");
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
  // 作者公告随章节索引保存，书详情页同样标出。
  await expect(page.getByRole("button", { name: "上架感言 作者公告", exact: true })).toBeVisible();
});

test("an AI review item jumps to and highlights its line", async ({ page }) => {
  const LINE = "请假一天";
  // 第 2 章很长（分成多页），被复核的行在第 2 页。
  const long = Array.from({ length: 800 }, (_, k) => `　　这是第2章的第${k + 1}段，用来测试跳转到异常所在的行。`);
  const text = ["第1章 测试", "　　正文。", "第2章 测试", ...long, LINE, "　　后面的正文。", "第3章 测试", "　　正文。"].join("\n");
  // 只拦截 AI 接口：部署看起来配置并开启了 AI；这一行判为作者公告，置信度不够自动修复，留作待处理。
  await page.route("**/api/admin/settings/ai", (route) => route.fulfill({ json: { configured: true, mode: "rest", enabled: true } }));
  await page.route("**/api/admin/ai/lines", async (route) => {
    const { questions } = route.request().postDataJSON() as { questions: { id: string; line: string }[] };
    const results = Object.fromEntries(questions.filter((q) => q.line === LINE).map((q) => [q.id, { kind: "notice", confidence: 0.5 }]));
    await route.fulfill({ json: { results } });
  });
  await login(page);
  await page.goto("/import");
  await page.locator("#file").setInputFiles({ name: "跳转测试.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByText("3 章 · 整理后")).toBeVisible({ timeout: 60_000 });

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /^复核全部/ }).click();
  const panel = page.locator("section").filter({ hasText: "章节异常" });
  await expect(panel.getByText(`「${LINE}」`)).toBeVisible();

  const article = page.locator("article[data-chapter-scroll]");
  const mark = article.locator("mark[data-highlight]");
  for (let i = 0; i < 2; i++) {
    // 第二次：先翻回第 1 页再跳，也要回到高亮行所在的页。
    if (i === 1) await article.getByRole("button", { name: "上一页" }).click();
    await panel.getByRole("button", { name: "第2章 测试", exact: true }).click();
    await expect(mark).toHaveText(LINE);
    await expect(mark).toBeFocused();
    await expect(mark).toBeInViewport();
    await expect(article.getByText(/第 2 \/ \d 页/)).toBeVisible();
  }

  // 换到别的章节后不再高亮；切回来也从第 1 页开始，不再高亮。
  await page.getByRole("button", { name: "第3章 测试", exact: true }).first().click();
  await expect(mark).toHaveCount(0);
  await page.locator('ol button[data-order="1"]').click();
  await expect(article.getByText(/第 1 \/ \d 页/)).toBeVisible();
  await expect(mark).toHaveCount(0);
});

test("volumes fold their chapters and unfold on a jump", async ({ page }) => {
  // 第二卷缺第 2 章，异常面板可以跳到「第1章 雨夜」。
  const text = ["第一卷 风起", "第1章 开端", "　　正文。", "第2章 继续", "　　正文。", "第二卷 云涌", "第1章 雨夜", "　　正文。", "第3章 天明", "　　正文。"].join("\n");
  await login(page);
  await page.goto("/import");
  await page.locator("#file").setInputFiles({ name: "分卷测试.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByText("4 章 · 整理后")).toBeVisible({ timeout: 60_000 });

  const list = page.locator("ol").filter({ has: page.locator("[data-order]") });
  // 「第1章 雨夜」在缺号前，列表中带异常提示，按阅读顺序定位。
  const rainyNight = list.locator('button[data-order="2"]');
  const volume = list.getByRole("button", { name: /第二卷 云涌/ });
  await expect(volume).toHaveAttribute("aria-expanded", "true");
  await expect(volume).toContainText("2 章");
  await volume.click();
  await expect(volume).toHaveAttribute("aria-expanded", "false");
  await expect(rainyNight).toHaveCount(0);
  await expect(list.getByRole("button", { name: "第1章 开端", exact: true })).toBeVisible();
  // 收起的卷内有异常章节时，卷名行仍提示。
  await expect(volume).toContainText("⚠");

  // 跳到收起的卷中的章节时，这一卷自动展开。
  const panel = page.locator("section").filter({ hasText: "章节异常" });
  await panel.getByRole("button", { name: "第1章 雨夜", exact: true }).click();
  await expect(volume).toHaveAttribute("aria-expanded", "true");
  await expect(rainyNight).toBeVisible();
  await expect(page.locator("article[data-chapter-scroll] h2")).toHaveText("第1章 雨夜");
});
