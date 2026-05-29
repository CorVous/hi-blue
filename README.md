# hi-blue

## Play

The canonical play URL is **https://hi-blue.cor.gg/** (Cloudflare Pages).

The Cloudflare Worker is API-only (`POST /v1/chat/completions`, `POST /diagnostics`,
and `OPTIONS` preflights). It does not serve the game UI; the SPA is built and
deployed to GitHub Pages separately.

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
| `pnpm lint` | Lint |
| `pnpm typecheck` | Typecheck |
| `pnpm test` | Test |
| `pnpm build` | Build the static SPA into `dist/` |
| `pnpm dev` | Run the SPA + Worker dev loop via `wrangler dev` (press **b** to open the SPA). SPA edits under `src/spa` re-trigger the build; Worker edits live-reload through Wrangler. Requires a Cloudflare login because `RATE_GUARD_KV` is bound in remote mode. |
| `pnpm dev:local` | Same loop, but `--local` disables remote bindings (KV runs in-process) so no Cloudflare login is needed, and `--ip 0.0.0.0` exposes it on your LAN for UI preview from another device. In-app API calls still target `localhost`, so the proxy won't work cross-device — use `dev:lan` for that. |
| `pnpm dev:lan` | Fully functional cross-device dev. Detects your machine's LAN IP, bakes it into `WORKER_BASE_URL` so the SPA's API calls reach the Worker, and serves on `0.0.0.0:8787`. Prints the URL to open on the other device. Note: this turns `__DEV__` off (no dev inspector / debug footers / BYOK localhost shortcut). Both devices must share a network and inbound `8787` must be allowed. |
| `pnpm smoke` | Run the Playwright integration / smoke suite (see below). |
| `pnpm release` | Cut a release: bump version, update `CHANGELOG.md`, commit, tag. Push with `git push --follow-tags`. Driven by [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) — see `docs/agents/commits.md`. |

## Smoke suite (Playwright)

One-time browser install (after `pnpm install`):

```sh
pnpm exec playwright install chromium
```

Run the suite:

```sh
pnpm smoke
```

The `webServer` config in `playwright.config.ts` automatically runs `pnpm build` and then `wrangler dev --port 8787` before the tests start. No manual dev server needed.

View the HTML report after a run:

```sh
pnpm exec playwright show-report
```

## Detecting flakes

`pnpm test:repeat [N] [<vitest pattern>]` runs `vitest run` up to N times (default 20), failing fast on the first failure. `pnpm smoke:repeat [N] [<spec filter>]` does the same for Playwright (default 10). Use these on demand to verify a flake fix.
