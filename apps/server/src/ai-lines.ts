import { Hono } from "hono";
import { AI_LINE_BATCH_SIZE, type LineKind } from "@novarium/core/validate";
import { AiError } from "./ai";
import { aiErrorResponse, requireAi } from "./ai-routes";
import type { AppDeps } from "./app";

type Env = { Variables: { deps: AppDeps } };

/** 一道题中每行的字数上限：题目只写前 50 字（docs/agents/workers-ai.md）。 */
const MAX_LINE_CHARS = 200;

export interface LineQuestion {
  id: string;
  prev: string;
  line: string;
  next: string;
  /** 本行与下一个非空行之间隔着空行。 */
  gap: boolean;
}

const CRITERIA = {
  chapter: "章节标题：一章正文的标题",
  volume: "卷名或篇名：其后紧跟若干章，用来分组",
  notice: "作者公告的标题，例如请假、感言、悬赏、更新说明，不属于故事正文",
  body: "正文内容的一行，例如对话、叙述、系统提示、图片",
} satisfies Record<LineKind, string>;

/** 题目里的一行：空行写成「(空行)」，全角空格写成 ␣，只取前 50 字。 */
const shown = (line: string) => (line.trim() ? [...line.replace(/\u3000/g, "␣")].slice(0, 50).join("") : "(空行)");

/** 实测准确率最高的题目格式（ADR 0007）：每题写出上一行、本行与下一个非空行。 */
export function buildClefInput(questions: readonly LineQuestion[]) {
  return {
    state: "这些行来自一本中文网络小说 TXT。␣ 表示全角空格缩进。",
    questions: Object.fromEntries(
      questions.map((q, i) => [
        `L${i}`,
        {
          type: "choice",
          instructions: `判断这一行属于哪一类。上一行：${shown(q.prev)}；本行：「${q.line.trim()}」；下一个非空行：${q.gap ? "(空行) " : ""}${shown(q.next)}`,
          criteria: CRITERIA,
        },
      ]),
    ),
  };
}

type ClefResult = { answers?: Record<string, { choice?: unknown; confidence?: unknown } | undefined> };

/** 取出每题的类别与置信度；回答缺失或不在选项中的题不返回。 */
export function parseClefAnswers(questions: readonly LineQuestion[], result: ClefResult | null | undefined) {
  const out: Record<string, { kind: LineKind; confidence: number }> = {};
  questions.forEach((q, i) => {
    const a = result?.answers?.[`L${i}`];
    const kind = a?.choice;
    const confidence = a?.confidence;
    if (typeof kind === "string" && kind in CRITERIA && typeof confidence === "number" && confidence >= 0 && confidence <= 1) {
      out[q.id] = { kind: kind as LineKind, confidence };
    }
  });
  return out;
}

function parseQuestions(value: unknown): LineQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > AI_LINE_BATCH_SIZE) return null;
  const ok = (s: unknown): s is string => typeof s === "string" && s.length <= MAX_LINE_CHARS;
  const ids = new Set<string>();
  for (const q of value as Record<string, unknown>[]) {
    if (!q || typeof q !== "object" || !ok(q.id) || !q.id || ids.has(q.id) || !ok(q.prev) || !ok(q.line) || !q.line.trim() || !ok(q.next) || typeof q.gap !== "boolean") {
      return null;
    }
    ids.add(q.id);
  }
  return value as LineQuestion[];
}

// AI 复核章节：判断一批候选行。挂在 /api/admin 下，受 session 保护。
export function createAiLineRoutes() {
  const app = new Hono<Env>();

  app.post("/ai/lines", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { questions?: unknown } | null;
    const questions = parseQuestions(body?.questions);
    if (!questions) return c.json({ error: "invalid_body" }, 400);
    const ai = await requireAi(c);
    if (ai instanceof Response) return ai;
    try {
      const result = await ai.run<ClefResult>("clef", buildClefInput(questions));
      if (!result?.answers) throw new AiError("unavailable", "unexpected clef response");
      return c.json({ results: parseClefAnswers(questions, result) });
    } catch (error) {
      return aiErrorResponse(c, error);
    }
  });

  return app;
}
