import type { ScrapeSnapshot } from "@/api/books";
import { platformName } from "@/api/scrape";
import { snapshotRows } from "@/lib/snapshot";

/** 快照（#43，GLOSSARY「快照」）：刮削时的平台数据。注明刮削日期与平台，不跨平台比较。 */
export function BookSnapshotView({ snapshot, platform, scrapedAt }: { snapshot: ScrapeSnapshot; platform: string | null; scrapedAt: string | null }) {
  const rows = snapshotRows(snapshot);
  if (rows.length === 0) return null;
  const date = scrapedAt ? new Date(scrapedAt).toLocaleDateString("zh-CN") : null;
  return (
    <section className="flex flex-col gap-1" aria-label="快照">
      <h3 className="text-xs font-medium">
        快照
        <span className="ml-1 font-normal text-muted-foreground">
          （{[platform && `${platformName(platform)}的数据`, date && `${date} 刮削`].filter(Boolean).join("，")}）
        </span>
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0">
              {row.url ? (
                <a className="underline" href={row.url} target="_blank" rel="noreferrer">
                  {row.text}
                </a>
              ) : (
                row.text
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
