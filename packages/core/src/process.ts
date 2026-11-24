import { cleanText } from "./clean";
import { decodeManuscript } from "./decode";
import type { ProcessOptions } from "./options";
import { applyNumberFixesToText, splitChapters, type ChapterDraft } from "./split";

/** 一次整理的结果：版本正文与章节索引。 */
export interface VersionDraft {
  /** 整理后的正文；按 UTF-8 编码后即为版本文件。 */
  text: string;
  chapters: ChapterDraft[];
}

/** 整理：从原稿字节生成一个版本。 */
export async function processManuscript(bytes: Uint8Array, options: ProcessOptions): Promise<VersionDraft> {
  const decoded = await decodeManuscript(bytes);
  let text = await cleanText(decoded, options);
  // 修复移动的是整段章节（含标题行），移动后再分章，版本正文与章节索引的顺序始终一致。
  if (options.numberFixes.length > 0) text = applyNumberFixesToText(text, options, options.numberFixes);
  return { text, chapters: splitChapters(text, options) };
}
