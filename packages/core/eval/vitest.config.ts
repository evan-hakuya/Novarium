import { defineConfig } from "vitest/config";

// 样本评测不在 `pnpm test` 中运行：样本有版权，不进仓库，只在本机的样本目录里。
export default defineConfig({
  // 评测结果打印在控制台，通过时也要显示。
  test: { include: ["eval/**/*.eval.ts"], testTimeout: 600_000, silent: false },
});
