/**
 * 从原稿文件名推测书名与作者。常见格式：
 * 「《书名》作者：某人.txt」「书名 作者：某人.txt」「书名.txt」。
 */
export function guessBookName(fileName: string): { title: string; author: string } {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  const author = base.match(/作者[:：]\s*([^\s（(【\[]+)/)?.[1] ?? "";
  const quoted = base.match(/《([^》]+)》/)?.[1];
  const title = quoted ?? base.replace(/作者[:：].*$/, "").trim();
  return { title: title || base, author };
}
