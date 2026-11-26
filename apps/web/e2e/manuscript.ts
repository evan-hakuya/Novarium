/**
 * 生成测试原稿：`chapters` 个「第N章」，末尾再加 `extras` 个内置规则不识别的「个人番外」。
 * 给出 `missing` 时跳过这个序号（章节数不变，最后一章的序号加 1），制造一处缺号。
 */
export function manuscript(chapters: number, extras: number, missing?: number): string {
  const lines: string[] = [];
  const body = (label: string) => {
    for (let k = 1; k <= 40; k++) lines.push(`　　这是${label}的第${k}段，用来测试大体量原稿的导入与预览速度。`);
  };
  const last = missing ? chapters + 1 : chapters;
  for (let n = 1; n <= last; n++) {
    if (n === missing) continue;
    lines.push(`第${n}章 测试`);
    body(`第${n}章`);
  }
  for (let n = 1; n <= extras; n++) {
    lines.push(`个人番外${n} 测试`);
    body(`个人番外${n}`);
  }
  return lines.join("\n");
}
