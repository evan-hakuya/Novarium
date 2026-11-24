import { ChapterBrowser, ChapterText } from "@/components/chapter-browser";
import { chapterText, type ProcessedVersion } from "@/lib/process";

/** 浏览本地整理结果的章节与正文。章节数或正文大小变化时回到第一章。 */
export function PreviewBrowser({ version }: { version: ProcessedVersion }) {
  return (
    <ChapterBrowser
      key={version.chapters.length + ":" + version.text.byteLength}
      chapters={version.chapters}
      renderContent={(c) => <ChapterText text={chapterText(version.text, version.chapters[c.order]!)} />}
    />
  );
}
