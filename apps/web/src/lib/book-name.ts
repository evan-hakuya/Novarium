/**
 * 从原稿文件名推测书名与作者，文件名里没有作者时再看原稿开头的「作者：某人」。文件名常见格式：
 * 「《书名》作者：某人.txt」「书名 作者：某人.txt」「书名.txt」。
 * Z-Library 格式「书名 (说明) (作者) (z-library.sk, 1lib.sk).txt」：去掉站点括号，最后一个括号是作者，第一个括号前是书名。
 */
export function guessBookName(fileName: string, head = ""): { title: string; author: string } {
  let base = fileName.replace(/\.[^.]+$/, "").trim();
  const site = /\s*[(（][^()（）]*(z-?lib|1lib|z-library)[^()（）]*[)）]\s*/gi;
  const fromZlib = site.test(base);
  base = base.replace(site, " ").trim();
  const byLabel = (s: string) => s.match(/作者[:：]\s*([^\s（(【\[《]+)/)?.[1] ?? "";
  const groups = [...base.matchAll(/[(（]([^()（）]+)[)）]/g)];
  if (fromZlib && groups.length > 0 && !byLabel(base)) {
    const title = base.slice(0, groups[0]!.index).trim();
    return { title: title || base, author: groups.at(-1)![1]!.trim() };
  }
  const quoted = base.match(/《([^》]+)》/)?.[1];
  const title = quoted ?? base.replace(/作者[:：].*$/, "").trim();
  // 只看开头几行，避免把正文里的「作者：」当成作者。
  const author = byLabel(base) || byLabel(head.split("\n").slice(0, 20).join("\n"));
  return { title: title || base, author };
}
