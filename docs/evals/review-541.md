# Independent review — PR #558 (`wayfinder/541-vista-verification`)

Review-only pass by a separate, fresh reviewer with no stake in the work. No source
file was edited, weakened, or fixed by this review.

- Range: `e28e5f9..87c775f` (`main` @ `e28e5f9` → branch head)
- **Note on the brief:** the task described "the 6 commits from `e28e5f9..HEAD`".
  The branch actually contains **5** commits (`git rev-list --count e28e5f9..HEAD` → 5).
  The PR body's own commit table lists 5. No sixth commit is missing; the "6" appears
  to be a miscount in the review brief.
- Files changed (9): 7 under `evals/`, 1 new doc, 2 test files under `src/spa/game/__tests__/`.
  **Nothing under `e2e/` was touched** (`git diff --name-only e28e5f9..HEAD -- e2e/` → empty).

## AXIS 1 — SPEC (#541 acceptance bullets)

Ticket #541's "## Acceptance" section is the authority. Each bullet is judged verbatim.

### A1. "Replace cardinal-leak and required-landmark scoring with metrics that reflect approved cardinal movement and positional statements; test scoring deterministically, including statement/action agreement and no-statement/no-tool cases."

**Verdict: met** (with the landmark half being a non-existent target — see below).

- Cardinal-leak scoring genuinely inverted. `evals/relative-directions/scoring.ts:104-117`
  now exports `referencedCardinals` (a *reference count*, approved vocabulary) in place of
  `detectCardinalLeaks`; the pass rule at `scoring.ts:241` is now
  `structuralMismatchCount === 0`, not `cardinalLeakCount === 0`.
  A repo-wide grep confirms `detectCardinalLeaks`, `cardinalLeakCount`, `parseStatedDirection`,
  `RELATIVE_DIRECTIONS`, and `cardinalToRelative` are fully removed — no dead remnants.
- Positional statements are scored: `parseStatedCardinal` (`scoring.ts:171-177`) recognises
  movement (`STATED_MOVEMENT_RE`, `:136`), position+distance (`STATED_POSITION_RE`, `:148`),
  and bearing (`STATED_BEARING_RE`, `:152`).
- **"required-landmark scoring" did not exist to replace.** At `e28e5f9`,
  `git show e28e5f9:evals/relative-directions/scoring.ts | grep -i landmark` → no matches,
  and the same for `runner.mts`. The only "Landmark consistency" metric in the repo is in the
  *dated run artifact* `docs/evals/relative-directions-2026-05-11.md:8,21,94,153` — a historical
  report, not live scoring. So this half of the bullet was satisfied vacuously and correctly;
  the branch did not need to (and did not) invent a landmark metric. **Judged met, not partial** —
  but the audit doc should have said so explicitly rather than leaving it implied.
- The four coherence cases are **all tested**, and end-to-end from prose rather than hand-set fields:
  - `match` — `eval-scoring.test.ts:240-242`, and driven from prose at `:388-402`
  - `mismatch` — `:244-246`, prose-driven at `:404-418` (`scoreScenario([turn]).passed` → `false`)
  - `no-statement` — `:247-253`
  - `no-toolcall` — `:256-257`
  - no-statement/no-tool — `:421-428` asserts `structuralCoherenceRate === 1`,
    `structuralMismatchCount === 0`, `passed === true`.
  - Retired relative vocabulary is asserted *null* at `:231-238`.

### A2. "No eval fixture or runner requires facing, horizon landmarks, `face`, or relative tool directions. Preserve useful unrelated metrics; no new balance targets or temperament tuning."

**Verdict: met.**

I grepped `facing|face|cone|horizon|landmark|forward|behind|left|right` across `evals/` and
`e2e/` and judged every hit individually:

