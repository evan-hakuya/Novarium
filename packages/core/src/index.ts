// 整理引擎：把原稿整理成版本（解码、清洗、分章）。纯 TypeScript，不依赖平台。
export { DEFAULT_PROCESS_OPTIONS, parseProcessOptions, type ProcessOptions } from "./options";
export { decodeManuscript } from "./decode";
export { manuscriptHead } from "./head";
export * from "./line-review";
export { cleanText } from "./clean";
export {
  checkChapterPattern,
  findCandidateLines,
  splitChapters,
  PREFACE_TITLE,
  WHOLE_BOOK_TITLE,
  type ChapterDraft,
  type SplitOptions,
} from "./split";
export { processManuscript, type VersionDraft } from "./process";
export {
  applyNumberFixes,
  findNumberAnomalies,
  isFixable,
  needsNoAction,
  parseOutOfOrderKey,
  type NumberAnomaly,
  type NumberAnomalyKind,
} from "./numbering";
export { validateChapterIndex, MAX_CHAPTERS } from "./validate";
