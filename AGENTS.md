# Agents

## Agent skills

### Issue tracker

Issues live in the `corvous/hi-blue` GitHub repo (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Design docs

The reasons behind the code live in `docs/design/`, one file per area. Read the matching file before changing that area, and update it when the reason changes:

- `content-packs.md`: content-pack generation, validation and retry, bootstrap, the LLM provider seams, mentions and the composer (`src/spa/game/`).
- `content.md`: the hand-authored pools and the persona and Content Pack generators (`src/content/`, `src/save-serializer.ts`).
- `e2e.md`: the Playwright harness, its helpers, and what each spec guards (`e2e/`).
- `evals.md`: the live-model eval harnesses (`evals/`).
- `game-round.md`: the round loop, dispatcher, engine, complications, prompt and message builders, and Vista geometry (`src/spa/game/`).
- `persistence.md`: session storage, the codec, schema history, version boundary and archive map (`src/spa/persistence/`).
- `proxy.md`: the Cloudflare Worker, CORS, the chat-completions pipeline and the cost guard (`src/proxy/`).
- `spa-shell.md`: the SPA root files, BYOK, SSE parsing, the dev inspector, styles and the jsdom harness (`src/spa/`).
- `tooling.md`: the scripts under `scripts/`.
- `views.md`: the route views (`src/spa/views/`).

### Testing

Three surfaces — Vitest workers (`src/proxy/`), Vitest jsdom (the rest of `src/`, plus `scripts/__tests__/` and `evals/__tests__/`), and Playwright e2e (`e2e/`). SPA changes that affect rendered DOM or user interaction need a Playwright spec — jsdom unit tests don't substitute. See `docs/agents/testing.md`.

### Daemon prompts (GLM-4.7)

The pinned model is `z-ai/glm-4.7` (`src/model.ts`). Daemon system prompts are assembled in `src/spa/game/prompt-builder.ts`. For vendor-specific prompting techniques (beginning-bias, XML tags, thinking-mode, sampling, multi-persona drift mitigation), see `docs/prompting/glm-4.7-guide.md`.

### Commit messages

We follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/#specification). Squash-merge PR titles are the source of truth — `changelogen` parses them to bump the version and write `CHANGELOG.md`. See `docs/agents/commits.md`.

## Vista (movement and sight)

The Vista has landed; [ADR 0015](docs/adr/0015-proximity-disk-and-cardinal-directions.md) is the specification (with implementation notes at the end), and `docs/design/game-round.md` explains how the code implements it.

## Code comments

There are no comments in code. `pnpm lint` enforces this through `scripts/check-no-comments.mjs`, which scans `src/`, `e2e/`, `evals/`, `scripts/` and the root config files (`node scripts/check-no-comments.mjs --fix` strips what it finds). The only exceptions are tool directives: Biome (`biome-ignore`), TypeScript (`@ts-expect-error`, `@ts-ignore`, `/// <reference>`), `@vitest-environment`, coverage-ignore hints and `@__PURE__`. Say what the code does through names. Put the explanation of *why* in `docs/design/<area>.md`, decisions in `docs/adr/`, and vocabulary in `CONTEXT.md`.

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

## Bumping save-format versions

When you bump SESSION_SCHEMA_VERSION in
`src/spa/persistence/version-constants.ts`, you must do ONE of:

- **Add a migrateV<old>To... function** in session-codec.ts so old
  saves migrate in place. No further action needed. The codebase currently
  has no migration functions: the v8→v11 chain was deleted and v11→v12 was
  archive-only. `docs/design/persistence.md` ("Session schema history")
  explains why, and why v12 must not gain a v11→v12 migration.
- **Add an entry to SCHEMA_ARCHIVE_MAP** in
  `src/spa/persistence/archive-map.ts` mapping the OLD schema number to
  the latest released version that shipped it. Find that version with:

      git describe --tags --abbrev=0 --match 'v*' HEAD~1

If the schema bumps twice without a release in between, the
intermediate schema number was never shipped — skip its map entry.

`scripts/check-schema-map.mjs` enforces this on PRs.

The same idea covers the "Save the AIs to USB" game-save format
(`GAME_SAVE_VERSION` in `src/save-serializer.ts`). That axis is not migrated
in place, so a bump must add a `GAME_SAVE_ARCHIVE_MAP` entry (in
`src/spa/persistence/archive-map.ts`) mapping the OLD number to the latest
released version that shipped it, so the version-mismatch can link the user to
the archived build. The same checker enforces this on PRs. Both axes share the
version-boundary compatibility helpers in
`src/spa/persistence/version-boundary.ts`.
