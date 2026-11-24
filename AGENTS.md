## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `evan-hakuya/Novarium` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Book source debugging

Debug Legado book sources against the local reader container, not a phone. See `docs/agents/book-source-debugging.md`.

## Pull requests

The agent reviews and merges its own PRs. Merge once `pnpm typecheck`, `pnpm build` and `pnpm test` pass on the branch, every acceptance criterion of the linked issue is checked, and the PR body carries the evidence. Squash-merge and delete the branch.
