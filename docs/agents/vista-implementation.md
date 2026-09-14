# Vista implementation: start here

## Source of truth

1. [ADR 0015](../adr/0015-proximity-disk-and-cardinal-directions.md) is the complete approved design, including interaction range and the dev inspector. It landed through PRs [#534](https://github.com/CorVous/hi-blue/pull/534) and [#542](https://github.com/CorVous/hi-blue/pull/542).
2. [CONTEXT.md](../../CONTEXT.md) supplies the vocabulary. Its spatial terms describe the target design, not implementation completion.
3. [Map #535](https://github.com/CorVous/hi-blue/issues/535) supplies current work status, dependencies, and acceptance criteria. Fetch the live issue and the selected child before starting.

The design is settled. Closed decision tickets #536 and #519 are supporting resolutions, not remaining work. Earlier maps, issue comments, and reverted ADR 0016 material may describe superseded choices; do not use them to override current ADR 0015. In particular, Use-Space does **not** reach the whole Vista.

## Target versus current code

At the documentation handoff (merge `c1cc64e`), gameplay still uses Facing, the Cone, relative movement, and horizon landmarks; session schema is v11 and USB schema is v4. These are the implementation starting point, not contradictions to fix by reverting the approved docs. Recheck the live map and source as implementation lands.

Keep three different regions distinct:

| Purpose | Approved region |
|---|---|
| Sight and witness eligibility | 13-cell Vista: `dx² + dy² ≤ 4`; out-of-bounds cells are perceived as Walls |
| Pickup, held Carry placement, Use-Space | Own cell plus eight neighbors: `max(abs(dx), abs(dy)) ≤ 1` |
| Inspector display | 5×5 room only; clip highlighting to room cells, not the Daemon's perception |

Carry/Use-Item proximity hints use interaction range. Pending Use-Space/Convergence hints use the four visible cells outside interaction range (two steps in each cardinal direction). Ordinary descriptions, on-space flavor, and completion flavor are separate. Refer to ADR 0015 for the complete rules; this table is a navigation aid, not an additional spec.

## Pick one ticket

For a single implementer, begin with **#537**, then **#538**. They can also be prepared independently by separate implementers. Check current state and assignees first; do not duplicate claimed work.

| Ticket | Scope | Prerequisites |
|---|---|---|
| [#537](https://github.com/CorVous/hi-blue/issues/537) | Tested Vista geometry; no live gameplay switch | None |
| [#538](https://github.com/CorVous/hi-blue/issues/538) | Archive compatibility preparation; no early schema bump | None |
| [#539](https://github.com/CorVous/hi-blue/issues/539) | Runtime, prompts, generated content, save-format cutover | #537 and #538 |
| [#540](https://github.com/CorVous/hi-blue/issues/540) | Approved 5×5 inspector and focus Vista | #537; coordinate with #539 |
| [#541](https://github.com/CorVous/hi-blue/issues/541) | Direction-eval retargeting and final integration evidence | #539 and #540 |

The live tracker is authoritative for completion and claims. Assign the selected issue to the human driving the work before implementing it. Work on a fresh branch from current main, or an explicitly documented stack for the coordinated cutover. Preserve unrelated working-tree changes.

## Boundaries that prevent accidental scope expansion

- **#537 is preparation.** Do not remove live Facing/Cone consumers, change tools, or bump save schemas here. A tested new geometry helper may coexist temporarily with the old runtime.
- **#538 is preparation.** Build/test compatibility machinery without making current v11/v4 saves incompatible. Use fixtures or a testable version boundary to exercise the future behavior. #539 activates v12/v5 and tests actual new-format round trips.
- **#539 and #540 must land coherently.** Their issue dependencies are not circular. Inspector work may be stacked against the cutover or included in one combined PR. Do not merge a broken inspector, add dummy Facing, disable it to make tests pass, or write new save formats before runtime consumers agree. State the landing group in each PR.
- **Tests belong with each implementation.** #541 does not excuse missing earlier tests. Update any eval type consumers needed to keep the cutover buildable before final scoring work.
- **Save compatibility is archive-only at this boundary.** The generic AGENTS.md migration option is not the choice for this effort. No v11→v12 or USB v4→v5 in-place migration. Preserve old save bytes; verify historical migration chains cannot silently cross the boundary. Finalize release mappings from actual tags at bump time.
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
