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

### Daemon prompts (GLM-4.7)

The pinned model is `z-ai/glm-4.7` (`src/model.ts`). Daemon system prompts are assembled in `src/spa/game/prompt-builder.ts`. For vendor-specific prompting techniques (beginning-bias, XML tags, thinking-mode, sampling, multi-persona drift mitigation), see `docs/prompting/glm-4.7-guide.md`.