| Hit | Judgement |
|---|---|
| `evals/relative-directions/scoring.ts:9-11,125` | Historical prose stating *what was retired*. Negative. |
| `evals/relative-directions/runner.mts:9-10` | Explicit "retained for history only" note. Negative. |
| `evals/daemon-action-variation/runner.mts:461` | Tool-surface provenance note. Deliberate history. |
| `evals/daemon-action-variation/scoring.ts:49` | `face`-drift rationale for exhaustive key typing. Deliberate history. |
| `evals/daemon-action-variation/SKILL.md:20-21` | States ADR 0015 retired `face`. Negative. |
| `evals/free-text-drift/runner.mts:222` | "silence-in-the-face-of-input" — English idiom. Coincidence (doc itself claims this; verified at `:222`). |
| `evals/free-text-drift/scoring.ts:90,184` | "left undefined" / verb list. Coincidence / legitimate. |
| `e2e/helpers/vista-geometry.ts:213-214` | A **negative assertion helper**, `RELATIVE_DIRECTION_WORDS`, enforcing absence. Not a dependency. |
| `e2e/dev-inspector.spec.ts:294,301-302,305` | Negative assertions requiring *no* facing/direction/compass markers. Correct as written. |
| `e2e/persistence-reload.spec.ts:469-470` | Negative assertions that saved bytes contain no `facing`/`landmark`. Correct. |
| `e2e/responsive-bento.spec.ts:356,370-371,404…` | `left`/`right` as **CSS layout** (`#topinfo-left`, `rect.right`). Coincidence. |
| `e2e/witnessed-event-reload.spec.ts:176,208` | "1 cell BEHIND the actor" — geometry comment about placing a witness opposite the direction of travel. Not a relative-direction *dependency*. **Worth a nit, see Standards.** |
| `e2e/helpers/stubs.ts:22,390` | "forwards from OpenRouter" / "forwarded via route.fallback" — verb. Coincidence. |
| `e2e/dev-inspector.spec.ts:555,562,608,661,666` | "horizontal overflow" — `horizon` inside `horizontal`. Coincidence; doc claims this and it holds. |

**No live dependency on facing, cone, horizon landmarks, `face`, or relative tool directions
remains in `evals/` or `e2e/`.** Two *stale prose* spots survive in `evals/` that the branch
touched but did not sweep — see W1/W2 under Standards; they are documentation defects, not
live dependencies, so this bullet stays **met**.

Unrelated metrics were preserved: `silenceRate`, `assistantTextLength`, `messageRecipientCounts`,
`rollingSilenceRate`, `toolCallCountsByName` all remain. No balance target or temperament tuning
was introduced (the diff contains no threshold constants beyond the pre-existing coherence rule).

### A3. "Exercise an integrated deterministic flow: start with landmark/facing-free packs, cardinal movement, Vista entry/exit, witness events, unchanged snapshots, reload preserving conversation/deltas, Setting Shift/endgame semantics, new-format exports, and old-save compatible-build handling."

**Verdict: partial.**

The coverage exists and is real, but **none of it was added by this branch** — every element
already had coverage at `e28e5f9`. `git diff --name-only e28e5f9..HEAD` touches zero files under
`e2e/`, `src/spa/__tests__/`, `src/spa/persistence/`, or `src/__tests__/`. The branch's only test
edits are the two offline eval-scorer files. The PR description's implication that this ticket
supplies the integration evidence is therefore not backed by anything this branch wrote; it
*verifies by re-running* pre-existing coverage.

Enumerated (all verified by reading the tests, not trusting the PR):

