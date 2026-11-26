import type { ReactNode } from "react";
import type { BookDescription } from "@/api/books";
import { formatDate, formatFacet, formatReleased, formatWordCount, platformName, statusText } from "@/api/scrape";
import { Badge } from "@/components/ui/badge";

/** 书的描述字段（#42）。只列出有值的项；没有刮削也没有编辑过时不显示。 */
export function BookDescriptionView({ book }: { book: BookDescription }) {
  const rows: [string, ReactNode][] = [];
  const genre = [book.genre, book.subgenre].filter(Boolean).join(" / ");
  if (genre) rows.push(["分类", genre]);
  if (book.serialStatus) rows.push(["连载状态", statusText[book.serialStatus]]);
  if (book.aliases.length > 0) rows.push(["别名", book.aliases.join("、")]);
  if (book.authorEn) rows.push(["作者英文名", book.authorEn]);
  const words = formatWordCount(book.sourceWordCount);
  if (words) rows.push(["源站字数", words]);
  const released = formatReleased(book.released);
  if (released) rows.push(["首发日期", released]);
  const updated = formatDate(book.sourceUpdatedAt);
  if (updated) rows.push(["源站更新", updated]);
  if (book.facets?.length) rows.push(["平台标记", book.facets.map(formatFacet).join("、")]);
  if (book.sourceUrl) {
    rows.push([
      "源站链接",
      <a className="break-all underline" href={book.sourceUrl} target="_blank" rel="noreferrer">
        {book.sourceUrl}
      </a>,
    ]);
  }
  if (book.alsoOn?.length) {
    rows.push([
      "其他平台",
      <span className="flex flex-wrap gap-x-2">
        {book.alsoOn.map((e) => (
          <a key={e.url} className="underline" href={e.url} target="_blank" rel="noreferrer">
            {platformName(e.platform)}
          </a>
        ))}
      </span>,
    ]);
  }
  if (rows.length === 0 && !book.mature) return null;

  return (
    <div className="flex flex-col gap-2">
      {book.mature && (
        <Badge variant="destructive" className="w-fit">
          成人向
        </Badge>
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
