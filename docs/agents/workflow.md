# Development workflow

Every change reaches `main` through a squash-merged PR. GitHub signs the squash commit, so `main` shows only **Verified** commits. This machine has no gpg: a local commit pushed straight to `main` is Unverified.

## Steps

1. **Branch.** `git switch main && git pull`, then `git switch -c codex/<issue>-<slug>` (no issue: `codex/<slug>`).
2. **Build.** Write tests with the code. Keep temporary files in `/tmp/novarium-tickets/`, never in the repo. Done when `pnpm typecheck` and `pnpm test` pass locally.
3. **Verify behaviour.** Run the feature end to end: browser against `wrangler dev` for owner UI (run `pnpm --filter @novarium/web build` first), the local reader for book sources (see `book-source-debugging.md`). Done when the evidence for every acceptance criterion is in hand.
4. **Commit.** Conventional Commits in English: `feat: …`, `fix(core): …`, `docs: …`. Body explains why; end with `Refs #N` when an issue applies. Push the branch.
5. **CI.** Pushing the branch and opening the PR (step 7) runs `.github/workflows/ci.yml`: install, typecheck, build, test on a clean runner. Done when `gh pr checks <branch> --watch` reports the `check` job passed. If CI is unavailable, run the same four commands in a fresh clone under `/tmp/novarium-tickets/<unique>`.
6. **Issue.** Tick every acceptance criterion the PR satisfies: read the body, turn `- [ ]` into `- [x]`, write it back with `gh issue edit <n> --body-file`. Leave unmet ones unticked and say why in an issue comment.
7. **PR.** Title is the Conventional Commit subject. Body uses the `pr` skill template (Summary, Evidence, Merge Danger) and ends with `Closes #N` when the issue is fully done, otherwise `Refs #N`.
8. **Merge.** Only with CI green: `gh pr merge <branch> --squash --delete-branch`, then `git switch main && git pull && git fetch --prune`.
9. **Deploy.** `pnpm deploy:cf` (deploys the Worker, then applies D1 migrations). Check production: `/api/health` and the changed endpoints or pages.
10. **Confirm.** `gh api 'repos/evan-hakuya/Novarium/commits?per_page=1' -q '.[0].commit.verification.verified'` prints `true`.

## Production data

Production is the owner's real library. Test data created there is removed by its own ID only; owner-created records stay untouched.

## Repairing history

When an Unverified or badly formatted commit lands on `main`: move it to a branch, rewrite it as one Conventional Commit, reset `main` to the last good commit and push with `--force-with-lease=main:<bad-sha>`, then continue from step 6.
