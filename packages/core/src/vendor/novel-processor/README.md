# novel-processor 移植代码

本目录的代码移植自 [rockbenben/novel-processor](https://github.com/rockbenben/novel-processor)，
参考提交 `a968635`（2026-10-29），许可证为 MIT，原文见同目录的 `LICENSE`。

| 本目录文件 | 上游文件 | 改动 |
|---|---|---|
| `regex.ts` | `src/app/utils/regex.ts` | 仅加文件头 |
| `text.ts` | `src/app/utils/textUtils.ts` | 只保留整理所需的函数 |
| `encoding.ts` | `src/app/utils/encoding.ts` | 输入改为 `Uint8Array`；去掉浏览器专属的 `lazyImport` 与 `readTextFile`；适配 jschardet 4 的类型 |
| `novel.ts` | `src/app/[locale]/novelUtils.ts` | 改为本目录内导入；删除 `reorderChaptersByTitle`（Novarium 不自动重排章节） |

除上表外，代码与上游保持一致，便于同步。为此本包关闭了 `noUncheckedIndexedAccess`。
同步上游时，先对比上表中的上游文件。
