import { cleanText } from "./clean";
import { decodeManuscript } from "./decode";
import type { ProcessOptions } from "./options";
import { reorderTextByNumber, splitChapters, type ChapterDraft } from "./split";

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
  // 重排移动的是整段章节（含标题行），重排后再分章，版本正文与章节索引的顺序始终一致。
  if (options.reorderByNumber) text = reorderTextByNumber(text, options);
  return { text, chapters: splitChapters(text, options) };
}
