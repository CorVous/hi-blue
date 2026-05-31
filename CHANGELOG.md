# Changelog


## v0.0.2-beta.2

[compare changes](https://github.com/CorVous/hi-blue/compare/v0.0.2-beta.1...v0.0.2-beta.2)

### 🚀 Enhancements

- **dev:** Add local + LAN dev scripts that skip Cloudflare login ([#501](https://github.com/CorVous/hi-blue/pull/501))

### 🩹 Fixes

- **game:** Hide #bootstrap-recovery on late-success after timeout ([#500](https://github.com/CorVous/hi-blue/pull/500))
- **prompt-builder:** Tag ground items as not-held in cone and cell rendering ([ac9c0ae](https://github.com/CorVous/hi-blue/commit/ac9c0ae))
- **dispatcher:** Gate friendly use message to pick_up-reachable cells only ([ec929b2](https://github.com/CorVous/hi-blue/commit/ec929b2))

### 💅 Refactors

- **spa:** Rename routes/ directory to views/ ([f69735c](https://github.com/CorVous/hi-blue/commit/f69735c))

### 📖 Documentation

- **testing:** Update stale path reference to routes/ -> views/ ([e77f730](https://github.com/CorVous/hi-blue/commit/e77f730))

### 🏡 Chore

- **release:** V0.0.2-beta.1 ([7e9df5f](https://github.com/CorVous/hi-blue/commit/7e9df5f))
- **settings:** Remove SessionStart pnpm install hook ([63a02c2](https://github.com/CorVous/hi-blue/commit/63a02c2))

### ✅ Tests

- **spa:** Update stale route/ comment references in test file headers ([3c46e2f](https://github.com/CorVous/hi-blue/commit/3c46e2f))

### ❤️ Contributors

- Cor Vous <birb@cor.gg>
- CorVous ([@CorVous](https://github.com/CorVous))

## v0.0.2-beta.1

[compare changes](https://github.com/CorVous/hi-blue/compare/v0.0.2-beta.0...v0.0.2-beta.1)

### 🚀 Enhancements

- **skills:** Add /continuous live HTML handoff skill ([#497](https://github.com/CorVous/hi-blue/pull/497))

### 🩹 Fixes

- Resolve biome lint warnings ([#484](https://github.com/CorVous/hi-blue/pull/484))
- **spa:** Apply obstacle_shift and weather_change complications ([#489](https://github.com/CorVous/hi-blue/pull/489))
- **content-pack:** Eliminate dual-pack generation flakiness against GLM-4.7 ([#498](https://github.com/CorVous/hi-blue/pull/498))

### 📖 Documentation

- **playtest:** Refresh skill for current daemon tool set and objective draw ([#480](https://github.com/CorVous/hi-blue/pull/480))
- Add playtest session log 0xFA73 ([#490](https://github.com/CorVous/hi-blue/pull/490))
- **playtests:** Add agent playtest session 0x7101 ([#492](https://github.com/CorVous/hi-blue/pull/492))
- Correct CONTEXT.md complication and ConversationEntry drift ([#495](https://github.com/CorVous/hi-blue/pull/495))

### 🏡 Chore

- Remove dead code identified in repo-wide dead-code audit ([#482](https://github.com/CorVous/hi-blue/pull/482))
- Remove dead complications module ([#483](https://github.com/CorVous/hi-blue/pull/483))
- **skills:** Sync Matt Pocock engineering skills, add prototype and handoff ([#488](https://github.com/CorVous/hi-blue/pull/488))
- Add TypeScript clean-code skills ([#485](https://github.com/CorVous/hi-blue/pull/485))
- Remove dead code found in repo-wide audit ([#494](https://github.com/CorVous/hi-blue/pull/494))

### ❤️ Contributors

- CorVous ([@CorVous](https://github.com/CorVous))

## v0.0.2-beta.0

[compare changes](https://github.com/CorVous/hi-blue/compare/v0.0.1-beta.0...v0.0.2-beta.0)

### 🏡 Chore

- Add release:beta script for beta releases ([#477](https://github.com/CorVous/hi-blue/pull/477))
- Release v0.0.1 ([d1aebf9](https://github.com/CorVous/hi-blue/commit/d1aebf9))

### ❤️ Contributors

- CorVous ([@CorVous](https://github.com/CorVous))

## v0.0.1-beta.0

[compare changes](https://github.com/CorVous/hi-blue/compare/v0.0.0...v0.0.1-beta.0)

### 🚀 Enhancements

- Channel aliases + version-mismatch banner with archive URL ([#431](https://github.com/CorVous/hi-blue/pull/431))
- **persistence:** Migrate v9 saves to v10 by defaulting wallName ([#432](https://github.com/CorVous/hi-blue/pull/432))
- **dev:** Daemon dev inspector (9 seams, __DEV__-only) ([#448](https://github.com/CorVous/hi-blue/pull/448))
- **content-pack:** Strengthen outer-retry corrective feedback ([#455](https://github.com/CorVous/hi-blue/pull/455))

### 🩹 Fixes

- Fetch tags in Pages deploy so release banner hides hash ([#428](https://github.com/CorVous/hi-blue/pull/428))
- **engine:** Include boundSpaces in world.entities at game start ([#456](https://github.com/CorVous/hi-blue/pull/456))
- **game:** Paint chat-lockout panel muting on session restore ([#476](https://github.com/CorVous/hi-blue/pull/476))

### 💅 Refactors

- Delete dead partial-retry surface ([#454](https://github.com/CorVous/hi-blue/pull/454))
- **content-pack:** Collapse entity buckets into flat entities[] ([#457](https://github.com/CorVous/hi-blue/pull/457), [#464](https://github.com/CorVous/hi-blue/pull/464))

### 📖 Documentation

- Playtest session 0x9759 observations and hypothesis refinement ([#430](https://github.com/CorVous/hi-blue/pull/430))
- **adr:** Record __DEV__-only gating for the Daemon dev inspector ([#436](https://github.com/CorVous/hi-blue/pull/436))
- **adr:** Record type-first Objective authoring (ADR 0014) ([#442](https://github.com/CorVous/hi-blue/pull/442))

### 🤖 CI

- Add versioned URLs at /v/<version>/ via gh-pages branch ([#429](https://github.com/CorVous/hi-blue/pull/429))

### ❤️ Contributors

- CorVous ([@CorVous](https://github.com/CorVous))

