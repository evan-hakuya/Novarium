// 用本机的小说样本评测整理规则：每本书的章节数、作者公告、分卷、各类章节异常与可疑行，并与基线比较。
// 用法见 docs/agents/import-samples.md。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_PROCESS_OPTIONS, findCandidateLines, findNumberAnomalies, processManuscript } from "../src/index";

const DIR = process.env.NOVARIUM_SAMPLES;
const BASELINE = DIR && join(DIR, "baseline.json");
/** 每本书最多列出多少条有变化的章节标题。 */
const MAX_DIFF = 30;

interface Result {
  chapters: number;
  notices: number;
  volumes: number;
  outOfOrder: number;
  missing: number;
  duplicate: number;
  numberTypo: number;
  sectionReset: number;
  suspicious: number;
  /** 每章一行：`标题 | 序号 | 卷`，作者公告前加「公告 」。 */
  titles: string[];
}

async function evaluate(bytes: Uint8Array): Promise<Result> {
  const { text, chapters } = await processManuscript(bytes, DEFAULT_PROCESS_OPTIONS);
  const anomalies = findNumberAnomalies(chapters);
  const count = (kind: string) => anomalies.filter((a) => a.kind === kind).length;
  return {
    chapters: chapters.length,
    notices: chapters.filter((c) => c.notice).length,
    volumes: new Set(chapters.map((c) => c.volume).filter(Boolean)).size,
    outOfOrder: count("outOfOrder"),
    missing: count("missing"),
    duplicate: count("duplicate"),
    numberTypo: count("numberTypo"),
    sectionReset: count("sectionReset"),
    suspicious: findCandidateLines(text, DEFAULT_PROCESS_OPTIONS).filter((c) => c.suspicious).length,
    titles: chapters.map((c) => `${c.notice ? "作者公告 " : ""}${c.title} | ${c.number ?? "-"} | ${c.volume ?? "-"}`),
  };
}

/** 两份标题列表的差异：基线有、现在没有的记为 -，现在有、基线没有的记为 +。按出现次数比较。 */
function diffTitles(before: string[], after: string[]): string[] {
  const left = new Map<string, number>();
  for (const t of before) left.set(t, (left.get(t) ?? 0) + 1);
  const added: string[] = [];
  for (const t of after) {
    const n = left.get(t) ?? 0;
    if (n > 0) left.set(t, n - 1);
    else added.push(`+ ${t}`);
  }
  const removed = [...left].flatMap(([t, n]) => Array.from({ length: n }, () => `- ${t}`));
  return [...removed, ...added];
}

test("diffTitles 按出现次数比较", () => {
  expect(diffTitles(["a", "a", "b"], ["a", "c"])).toEqual(["- a", "- b", "+ c"]);
});

test.skipIf(!DIR || !existsSync(DIR))("samples", async () => {
  const files = readdirSync(DIR!).filter((f) => f.endsWith(".txt")).sort();
  expect(files.length).toBeGreaterThan(0);
  const baseline: Record<string, Result> = existsSync(BASELINE!) ? JSON.parse(readFileSync(BASELINE!, "utf8")) : {};
  const current: Record<string, Result> = {};
  const rows: string[] = [];
  let changed = 0;
  let keys: string[] = [];
  for (const file of files) {
    const r = (current[file] = await evaluate(new Uint8Array(readFileSync(join(DIR!, file)))));
    const b = baseline[file];
    const { titles, ...counts } = r;
    const countKeys = Object.keys(counts) as (keyof typeof counts)[];
    keys = countKeys;
    const moved = (k: keyof typeof counts) => !!b && b[k] !== r[k];
    rows.push([file, ...countKeys.map((k) => (moved(k) ? `${b![k]}→${r[k]}` : String(r[k])))].join("\t"));
    const diff = b ? diffTitles(b.titles, titles) : [];
    if (!b || diff.length || countKeys.some(moved)) changed++;
    if (diff.length) rows.push(...diff.slice(0, MAX_DIFF).map((d) => `    ${d}`), ...(diff.length > MAX_DIFF ? [`    …共 ${diff.length} 条`] : []));
  }
  // 基线里有、样本目录里已经没有的书。
  for (const file of Object.keys(baseline).filter((f) => !files.includes(f))) {
    rows.push(`- ${file}（已不在样本目录中）`);
    changed++;
  }
  const header = ["file", ...keys].join("\t");
  console.log([header, ...rows, `${changed} 本与基线不同${existsSync(BASELINE!) ? "" : "（还没有基线）"}`].join("\n"));
  if (process.env.UPDATE_BASELINE) writeFileSync(BASELINE!, JSON.stringify(current, null, 1));
});
