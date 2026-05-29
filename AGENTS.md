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

### Commit messages

We follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#specification). Squash-merge PR titles are the source of truth — `changelogen` parses them to bump the version and write `CHANGELOG.md`. See `docs/agents/commits.md`.

## Local development

`pnpm dev` runs `wrangler dev`, which fails without a Cloudflare login because
`RATE_GUARD_KV` is bound in remote mode (`"remote": true` in `wrangler.jsonc`).
In a sandbox or any environment without `wrangler login`, use:

- **`pnpm dev:local`** — adds `--local` (KV runs in-process, no login) and
  `--ip 0.0.0.0`. The page is reachable from another device, but in-app API
  calls still target `localhost`, so the proxy won't work cross-device.
- **`pnpm dev:lan`** (`scripts/dev-lan.mjs`) — detects the LAN IP, bakes it into
  `WORKER_BASE_URL`, and serves on `0.0.0.0:8787` for a fully functional app on
  another device. This sets `WORKER_BASE_URL` off `localhost`, so `__DEV__` is
  false (no dev inspector / debug footers / BYOK localhost shortcut).

## Bumping SESSION_SCHEMA_VERSION

When you bump SESSION_SCHEMA_VERSION in
`src/spa/persistence/session-codec.ts`, you must do ONE of:

- **Add a migrateV<old>To... function** in session-codec.ts so old
  saves migrate in place. No further action needed.
- **Add an entry to SCHEMA_ARCHIVE_MAP** in
  `src/spa/persistence/archive-map.ts` mapping the OLD schema number to
  the latest released version that shipped it. Find that version with:

      git describe --tags --abbrev=0 --match 'v*' HEAD~1

If the schema bumps twice without a release in between, the
intermediate schema number was never shipped — skip its map entry.

`scripts/check-schema-map.mjs` enforces this on PRs.
