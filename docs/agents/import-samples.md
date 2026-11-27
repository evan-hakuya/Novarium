# Import samples

Real novels used to check chapter rules (`packages/core/src/split.ts`, `packages/core/src/vendor/novel-processor/regex.ts`, `packages/core/src/line-review.ts`). They are copyrighted: they stay on the owner's machine and never enter the repo, a PR, an issue or a log.

- **Folder**: `/Users/hakuya/Downloads/Documents/小说样本` (10 books in UTF-8, UTF-8 with BOM and GBK, some with CRLF line ends).
- **Baseline**: `baseline.json` in the same folder: per book, the counts below and every chapter as `标题 | 序号 | 卷`, with author notices prefixed `公告 `.

## Run

```sh
NOVARIUM_SAMPLES=/Users/hakuya/Downloads/Documents/小说样本 pnpm --filter @novarium/core eval
```

It processes every `.txt` with the default options in about 10 seconds, prints one row per book (chapters, notices, volumes, outOfOrder, missing, duplicate, sectionReset, suspicious) and marks changed counts `旧→新`. Under each changed book it lists chapters that disappeared (`-`) or appeared (`+`), up to 30 lines. Without `NOVARIUM_SAMPLES` the sample test is skipped.

Add `UPDATE_BASELINE=1` to write the current result as the new baseline.

## When changing a chapter rule

1. Run the eval on `main` first; it must report `0 本与基线不同`. If not, update the baseline on `main` before you start.
2. Make the change and run the eval again. Read every `-`/`+` line: each one is either the bug you meant to fix or a regression.
3. Put the count table and a summary of the title changes in the PR's Evidence. Quote only chapter titles, never body text.
4. After the merge, run with `UPDATE_BASELINE=1` on `main`.

A rule that only fixes one sample and adds `+`/`-` lines elsewhere is overfitting. Prefer structural signals (numbering, position, chapter length) to new word lists, and leave semantic calls to AI review (ADR 0007).
