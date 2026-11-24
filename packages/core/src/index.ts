// 整理引擎：把原稿整理成版本（解码、清洗、分章）。纯 TypeScript，不依赖平台。
export { DEFAULT_PROCESS_OPTIONS, type ProcessOptions } from "./options";
export { decodeManuscript } from "./decode";
export { cleanText } from "./clean";
export {
  checkChapterPattern,
  splitChapters,
  PREFACE_TITLE,
  WHOLE_BOOK_TITLE,
  type ChapterDraft,
  type SplitOptions,
} from "./split";
export { processManuscript, type VersionDraft } from "./process";