| Flow element | Coverage | Added here? |
|---|---|---|
| Cardinal movement | `dispatcher.test.ts:526` "go south moves to (1,0)"; `:534` "go east…"; `:567`; `game-session.test.ts:609`; e2e `persistence-reload.spec.ts:318` (live) | no |
| Vista entry/exit | `prompt-builder.test.ts:2732` "still emits the entry diff when an entity moves into the Vista"; `:2936`/+/- diff; `round-coordinator.test.ts:2924` `diskDelta` | no |
| Witness events | `round-coordinator.test.ts:2766` "a Daemon at offset (2,0) … witnesses; one at (2,1) does not"; direction pinned at `conversation-log.test.ts:241`; e2e `witnessed-event-reload.spec.ts:301` | no |
| Unchanged snapshots | `prompt-builder.test.ts:2711` "emits no `<whats_new>` diff when the Vista is unchanged" (byte-identical snapshot + negative control at `:2978`) | no |
| Reload preserves conversation/deltas | e2e `persistence-reload.spec.ts:208` | no |
| Setting Shift | `complication-engine.test.ts:872` pack swap; `:373` once-only; `:911` positions unchanged | no |
| Endgame semantics | **partial** — `endgame-choices.spec.ts:74` "New Daemons click archives session and transitions" is asserted well; **Same Daemons New Room and Continue are only asserted *visible*, never clicked** (`:44`, `:34`, `:54`). `buildSameDaemonsSession` has zero test references. | no |
| New-format exports | session v12 asserted `persistence-reload.spec.ts:219-222`; USB v5 `save-serializer.test.ts:169,177,186`. **No e2e for the USB export/download flow at all** (`grep -n "USB\|download\|exportGameSave" e2e/*.spec.ts` → nothing). | no |
| Old-save compatible-build | `version-boundary.test.ts:74,81,112`; real DOM href `sessions.test.ts:381` → `./v/0.0.2-beta.2/`; maps at `archive-map.ts` | no |

`partial` because (a) the two endgame paths named in the bullet are not behaviourally exercised,
and (b) the branch itself contributes no new coverage for any element while the ticket frames this
as *final integration evidence*. It does not, however, defer anything — the coverage pre-dates it.

### A4. "Verify the inspector is 5×5 with identity-and-position markers, no out-of-bounds Walls/summary, and movement-updating focus Vista (switch/repeat-click/Escape). Preserve dev-only gating. Independently test the 13-cell sight vs nine-cell interaction range and four outer hint cells: a two-step visible Use-Space target must not be usable. No player-facing grid/compass UI."

