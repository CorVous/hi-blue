# hi-blue

## Play

The canonical play URL is **https://corvous.github.io/hi-blue/** (GitHub Pages).

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
| `pnpm dev` | Run the SPA + Worker dev loop via `wrangler dev` (press **b** to open the SPA). SPA edits under `src/spa` re-trigger the build; Worker edits live-reload through Wrangler. |
| `pnpm smoke` | Run the Playwright integration / smoke suite (see below). |

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
