/** 生成测试原稿：`chapters` 个「第N章」，末尾再加 `extras` 个内置规则不识别的「个人番外」。 */
export function manuscript(chapters: number, extras: number): string {
  const lines: string[] = [];
  const body = (label: string) => {
    for (let k = 1; k <= 40; k++) lines.push(`　　这是${label}的第${k}段，用来测试大体量原稿的导入与预览速度。`);
  };
  for (let n = 1; n <= chapters; n++) {
    lines.push(`第${n}章 测试`);
    body(`第${n}章`);
  }
  for (let n = 1; n <= extras; n++) {
    lines.push(`个人番外${n} 测试`);
    body(`个人番外${n}`);
  }
  return lines.join("\n");
}
