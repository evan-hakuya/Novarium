import { Hono } from "hono";
import { AiError } from "./ai";
import { aiErrorResponse, requireAi } from "./ai-routes";
import type { AppDeps } from "./app";
import { MAX_INTRO_LENGTH } from "./metadata";

type Env = { Variables: { deps: AppDeps } };

/** 原稿开头的字数上限。前端发送约 3,000 字，这里留一些余量（ADR 0007）。 */
export const MAX_HEAD_CHARS = 4000;

const FIELDS = {
  title: { type: "text", instructions: "小说的书名。不含书名号、括号里的附注（如完结、番外说明）和作者。没有就返回 null。" },
  author: { type: "text", instructions: "小说作者的笔名。不含「作者：」前缀。没有就返回 null。" },
  intro: { type: "text", instructions: "作者写的作品简介原文，不含「简介：」标签、网站广告和正文。没有就返回 null。" },
} as const;

export interface MetadataSuggestion {
  title: string | null;
  author: string | null;
  intro: string | null;
}

type ClairicAnswers = { answers?: Record<string, { value?: unknown } | undefined> };

/** 取出 clairic 的回答。空值、非字符串或超过书库长度上限的值都当作没有建议。简介去掉每行的首尾空白（原稿常用全角空格缩进）。 */
export function parseMetadataAnswers(result: ClairicAnswers | null | undefined): MetadataSuggestion {
  const pick = (key: keyof MetadataSuggestion, max: number, normalize = (s: string) => s.trim()) => {
    const value = result?.answers?.[key]?.value;
    if (typeof value !== "string") return null;
    const text = normalize(value);
    return text && text.length <= max ? text : null;
  };
  const lines = (s: string) => s.split("\n").map((line) => line.trim()).join("\n").trim();
  return { title: pick("title", 200), author: pick("author", 100), intro: pick("intro", MAX_INTRO_LENGTH, lines) };
}

// AI 识别元数据。挂在 /api/admin 下，受 session 保护。
export function createAiMetadataRoutes() {
  const app = new Hono<Env>();

  app.post("/ai/metadata", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { fileName?: unknown; head?: unknown } | null;
    const fileName = body?.fileName;
    const head = body?.head;
    if (typeof fileName !== "string" || fileName.length > 255 || typeof head !== "string" || [...head].length > MAX_HEAD_CHARS) {
      return c.json({ error: "invalid_body" }, 400);
    }
    const ai = await requireAi(c);
    if (ai instanceof Response) return ai;
    try {
      const result = await ai.run<ClairicAnswers>("clairic", { state: `文件名：${fileName}\n文件开头：\n${head}`, fields: FIELDS });
      if (!result?.answers) throw new AiError("unavailable", "unexpected clairic response");
      return c.json({ suggestion: parseMetadataAnswers(result) });
    } catch (error) {
      return aiErrorResponse(c, error);
    }
  });

  return app;
}
