import type { ProcessOptions } from "./options";
import { customTitleMatcher } from "./split";
import { formatNovelText } from "./vendor/novel-processor/novel";

/** 按整理选项清洗解码后的文本：统一换行、去杂质与广告、整理段落和章节标题格式。 */
export function cleanText(text: string, options: ProcessOptions): Promise<string> {
  return formatNovelText(text, {
    enableChapterSplit: options.splitInlineChapterTitles,
    filterText: options.filterWords.join("\n"),
    maxFilterLineLength: options.filterMaxLineLength,
    enableLineEndNumbers: options.removeLineEndNumbers,
    enableParagraphSplit: options.paragraphSplit,
    smartLineBreak: options.smartLineBreak,
    enableTrim: options.trimLines,
    mergeDuplicateChapterTitles: options.mergeDuplicateChapterTitles,
    removeDuplicateLines: options.removeDuplicateLines,
    enableIndent: options.indent,
    specialStart: options.specialStart,
    // 本书正则命中的标题行不与正文合并，否则分章时找不到它。
    isExtraTitleLine: customTitleMatcher(options.chapterPattern) ?? undefined,
  });
}
