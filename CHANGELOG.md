# Changelog


## v0.0.2-beta.3

[compare changes](https://github.com/CorVous/hi-blue/compare/v0.0.2-beta.2...v0.0.2-beta.3)

### 🚀 Enhancements

- Implement the tested radius-2 Vista geometry primitive ([#546](https://github.com/CorVous/hi-blue/pull/546))
- **spa:** ⚠️  Cut runtime, prompts, content, and saves over to the Vista ([#550](https://github.com/CorVous/hi-blue/pull/550))
- **spa:** Render the dev inspector as a room-only 5x5 Vista board ([#553](https://github.com/CorVous/hi-blue/pull/553))
- Switch the pinned model to DeepSeek V4.1 Flash with thinking on ([#567](https://github.com/CorVous/hi-blue/pull/567))

### 🩹 Fixes

- **content:** Reduce action-averse daemon draws ([d013ed4](https://github.com/CorVous/hi-blue/commit/d013ed4))
- **scripts:** Verify the archive maps instead of the diff text ([#552](https://github.com/CorVous/hi-blue/pull/552))
- **evals:** Retarget direction eval tooling onto the cardinal model ([#558](https://github.com/CorVous/hi-blue/pull/558))
- **scripts:** Stop the schema-map test corrupting the real checkout ([#562](https://github.com/CorVous/hi-blue/pull/562))
- **spa:** Stop the app shell overflowing at 375px ([#565](https://github.com/CorVous/hi-blue/pull/565))

### 💅 Refactors

- **spa:** Harden the Vista geometry primitive ([#548](https://github.com/CorVous/hi-blue/pull/548))
- **spa:** Prepare archive compatibility for the session and USB cutover ([#549](https://github.com/CorVous/hi-blue/pull/549))
- Simplify the codebase and move rationale into design docs ([#566](https://github.com/CorVous/hi-blue/pull/566))

### 📖 Documentation

- **playtests:** Add agent session 0xA49E ([498edd0](https://github.com/CorVous/hi-blue/commit/498edd0))
- **playtests:** Add agent session 0x3E87 ([#509](https://github.com/CorVous/hi-blue/pull/509))
- **playtests:** Correct overstated direction claim in 0x3E87 ([#510](https://github.com/CorVous/hi-blue/pull/510))
- ADR 0015 — the Vista, cardinal directions, and retirement of facing ([de71771](https://github.com/CorVous/hi-blue/commit/de71771))
- ADR 0016 — the new movement and sight format ([0993327](https://github.com/CorVous/hi-blue/commit/0993327))
- ADR 0016 — the new movement and sight format" ([00a3ba1](https://github.com/CorVous/hi-blue/commit/00a3ba1))
- **adr:** Rewrite approved vista and cardinal movement spec ([96fe012](https://github.com/CorVous/hi-blue/commit/96fe012))
- **adr:** Define interaction range and inspector behavior ([2c4d22c](https://github.com/CorVous/hi-blue/commit/2c4d22c))
- Clarify vista implementation handoff and test setup ([197abb5](https://github.com/CorVous/hi-blue/commit/197abb5))
- Refresh the documentation for the landed Vista cutover ([#559](https://github.com/CorVous/hi-blue/pull/559))
- **evals:** Record the action-averse talk-only decision ([#564](https://github.com/CorVous/hi-blue/pull/564))
- **agents:** Document wayfinder operations on the issue tracker ([#545](https://github.com/CorVous/hi-blue/pull/545))

### 🏡 Chore

- **release:** V0.0.2-beta.2 ([6435349](https://github.com/CorVous/hi-blue/commit/6435349))
- Mark beta github releases as prerelease ([c3d6ba1](https://github.com/CorVous/hi-blue/commit/c3d6ba1))
- Remove project-local skills directory ([c6f6f40](https://github.com/CorVous/hi-blue/commit/c6f6f40))
- Add agent skills directory ([f2aba2c](https://github.com/CorVous/hi-blue/commit/f2aba2c))
- Vendor grilling, grill-me, and handoff skills ([53f0e64](https://github.com/CorVous/hi-blue/commit/53f0e64))
- **ci:** Typecheck the e2e tree ([#551](https://github.com/CorVous/hi-blue/pull/551))
- **evals:** Typecheck the evals tree ([#563](https://github.com/CorVous/hi-blue/pull/563))
- **playtest:** Restore the /playtest skill and its headless-browser driver ([#568](https://github.com/CorVous/hi-blue/pull/568))

### ✅ Tests

- **e2e:** Stop start-screen specs racing the dial-up animation ([#556](https://github.com/CorVous/hi-blue/pull/556))
- **e2e:** Make start-screen begin-gate waits load-robust ([#561](https://github.com/CorVous/hi-blue/pull/561))

### 🤖 CI

- **deploy:** Provision OPENROUTER_API_KEY worker secret on deploy ([#511](https://github.com/CorVous/hi-blue/pull/511))

#### ⚠️ Breaking Changes

- **spa:** ⚠️  Cut runtime, prompts, content, and saves over to the Vista ([#550](https://github.com/CorVous/hi-blue/pull/550))

### ❤️ Contributors

- Cor <birb@cor.gg>
- CorVous
- Cor Vous <birb@cor.gg>

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

