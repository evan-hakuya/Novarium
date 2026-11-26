## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `evan-hakuya/Novarium` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Grilling

Append each decision to `/tmp/novarium-tickets/grill-<topic>.md` the moment the owner confirms it (round and question, e.g. `R2-Q3`, the decision, the owner's words). After a context compaction, read every `/tmp/novarium-tickets/grill-*.md` before asking the next question; when grilling ends, move each decision where it belongs (ADR, `GLOSSARY.md` or issue).

### Book source debugging

Debug and accept Legado book sources against the local reader container. Verify on a phone only when the owner asks. See `docs/agents/book-source-debugging.md`.

### Scraping

DaoSearch is the first scraping source (ADR 0006). Endpoints, costs, fields and terms are in `docs/agents/daosearch.md`.

### AI review

AI review uses Workers AI `clef` and `clairic` (ADR 0007). Request formats, prices, quota and test results are in `docs/agents/workers-ai.md`.

## Workflow

Every change goes branch → Conventional Commit → PR → review → squash merge → deploy; `main` only receives squash merges, which keeps its commits Verified. A review subagent checks each PR against `CODING_STANDARDS.md`; the agent then merges and deploys its own PRs. Follow the steps in `docs/agents/workflow.md` for any code or doc change.