**Verdict: met** (inspector half delegated to #540, already merged; the range half is genuinely tested).

- **The decisive test exists and is quoted here** — `src/spa/game/__tests__/dispatcher.test.ts:1214`:

  ```ts
  it("rejects use on a space at offset (2,0) — in the Vista, outside interaction range", () => {
      // red at (2,2); shrine at (4,2) = 2 cells south
      const game = makeGameWithSpaceObjective({ row: 2, col: 2 }, { row: 4, col: 2 });
      const call: ToolCall = { name: "use", args: { item: "shrine" } };
      const result = validateToolCall(game, "red", call);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/out of reach/i);
  });
  ```

  13-cell sight vs nine-cell range is pinned by `vista-projector.test.ts:113`
  ("contains exactly the 13 offsets from the ADR diagram") alongside `:1229`
  ("rejects use on a space at offset (2,1) — outside the Vista too") and
  `:1201` (own-cell use accepted). The four outer hint cells are covered by
  `dispatcher.test.ts:1295` (green at two steps east is inside the Vista).
- Inspector 5×5 / markers / no out-of-bounds Walls / focus Vista switch-repeat-Escape are
  covered by `e2e/dev-inspector.spec.ts` (negative assertions at `:301-302,305`), which is
  **pre-existing** from #540, not this branch.
- Caveat: `dispatcher.test.ts` is **untouched by the branch**, so "independently test" is
  satisfied by pre-existing coverage rather than by new work here. That is acceptable given the
  ticket's own rule that earlier tickets own their tests, but it should not be read as new
  evidence produced by #541.

### A5. "Audit active source/tests/eval paths for retired assumptions. Distinguish intentionally historical schemas/fixtures/docs from live dependencies; do not delete history indiscriminately."

**Verdict: met, with two misses.**

The audit was performed and recorded, and provenance was genuinely preserved rather than
bulk-deleted. I spot-checked all seven preserved items in `docs/evals/direction-eval-retarget-541.md`
and they hold (see DOC ACCURACY). But two live stale references inside the *very file the audit
touched* were missed: `evals/daemon-action-variation/scenarios.ts:37` ("front arc") and `:225`
("paired space directly ahead"). See W1/W2.

### A6. "Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm smoke` … Use the documented local-safe Worker setup when authentication is unavailable…"

**Verdict: met — all five independently reproduced green.** See GATES.

### A7. "Record commands/results and remaining failures on the map. Do not fabricate passing evidence or weaken assertions to hide a mismatch. Live model eval execution requires available approved access; deterministic scoring/tooling validation must work without it."

**Verdict: met.**

- No fabrication: the test-count claim (81 files / 1830 tests) is exactly what I measured.
- No weakened assertions: see WEAKENED ASSERTIONS — the diff contains **no** `toBe`→`toBeTruthy`
  loosening, **no** `toBeDefined` substitution, and **no** deleted assertion other than ones that
  asserted the *retired* `face` tool and relative vocabulary. The single added `toBeGreaterThan(0)`
  (`eval-scoring.test.ts:381`) sits *alongside* exact `toBe(2)` assertions, not in place of them.
- Live evals honestly disclosed as not run (PR "Not proven" section and audit doc "Not proven",
  `:98-107`), and the deterministic half genuinely does work without model access — the scoring
  modules are pure and are imported and executed by the Vitest suite that passes.

### A8. "Close the implementation map only when all children … are complete and the coherent change has landed."

**Verdict: not applicable to this branch** — that is the map's (#535) closing condition, and
#544 remains open. The PR correctly says "Part of #535" rather than closing the map.

## AXIS 2 — STANDARDS

### Commit messages vs `docs/agents/commits.md` + Conventional Commits 1.0.0

All five subjects are valid Conventional Commits with the approved `evals` scope, lowercase
imperative descriptions, and no trailing periods. Two exceed the documented ≤72-char limit:

- **`a75af01`** — `refactor(evals): score approved cardinal movement instead of retired relative directions` = **88 chars**.
- **`1ee5f0c`** — `refactor(evals): retarget the direction eval runner onto cardinal movement` = **74 chars**.

The PR title (`refactor(evals): retarget direction eval tooling onto the cardinal model`) is a valid
squash subject at exactly 72 chars — but it is typed `refactor`, and per `commits.md:29` `refactor`
means "no behaviour change" and triggers **no release bump**. This branch's own audit doc calls the
injected-chat retarget "an intentional behaviour change" (`direction-eval-retarget-541.md:37-39`),
and `looksLikeFreeTextAction` genuinely changed its answer for `"I turn left."` (true→false) and
`"I face east."` (a new `false`). A real behaviour change typed as `refactor` is a changelog
correctness issue: it will silently not appear in `CHANGELOG.md` and will not bump the version.
Whether `evals/` is release-relevant at all is arguable, but the type must not contradict the
branch's own characterization.

### Testing standards (`docs/agents/testing.md`)

- **Does this change require a Playwright spec?** Per `testing.md:17`, a Playwright spec is required
  when you "change anything under `src/spa/` that affects rendered DOM, user interaction, or the
  loaded-page experience". This branch changes **no `src/spa/` production file** — the only `src/`
  edits are two test files under `src/spa/game/__tests__/`. `evals/` is not the SPA, is not bundled
  into `dist/`, and is not reachable from the loaded page. **Therefore the Playwright requirement
  does not apply, and the absence of a new `e2e/` spec is correct, not a gap.** I state this
  explicitly because the rule is easy to over-apply to any `src/spa/**` path.
- The Vitest-jsdom surface is the right one for the two changed test files, and they are correctly
  placed under `src/spa/game/__tests__/` (jsdom per `testing.md:9`). The eval code they import lives
  outside `src/`, which is unusual but pre-existing and unchanged in principle.
- The typecheck gap is real and disclosed: `tsconfig.json:8` includes only `src/**/*.ts`, and no
  tsconfig references `evals/` (verified by grep). `pnpm typecheck` passing says **nothing** about
  any eval file. The branch disclosed this and filed #557 (verified OPEN: "CI: nothing typechecks
  the evals/ tree"). Credit where due — but it also means the runner retarget in `1ee5f0c`, which
  also fixed pre-existing type rot (`createGame`/`startPhase`/`PhaseConfig` → `startGame`), is
  validated only by ad-hoc execution. **Unverified by any CI gate.**

### Domain / vocabulary (`CONTEXT.md`, ADR 0015)

Prose in the changed files uses the glossary correctly. `Vista`, `Cardinal directions`,
`Interaction range`, and `Wall` are used per `CONTEXT.md:72-89`; every occurrence of a retired
term (`cone`, `facing`, `face`, `horizon landmarks`) is framed as **retired** or is a quoted
historical rationale, consistent with `CONTEXT.md:184-195`. No new vocabulary was invented, and no
`examine`/`look` tool was reintroduced (grep for `` `look` `` as a tool → no matches). One
misuse-adjacent spot: `scenarios.ts:53` still says "investigating (pick_up)" beside "(go/look)"
where `look` is not a tool — a leftover of the same unswept comment block as W1/W2.

### Docs placement (`docs/agents/domain.md`)

`docs/evals/` as a directory holds **runner-generated, dated run artifacts** by an established
convention: `relative-directions-2026-05-11.md`, `free-text-drift-2026-05-17.{md,json}`, and the
subdirectories `content-pack-flakiness/` and `daemon-action-variation/`, whose `handoff.md:216`
documents output as `<mode>-<date>.{md,json}`. The runners write those paths literally
(`runner.mts:698`) and `biome.json:10` even ignores `docs/evals/**/*.json` as generated output.

`direction-eval-retarget-541.md` is **not** a runner output and is **not dated**; it is a
hand-written, issue-scoped audit record. It breaks the directory's naming convention and will sit
alongside machine-generated reports where a reader reasonably expects generated content. A more
consistent home would be a hand-authored location (e.g. `docs/agents/` alongside other process
records, or a task-scoped docs directory) or, if it must stay, a dated name in the existing
convention. No documented rule forbids `docs/evals/`, so this is a consistency finding, not a
violation of a written standard.

### Dead code / leftovers

None introduced. No commented-out code, no `TODO`/`XXX` added (35 added `//` lines are all
explanatory prose or JSDoc). The retired symbols were removed cleanly with no dangling references.

## WEAKENED ASSERTIONS

**None that hide a mismatch.** I read both test diffs line by line.

- No `toBe(x)` → `toBeTruthy()`/`toBeDefined()` substitution anywhere in the branch.
- No `expect` removed except ones asserting **retired behaviour**:
  - `extracts direction from a face tool call` (deleted) — asserted a tool that no longer exists.
    Replaced by `extracts every cardinal direction from a go tool call` (a *stronger* loop over all
    four cardinals) plus a new negative case (`left` → `undefined`).
  - `expect(s.toolCallCountsByName.face).toEqual([0, 1, 0, 0])` (deleted) — asserted per-tool
    bucketing for the retired `face` tool. Its removal slightly reduces the test's discrimination
    (the assertion proved the per-tool breakdown distinguishes tools; the surviving `go`/`message`
    assertions still do, so the loss is small).
  - `parseStatedDirection("I see something interesting to my left.")` → `null` (deleted) — the
    replacement coverage is real: `eval-scoring.test.ts:231-238` asserts `null` for
    `forward`/`left`/`back`/`ahead`, which is strictly broader.
- Assertions moved, not loosened: `cardinalLeakCount` → `cardinalStatementTurns` +
  `cardinalReferenceCount` (two exact `toBe` assertions replacing one), and the consistency test's
  `expect(score.passed).toBe(true)` at `:354` is preserved.
- Test counts went **up**: `eval-scoring.test.ts` 42→49 `it(` blocks; `drift-scoring.test.ts`
  28→30. Consistent with the reported +9 net (1821→1830), which I reproduced exactly.

One judgement call worth naming: `drift-scoring.test.ts` now asserts that `"I turn left and walk."`
is **not** a free-text action (`:151`), with the comment "unchanged pre-existing behaviour". That
is accurate — `FREE_TEXT_ACTION_RE` only matches a verb immediately after the subject, so `turn`
never matched there. But the branch *also* removed `turn|face` from the regex
(`free-text-drift/scoring.ts:184`), which **does** change `looksLikeFreeTextAction("I turn left.")`
from `true` to `false`. The test documents the outcome; the commit type does not (see Standards).

## DOC ACCURACY (`docs/evals/direction-eval-retarget-541.md`)

Spot-checked eight specific claims against the code:

| Claim | Holds? |
|---|---|
| `runner.mts:461` = "`give` removed by #466–#472, `face` retired with facing itself" | **Yes** — exact text at `:459-461` |
| `scoring.ts:49` = "`face` drifted this way once", exhaustive-key rationale | **Yes** — `:49-51` |
| `SKILL.md:21` = ADR 0015 retired `face`, Daemon has position but no orientation | **Yes** — `:20-22` |
| `runner.mts:8-10` = name "retained for history only" | **Yes** — `:9-10` |
| `e2e/dev-inspector.spec.ts:302,305` = negative assertions, no direction/facing/compass | **Yes** (off-by-one: the regex is at `:301-302`, the attribute loop at `:304-305`) |
| `e2e/persistence-reload.spec.ts:469-470` = no `facing`/`landmark` in saved bytes | **Yes** — exact at `:469-470` |
| `session-codec.ts:96`, `save-serializer.ts:16,51` = v12/v5 retirement notes | **Yes** — `:96`, `:15-17`, `:51` |
| `"silence-in-the-face-of-input"` at `runner.mts:222` is an idiom | **Yes** — `:222` |
| flake = "`sessions-picker.spec.ts` timing out waiting for `#begin` … the race the tip commit (#556) was addressing" | **No** — see below |
| drift pack geometry ("flashlight, wall_mount and pillar" in Vista; cluster/panel outside) | **Yes** — recomputed: `dx²+dy²` = 1, 4, 2 in Vista; clipboard/panel = 5, outside. Arithmetic correct. |
| baseline 81 files / 1821 tests, +9 net | **Consistent** — I measured 81/1830 at HEAD |

**The flake attribution is wrong.** `e2e/sessions-picker.spec.ts` contains **no `#begin` reference
at all** (`grep -n "#begin" e2e/sessions-picker.spec.ts` → nothing); it waits on `#sessions-screen`
(`:115,180,215`). `#begin` appears only in `e2e/start-screen.spec.ts:149,168,205,317`. And the tip
commit `e28e5f9` — the one the doc credits — touched **only `e2e/start-screen.spec.ts`**
(+16/−7), adding `skipDialup=1` to defuse exactly that `#begin` race. So the doc has conflated the
two specs: the `#begin` flake and its #556 fix belong to `start-screen.spec.ts`, not
`sessions-picker.spec.ts`. My own `pnpm smoke` run passed 62/62 including all 12
`sessions-picker` tests, so the *outcome* the doc reports (flaky on main, passes on rerun/isolation)
is not contradicted — but the causal explanation attached to it is inaccurate, and it is the one
claim in the doc that a reader would use to decide whether to trust the flake.

Everything else I checked in the doc was substantively accurate and notably candid (the
not-proven list, the #557 gap, the "no live model run" disclosure).

## GATES

Independently reproduced on `87c775f`, all five green:

| Command | Result |
|---|---|
| `pnpm lint` | **PASS** — "Checked 220 files … No fixes applied" (matches PR claim of 220 files exactly) |
| `pnpm typecheck` | **PASS** — exit 0 across 3 projects (`tsconfig.json`, `src/proxy/tsconfig.json`, `tsconfig.e2e.json`) |
| `pnpm test` | **PASS** — **81 files / 1830 tests**, exit 0 (matches PR claim exactly; baseline 1821) |
| `pnpm build` | **PASS** — `dist/index.html + dist/assets/index.{js,css}` |
| `pnpm smoke` | **PASS** — **62 passed**, exit 0, no flakes on this run |

Note on `pnpm smoke`: the run completed in ~45s with zero failures, so no isolated re-run was
needed. This branch does not touch `e2e/`, so smoke is a regression check on unchanged specs — it
cannot validate any eval-scoring change, and its pass should not be read as evidence about them.

**What the gates do not cover:** no tsconfig includes `evals/`, so `pnpm typecheck` validates none
of the retargeted eval code. The eval modules are exercised only indirectly, via the two Vitest
files that import `evals/relative-directions/scoring.ts` and `evals/free-text-drift/scoring.ts`.
The two `runner.mts` files are **not** imported by any test and are therefore **unverified by CI**
— they are validated only by the branch author's ad-hoc execution, which I did not reproduce
(no model access).

## FINDINGS

**[major]** `docs/evals/direction-eval-retarget-541.md:89-96` — the flake attribution names
`sessions-picker.spec.ts` waiting on `#begin` and credits `#556`; both are wrong. `#begin` is a
`start-screen.spec.ts` gate, and `e28e5f9` fixed only that file. The doc's central reassurance
about the smoke flake rests on a misdiagnosis.

**[major]** `evals/daemon-action-variation/scenarios.ts:225` — `description: "Holding objective
item, paired space directly ahead. Tests \`use\` emission."` is a live relative-direction
description ("directly ahead") left unchanged by a commit whose stated purpose was to remove "stale
cone scene prose" — while the function doc directly below it (`:100-103`) *was* rewritten to
"one step north of the actor". The file now contradicts itself about the same fixture.

**[minor]** `evals/daemon-action-variation/scenarios.ts:37-38` — `/** Shared peer placements — kept
off the actor's front arc …*/` still uses the retired "front arc" term (`CONTEXT.md:82` lists
"Front arc (retired)"). Same file, same unswept comment block, despite the ticket's explicit
instruction to audit this file.

**[minor]** PR title / `d85c08d` typing — a genuine behaviour change (`turn`/`face` removed from
`FREE_TEXT_ACTION_RE`, chat retargeted as the branch itself flags) is typed `refactor`, which
`docs/agents/commits.md:29` defines as "no behaviour change" with no release bump. The squash title
is the changelog source of truth, so this will be silently omitted.

**[minor]** `docs/evals/direction-eval-retarget-541.md` placement — `docs/evals/` follows a
runner-generated, dated-artifact convention (`<name>-<date>.md`; `handoff.md:216`); this
hand-written, undated, issue-numbered audit breaks it.

**[minor]** `a75af01` subject is 88 chars, `1ee5f0c` is 74 — both over the ≤72 limit in
`docs/agents/commits.md:18`. In-PR commits are discarded by the squash, so impact is low.

**[minor]** Acceptance bullet A3 is answered by pre-existing coverage only. Every listed flow element
was already covered at `e28e5f9`; the branch adds no new integration test. Two endgame paths (Same
Daemons New Room, Continue) are asserted *visible* but never clicked, and the USB export flow has no
e2e. Presenting #541 as producing final integration evidence overstates what the branch contributed
— though it does not *defer* any test.

**[nit]** `evals/daemon-action-variation/scenarios.ts:53` — "(go/look)" still names `look`, which has
never been a tool in the current surface (`CONTEXT.md:117`); a leftover of the same comment block.

**[nit]** `e2e/witnessed-event-reload.spec.ts:176,208` — comments describe placing a witness "1 cell
BEHIND the actor", i.e. reasoning in the retired relative frame. Behaviourally it is a geometry
offset (opposite the direction of travel) and the test passes, so this is wording only — but the
file is named in the ticket's own "Starting surface" list.

**[nit]** The audit doc cites `e2e/dev-inspector.spec.ts:302,305` for the negative assertions; the
actual lines are `301-302` and `304-305`. Trivial drift, claims still true.

**No blocking findings.** Nothing here corrupts runtime behaviour, weakens a test to hide a
mismatch, or fabricates evidence. The scoring inversion — the actual defect the ticket was raised
to fix — is correctly and thoroughly repaired, with all four coherence cases tested end-to-end.

## RECOMMENDATION

**merge-after-fixes** — the code change is correct and all five gates are green; the fixes needed
are one inaccurate doc claim (W1 flake attribution), two unswept retired-term comments in the file
the audit explicitly covered (W2/W3), and a commit-type/changelog correction. None of these require
re-running the eval retarget itself.

---

*Review-only pass. No source file was modified. The only writes are this file and the matching
PR comment.*
