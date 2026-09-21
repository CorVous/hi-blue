# Vista implementation: start here

## Source of truth

1. [ADR 0015](../adr/0015-proximity-disk-and-cardinal-directions.md) is the complete approved design, including interaction range and the dev inspector. It landed through PRs [#534](https://github.com/CorVous/hi-blue/pull/534) and [#542](https://github.com/CorVous/hi-blue/pull/542).
2. [CONTEXT.md](../../CONTEXT.md) supplies the vocabulary. Its spatial terms describe the target design, not implementation completion.
3. [Map #535](https://github.com/CorVous/hi-blue/issues/535) supplies current work status, dependencies, and acceptance criteria. Fetch the live issue and the selected child before starting.

The design is settled. Closed decision tickets #536 and #519 are supporting resolutions, not remaining work. Earlier maps, issue comments, and reverted ADR 0016 material may describe superseded choices; do not use them to override current ADR 0015. In particular, Use-Space does **not** reach the whole Vista.

## Target versus current code

The cutover has landed. The runtime cutover merge `24a217b` (PR [#550](https://github.com/CorVous/hi-blue/pull/550)) converted gameplay, prompts, content generation, and the persisted formats to the Vista: directional facing is gone, the old projector is retired in favour of `src/spa/game/vista-projector.ts`, `go` is cardinal, the `face` tool is dropped, and pickup, held Carry placement, and Use-Space all run on the nine-cell interaction range. The room-only 5×5 inspector landed in merge `f018033` (PR [#553](https://github.com/CorVous/hi-blue/pull/553)). The live formats are session schema v12 and USB game-save v5.

This document is now a reference for the landed Vista, not a plan for converting it. Treat the live map #535 and the source as authoritative for anything that changes after this refresh.

Keep three different regions distinct:

| Purpose | Approved region |
|---|---|
| Sight and witness eligibility | 13-cell Vista: `dx² + dy² ≤ 4`; out-of-bounds cells are perceived as Walls |
| Pickup, held Carry placement, Use-Space | Own cell plus eight neighbors: `max(abs(dx), abs(dy)) ≤ 1` |
| Inspector display | 5×5 room only; clip highlighting to room cells, not the Daemon's perception |

Carry/Use-Item proximity hints use interaction range. Pending Use-Space/Convergence hints use the four visible cells outside interaction range (two steps in each cardinal direction). Ordinary descriptions, on-space flavor, and completion flavor are separate. Refer to ADR 0015 for the complete rules; this table is a navigation aid, not an additional spec.

## Implementation status

Every implementation ticket on this handoff has landed: #537 (PR [#546](https://github.com/CorVous/hi-blue/pull/546)), #538 (PR [#549](https://github.com/CorVous/hi-blue/pull/549)), #539 (PR [#550](https://github.com/CorVous/hi-blue/pull/550) / `24a217b`), #540 (PR [#553](https://github.com/CorVous/hi-blue/pull/553) / `f018033`), and #541 (PR [#558](https://github.com/CorVous/hi-blue/pull/558) / `25eab7e`, closed 2026-09-21). None of them is outstanding work, and none of the work described below is pending.

[Map #535](https://github.com/CorVous/hi-blue/issues/535) remains the live tracker for what is still open. Its remaining children are not implementation of the Vista itself. Fetch the live issue before starting any work.

## Boundaries that prevent accidental scope expansion

- **Tests belong with each implementation.** Ship tests with the behavior they cover; a later ticket never excuses missing tests for work that has already landed.
- **Save compatibility is archive-map only at this boundary.** The generic AGENTS.md migration option is not the choice for this effort: the v11→v12 and USB v4→v5 transitions are archive-map only, and there is no in-place migration for either. Old save bytes are preserved and never rewritten in place; historical migration chains cannot silently cross the boundary. Release mappings come from actual tags at bump time.
- **USB is currently export-only.** Do not invent an importer or resume UI. If an implementation fact exposes a genuinely unspecified user-visible behavior, report that specific question rather than choosing for the user.
- **No player-facing map, extra balance tuning, or redesigned objective satisfaction.** Internal file/API organization is the implementer's choice; approved behavior is not.

## Validation and completion

Read [testing guidance](testing.md). Run focused tests during implementation and the applicable repository checks:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
```

`pnpm smoke` is the Playwright command; `pnpm test:e2e` does not exist. Playwright's configured server builds the SPA and starts local Wrangler with a test key. Install Chromium with `pnpm exec playwright install chromium` if needed. Avoid reusing an unrelated server on port 8787. Inspector checks need the local dev build; `dev:lan` turns the inspector off.

Record exact commands and results, including pre-existing failures or environmental blockers. Do not claim tests passed when they were not run. Use stubbed model calls for deterministic browser tests; do not require live model credentials for them.

Open a PR referencing the implementation ticket and any coordinated landing partner. Close implementation tickets only after the matching work lands, not when a branch or draft exists. Update map #535's frontier and readiness labels after dependency closures. Remove or refresh this temporary handoff's starting-state guidance once the implementation map is complete.
