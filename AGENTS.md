# Agents

## Agent skills

### Issue tracker

Issues live in the `corvous/hi-blue` GitHub repo (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Testing

Three surfaces — Vitest workers (`src/proxy/`), Vitest jsdom (`src/spa/`), and Playwright e2e (`e2e/`). SPA changes that affect rendered DOM or user interaction need a Playwright spec — jsdom unit tests don't substitute. See `docs/agents/testing.md`.
