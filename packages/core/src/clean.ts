import type { ProcessOptions } from "./options";
import { isNoticeLine, lineOverrideMap } from "./line-review";
import { customTitleMatcher, isVolumeTitleLine } from "./split";
import { formatNovelText } from "./vendor/novel-processor/novel";

/** 按整理选项清洗解码后的文本：统一换行、去杂质与广告、整理段落和章节标题格式。 */
export function cleanText(text: string, options: ProcessOptions): Promise<string> {
  const custom = customTitleMatcher(options.chapterPattern);
  // AI 复核设为章节或卷的行，同样不能与正文合并。
  const forcedTitles = new Set(
    [...lineOverrideMap(options.lineOverrides)].filter(([, kind]) => kind !== "body").map(([id]) => id.slice(id.indexOf("|") + 1)),
  );
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
    // 本书正则命中的标题行与卷标题行不与正文合并，否则分章时找不到它们。疑似作者公告的短行也不合并，留给 AI 判断。
    isExtraTitleLine: (line) => isVolumeTitleLine(line) || !!custom?.(line) || forcedTitles.has(line.trim()) || isNoticeLine(line),
  });
}
