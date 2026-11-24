## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `evan-hakuya/Novarium` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Book source debugging

Debug and accept Legado book sources against the local reader container. Verify on a phone only when the owner asks. See `docs/agents/book-source-debugging.md`.

## Workflow

Every change goes branch → Conventional Commit → PR → squash merge → deploy; `main` only receives squash merges, which keeps its commits Verified. The agent reviews, merges and deploys its own PRs. Follow the steps in `docs/agents/workflow.md` for any code or doc change.
