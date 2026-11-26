/**
 * 字数，例如「446.8 万字」。compact 为 true 时不加空格（「446.8万字」），用于书源。
 * 没有字数时返回 null。
 */
export function formatWordCount(count: number | null, { compact = false } = {}): string | null {
  if (count === null || count <= 0) return null;
  const space = compact ? "" : " ";
  return count >= 10_000 ? `${Number((count / 10_000).toFixed(1))}${space}万字` : `${count}${space}字`;
}
