# Coding standards

The reviewer reads this file during workflow step 8 (`docs/agents/workflow.md`). Each rule is a judgement call. Mechanical rules live in CI instead; the last section lists them so the reviewer skips them.

## Boundaries

- **External services stay on the server.** DaoSearch and Workers AI are called from `apps/server` only. Keys and tokens never reach a response body, the web app, or a log line. The web app calls Novarium's own `/api` only.
- **AI is optional.** Import, organizing and saving work with AI off, unconfigured, out of quota or failing. AI output is a suggestion applied only on an explicit owner action; nothing calls AI automatically (ADR 0007).
- **`packages/core` is pure.** No network, storage, timers or platform globals: it runs in the browser, the Worker and Node. Callers pass data in and get data out.
- **Platform code stays at the edges.** `apps/server/src/app.ts` and the routes run on both Workers and Node. Code specific to one runtime lives in `worker.ts`, `node.ts`, `storage/`, `db/` or the test helper `test-app.ts`, behind the shared interfaces there.

## Data

- **Schema changes ship as expand, then contract** (see "Schema changes" in `docs/agents/workflow.md`). A migration in the same PR as a drop or rename is a finding.
- **The book source is a public contract.** Changes under `/api/source/*` keep existing Legado imports working, or the PR says how the owner re-imports.

## Language and naming

- **Chinese for people, English for machines.** UI text, error messages shown to the owner and code comments are Simplified Chinese. Identifiers, commit messages and PR text are English.
- **Domain words match `GLOSSARY.md`.** A new UI term or a new identifier for an existing concept uses the glossary word; a new concept gets a glossary entry in the same PR.
- **Changed meaning updates the docs in the same PR.** When code changes how a glossary term behaves (what it is, how it is handled), the PR updates that `GLOSSARY.md` entry and every ADR that describes the old behaviour. Read the entries for the terms the diff touches, not only the diff.

## Tests

- **Behaviour changes come with tests.** Unit tests sit next to the code as `*.test.ts`. A change to the import or preview flow extends `apps/web/e2e/import.e2e.ts`.
- **Chapter rules come with counterexamples and the sample eval.** A new or widened pattern or word list in the chapter rules has at least one test of body text it must not match. The PR's Evidence has the sample eval table and its title changes (`docs/agents/import-samples.md`); a change that helps one sample and moves titles in others needs an answer.
- **Test external services with fakes.** Tests never call DaoSearch or Workers AI; they cover success plus each error class the code maps (for example 401, 429, quota, timeout).

## Checked by CI (skip in review)

- PR title is a Conventional Commit (`title` job).
- `apps/web/src` and `packages/core/src` contain no DaoSearch or Workers AI address (`check` job).
- Types, build, unit tests and the import e2e (`check`, `e2e` jobs).
