// 整理选项：一次整理所用的全部设置。每个版本记录生成它的整理选项。
export interface ProcessOptions {
  /** 根据中文标点重新合并错误断开的段落。 */
  smartLineBreak: boolean;
  /** 段首加两个全角空格（仅在 smartLineBreak 打开时生效）。 */
  indent: boolean;
  /** 删除每行首尾的空白。 */
  trimLines: boolean;
  /** 把与正文挤在同一行的章节标题拆到独立的一行。 */
  splitInlineChapterTitles: boolean;
  /** 合并相邻或隔一行重复出现的同章标题。 */
  mergeDuplicateChapterTitles: boolean;
  /** 删除相邻的重复行。 */
  removeDuplicateLines: boolean;
  /** 把过长的段落按句子拆短。 */
  paragraphSplit: boolean;
  /** 删除长行末尾的数字（常见于抓取残留的页码）。 */
  removeLineEndNumbers: boolean;
  /** 以此文本开头的行强制独立成段，例如书名。空字符串表示不启用。 */
  specialStart: string;
  /** 过滤词表：删除含这些词的行。 */
  filterWords: string[];
  /** 长度超过此值的行不受过滤词表影响，用于保护正文；0 表示不豁免。 */
  filterMaxLineLength: number;
  /** 本书的章节标题正则；为 null 时使用内置规则。 */
  chapterPattern: string | null;
}

export const DEFAULT_PROCESS_OPTIONS: Readonly<ProcessOptions> = Object.freeze({
  smartLineBreak: true,
  indent: true,
  trimLines: true,
  splitInlineChapterTitles: true,
  mergeDuplicateChapterTitles: true,
  removeDuplicateLines: true,
  paragraphSplit: false,
  removeLineEndNumbers: false,
  specialStart: "",
  filterWords: [],
  filterMaxLineLength: 0,
  chapterPattern: null,
});
