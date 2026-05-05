# hi-blue

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
| `pnpm dev` | Run the SPA + Worker dev loop (press **b** to open the SPA). SPA source edits trigger an esbuild rebuild; refresh the browser. Worker source edits live-reload through Wrangler. |
