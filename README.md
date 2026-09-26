# hi-blue

## Play

The canonical play URL is **https://hi-blue.cor.gg/**. The SPA is built and
deployed to GitHub Pages: every `v*` tag publishes `/v/<version>/` and the
highest stable tag also publishes the root (`.github/workflows/release.yml`),
while every push to `main` publishes `/nightly/`
(`.github/workflows/deploy-pages.yml`). See ADR 0012.

The Cloudflare Worker (`src/proxy/worker.ts`) is the API: `POST /v1/chat/completions`,
`POST /diagnostics`, and `OPTIONS` preflights. It also carries the built SPA as
static assets, so `wrangler dev` serves the game and the API from one origin,
but players load the game from GitHub Pages.

## Prerequisites

- **Node.js 24** — install via [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or [asdf](https://asdf-vm.com/)
- **Corepack** — ships with Node; provides the pinned pnpm version automatically

## Setup

```sh
corepack enable && pnpm install
```

## Commands

| Command | Description |
| ------- | ----------- |
| `pnpm lint` | Biome (`biome ci --error-on-warnings`), then `scripts/check-no-comments.mjs`, which fails on any code comment other than a tool directive (see AGENTS.md "Code comments"). |
| `pnpm typecheck` | Typecheck three projects with `tsgo`: the SPA and content (`tsconfig.json`), the Worker (`src/proxy/tsconfig.json`), and e2e, evals and the Playwright config (`tsconfig.tools.json`). |
| `pnpm test` | Run Vitest: the jsdom `browser` project, the node `build` project and the Cloudflare `workers` project (see `docs/agents/testing.md`). |
| `pnpm build` | Build the static SPA into `dist/` |
| `pnpm dev` | Run the SPA + Worker dev loop via `wrangler dev` (press **b** to open the SPA). SPA edits under `src/spa` re-trigger the build; Worker edits live-reload through Wrangler. Requires a Cloudflare login because `RATE_GUARD_KV` is bound in remote mode. |
| `pnpm dev:local` | Same loop, but `--local` disables remote bindings (KV runs in-process) so no Cloudflare login is needed, and `--ip 0.0.0.0` exposes it on your LAN for UI preview from another device. In-app API calls still target `localhost`, so the proxy won't work cross-device — use `dev:lan` for that. |
| `pnpm dev:lan` | Fully functional cross-device dev. Detects your machine's LAN IP, bakes it into `WORKER_BASE_URL` so the SPA's API calls reach the Worker, and serves on `0.0.0.0:8787`. Prints the URL to open on the other device. Note: this turns `__DEV__` off (no dev inspector / debug footers / BYOK localhost shortcut). Both devices must share a network and inbound `8787` must be allowed. |
| `pnpm smoke` | Run the Playwright integration / smoke suite (see below). |
| `pnpm smoke:ui` | Open the same suite in Playwright's UI mode. |
| `pnpm test:repeat` / `pnpm smoke:repeat` | Flake hunters (see "Detecting flakes" below). |
| `pnpm eval:drift` | Live-model eval: free-text drift over a long run (`evals/free-text-drift/`). |
| `pnpm eval:directions` | Live-model eval: cardinal-direction coherence (`evals/relative-directions/`). |
| `pnpm eval:action-variation` | Live-model eval: action-tool distribution per persona and scenario (`evals/daemon-action-variation/`). |
| `pnpm eval:content-pack-flakiness` | Live-model eval: which content-pack validation rules fail in practice (`evals/content-pack-flakiness/`). Needs `OPENROUTER_API_KEY`. |
| `pnpm release` | Cut a release: bump version, update `CHANGELOG.md`, commit, tag. Push with `git push --follow-tags`. Driven by [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) — see `docs/agents/commits.md`. |
| `pnpm release:beta` | The same as a `-beta` prerelease; also marks the GitHub release as a prerelease. |

The evals call a live model, are not part of CI, and write dated reports under `docs/evals/`. `docs/design/evals.md` covers their setup and knobs.

## Smoke suite (Playwright)

One-time browser install (after `pnpm install`):

```sh
pnpm exec playwright install chromium
```

Run the suite:

```sh
pnpm smoke
```

The `webServer` config in `playwright.config.ts` automatically builds the SPA and starts `wrangler dev --local --port 8787` with a test API key. No Cloudflare login or manual dev server is needed. Outside CI, Playwright may reuse an existing server: ensure port 8787 is not serving an unrelated or differently configured build.

View the HTML report after a run:

```sh
pnpm exec playwright show-report
```

## Detecting flakes

`pnpm test:repeat [N] [<vitest pattern>]` runs `vitest run` up to N times (default 20), failing fast on the first failure. `pnpm smoke:repeat [N] [<spec filter>]` does the same for Playwright (default 10). Use these on demand to verify a flake fix.
