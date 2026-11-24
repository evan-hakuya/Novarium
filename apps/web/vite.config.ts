import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ES 模块格式的 Worker 才能按需拆分 jschardet，UTF-8 原稿不必下载它。
  worker: { format: "es" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    // 开发时把 API 请求转发给 `wrangler dev`。
    proxy: { "/api": "http://localhost:8787" },
  },
});
