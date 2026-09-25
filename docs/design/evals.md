# Eval harness design notes

The harnesses under `evals/` drive the real game engine against a live model
(`z-ai/glm-4.7` unless overridden) and write dated reports to `docs/evals/`.
They are not part of CI, but `tsconfig.tools.json` typechecks them. Two scoring
modules are unit-tested from `src/spa/game/__tests__/`
(`drift-scoring.test.ts`, `eval-scoring.test.ts`) so their heuristics cannot
rot without anyone noticing. The scoring modules are pure: no I/O and no
module-level fetch.

## Shared conventions

- **Model access.** Runners send requests to the proxy worker at
  `EVAL_BASE_URL` (default `http://localhost:8787`). Start it with
  `pnpm dev:local` (or `pnpm dev` if you are logged in to Cloudflare). Setting
  `EVAL_DIRECT_OPENROUTER=1` (drift and action-variation) makes the runner call
  OpenRouter directly with `OPENROUTER_API_KEY` as a Bearer token. Use that
  when wrangler cannot run locally, or to measure without the proxy's rate
  guard in the loop. `content-pack-flakiness` always calls OpenRouter directly.
- **Dispatch mirrors production.** Each runner turns the model's tool calls
  into an `AiTurnAction` the same way the round coordinator does before
  calling `dispatchAiTurn`: messages are collected, the first non-message tool
  call becomes the action, and a turn with neither is dispatched as a pass so
  budget and round state still advance on silent turns.
- **Budgets are set high on purpose** (`BUDGET_LARGE_ENOUGH_TO_NEVER_LOCK_OUT`)
  so a run is never cut short by a lockout and the signal stays about the
  behaviour being measured.
- **`exactOptionalPropertyTypes`**: runners attach `costUsd` only when the API
  reported one, because an explicit `undefined` is rejected.
- **Counts sorted by hand.** `byDescendingCount` walks the keys instead of
  sorting `Object.entries` tuples, because under `noUncheckedIndexedAccess` the
  tuple elements are `number | undefined` and cannot be subtracted.

## free-text-drift (`pnpm eval:drift`)

**Purpose.** Issue #260: as a phase goes on, GLM-4.7 daemons stop emitting
`message` tool calls and sometimes lapse into prose that *looks like* a message
or an action but never reaches the engine. This harness turns a captured turn
log into numbers that make that drift visible.

**Shape.** One real daemon (`red` / Ember) runs against the live model for
`EVAL_DRIFT_ROUNDS` rounds (default 30). Two inert peers (`sim1`, `sim2`) exist
only so their handles route in the conversation log; they never call the model.
Every round injects one message from `INCOMING_STIMULUS_ROTATION` (blue / sim1 /
sim2 in turn) so the daemon always has stimulus: silence then means drift, not
lack of input. The one-shot drift-recovery retry from `runRound` (#254) is
deliberately **not** applied. The harness measures the raw first response so
the #260 format-drift hypothesis can be judged cleanly.

**Stimulus.** The rotation mixes plain chat with action nudges for every tool
family (`pick_up`, `use`, `put_down`, `go`), so a single run exercises the whole
tool surface and the per-tool series carry real signal. Nudges suggest rather
than order, so silence after a nudge still counts as drift rather than refusal.

**Open question (#557, deliberately undecided).** Under #541 the fixtures moved
from relative wording ("the panel on your right", "head back") to cardinal
wording, because a daemon has no orientation and cannot act on "right". That
leaves open what the eval measures: (a) how a daemon handles *incoherent*
input, in which case the relative wording should come back and be labelled as
intentional, or (b) action versus silence under *coherent* stimulus, in which
case the fixtures stay cardinal and should say so. The owner has to decide; the
fixtures are left as #541 left them until then.

**Pack layout** (`makeSubwayStationPack`, 5×5, row 0 at the top, red at row 2,
col 2): flashlight (1,2), wall_mount (0,2), pillar (3,3), clipboard (0,1),
panel (0,3), sim1 (4,0), sim2 (4,4). Flashlight, wall_mount and pillar sit
inside red's 13-cell Vista, so there is something to look at from round 1 and
somewhere for `go` to lead. Clipboard and panel lie outside it and are known
only by rumour. No daemon starts within interaction range of another, so cheap
stimulus does not inflate message counts. The run sets no `objectiveTypes`:
the hand-authored pack cannot support one, because `buildObjectiveRecords`
resolves targets by type-first convention ids (`carry-0-obj`, …) that only
`binding-prompt-builder` packs carry (#494).

**Scoring** (`scoring.ts`):

- `TurnRecord.assistantText` is the raw content from *before* any tool-call
  extraction or retry, because that is where the drift signal is.
- `parseToolCallDetail` strips a leading `*` from handles, matching the
  dispatcher's tolerance of parroted handles in `parseToolCallArguments`.
- `direction` is read from the arguments whatever the tool is called. Only `go`
  carries one today, but tying the direction series to the argument rather than
  to a tool name keeps it valid if the tool surface changes. Movement is
  cardinal only (ADR 0015), so the axis is north/south/east/west.
- The free-text heuristics are best-effort regexes, and false negatives are
  acceptable. A *message leak* is first-person speech ("I tell *xxxx…"), quoted
  dialogue, or a direct address ("*xxxx:", "blue,") in a turn with no `message`
  call. An *action leak* is a first-person physical verb ("I go north", "I pick
  up…") in a turn with no non-message tool call.
- `silenceRate` counts turns with no tool call at all. `messageSilenceRate`
  counts turns with no `message` call, which is the subtype #260 is about:
  GLM keeps emitting `go` long after it stops talking.
- Recipient buckets: `blue`, each known AiId, `unknown` (an invented handle, a
  useful signal on its own) and `malformed` (missing or unparseable).
- `buildPerRoundSeries` returns arrays aligned with `rounds` so any pair can be
  plotted directly. Turns that share a round are summed. Every key seen
  anywhere in the run is zero-filled in every round, so series lengths never
  vary.
- `DEFAULT_SILENCE_WINDOW_ROUNDS` = 5 suits the 30-round playtest (override
  with `EVAL_DRIFT_WINDOW`).

**Output.** `docs/evals/free-text-drift-<date>.md` (aggregate, rolling window,
per-turn transcripts) and `.json` (meta, summary, per-round series, turns).

## relative-directions (`pnpm eval:directions`)

**Purpose.** Checks that a daemon uses the approved cardinal vocabulary (ADR
0015, CONTEXT.md **Cardinal directions**): it names north/south/east/west for
movement and positions, and the cardinal it *states* matches the cardinal its
`go` call *uses*. The directory, script and report prefix
(`HISTORICAL_REPORT_PREFIX`) keep the name `relative-directions` for history
only. The relative vocabulary (forward/back/left/right), facing, and any
cardinal↔relative conversion are retired and must not come back here.

**Shape.** Three scenarios in an empty 5×5 vault (`makeEmptyVaultPack` has no
entities, so the daemon has open space to move through rather than scenery to
name): `look-and-navigate` (6 free turns); `navigate-then-describe` (3
navigation turns, then 2 turns where the user asks for a cardinal description);
`peer-location-reference` (2 navigation turns, then 2 turns describing its own
location to another player). In the describe turns of `navigate-then-describe`
the `go` direction is not scored: the question asks for a description, not a
move. Any tool calls are still dispatched so the game state keeps up.

**Prose.** `daemonProse` joins the raw assistant text with the `content` of every
`message` call. GLM-4.7 speaks mostly through the message tool, so scoring only
the raw text would undercount what the daemon said.

**Movement vs position** (`scoring.ts`). Prose names a cardinal for two
reasons. A *movement* statement ("I'll go north", "I'll start exploring north")
declares an intent and must match the `go` call. A *position* statement ("two
steps north", "north of me", "clear to the south") says where something is and
can never disagree with a move. Treating the two as one produced a real false
positive: a turn that described its corner ("Wall one step north … Clear to
the south, east, and west") while correctly moving south was scored `mismatch`.
So:

- Coherence is decided from movement statements only. `structuralCoherence`
  takes a *movement* direction. `structuralCoherenceForTurn` and
  `scoreScenario` re-derive movement from `text` when a record lacks
  `movementStatement`, so a caller cannot bring back the old
  description-as-move behaviour by leaving the field out. That is why the
  scoring module owns the split.
- `parseStatedCardinal` / `statedDirection` stay as the broad
  "any directional statement" parser, used for reporting only. The report's
  "Stated" column shows the movement direction, so it can never contradict the
  printed verdict or the run's PASS/FAIL.
- When prose contains both, movement wins.
- `NOT_AFTER_DISTANCE_COUNT`: a count word directly before the verb means a
  distance phrase ("one step north"). "step" is spelled the same as a noun and
  as a verb, and that is exactly how a room description was once read as a move.
- `turn` is not a movement verb: ADR 0015 removed facing, so there is nothing to
  turn.
- Cardinal detection: full words match in any case, with word boundaries so
  "northern" does not count. Single letters N/S/E/W match **uppercase only**,
  because the case-insensitive version fires on possessives ("water's edge").
  A false positive on sentence-final initials ("Daemon N.") is accepted as the
  lesser evil.
- Pass rule: no movement/`go` mismatches. Naming cardinals is measured as
  evidence (`cardinalStatementTurns`, `cardinalReferenceCount`) and never
  fails a run. Regex parsing is best-effort: false negatives are fine, but a
  wrong direction or a description parsed as movement is not. No LLM judge is
  used; a human reading the transcripts is the qualitative gate.

**Output.** `docs/evals/relative-directions-<date>.md`. The process exits 1 if
any scenario fails.

## daemon-action-variation (`pnpm eval:action-variation`)

**Purpose.** Measures how often each tool gets called, per persona variant and
per scenario. Unlike free-text-drift, which follows one daemon over 30 rounds,
this harness freezes one scenario and replays the *same* first turn
`EVAL_REPETITIONS` times (default 20), rebuilding a fresh `GameState` every
time. The result is the model's probability distribution over the shipped tool
surface (`go` / `pick_up` / `put_down` / `use` + `message`, after the ADR 0015
Vista cutover; `examine` and `give` were removed in #466–#472 and `face` was
retired with facing). The dispatch is only for parity with the live path; the
resulting state is thrown away. `SKILL.md` in the directory has the operator
guide, and `docs/evals/daemon-action-variation/handoff.md` has history.

**Knobs.** `EVAL_ACTION_PROFILES=1` turns on `actionProfiles` (the
`with-profiles` mode against `baseline`). `EVAL_ACTION_PAIRS="t1+t2,…"`
replaces the three default variants, which cover the bias axes: use-leaning,
go/pick_up-leaning, and balanced. Every variant uses AiId `red`, which is safe
because only one variant is instantiated at a time. `EVAL_SCENARIOS` limits the
run to some scenarios; an unknown name is a hard error so a typo cannot run the
whole matrix while the operator thinks it is scoped. `EVAL_RUN_LABEL` is added
to the output file stem.

**Scenarios** (`scenarios.ts`). The actor is at (2,2) and the peers are at
(4,0) and (4,4), outside its interaction range and its 13-cell Vista, so they
cannot create pickup or message opportunities by accident.
*exploration*: empty-handed, one unknown item (switchbox) in reach and two
beyond the Vista; tests `pick_up` versus `go`. *objective*: holding the
flashlight with the wall mount one step north; tests whether the daemon reaches
for `use`, the critical-path tool. *social*: a peer has just messaged; tests
whether message and action are emitted in parallel. An earlier `EXAMINATION`
scenario was dropped with the 5-tool surface change: with `examine` gone and
descriptions shown automatically, it tested nothing new and its cells were
pinned at 95–100% `pick_up`.

**Pure-avoidance A/B (#508 direction 1).** `EVAL_NO_PREFERRED_POLICY=omit`
(`PURE_AVOIDANCE_PROFILE_POLICY`) drops the `<action_profile>` block for
personas whose summed bias has *no preferred tool and at least one avoided
tool*, where the clause is only "is hesitant about …". The question is whether
that clause reinforces inaction. The scope is intentionally narrower than "no
preferred tool": of the 300 unordered temperament pairs, 174 have no preferred
tool, but only 84 render the pure-avoidance clause, while 90 get the balanced
clause and are left alone. Personas with a preferred tool are the same in both
arms, so any difference comes from the pure-avoidance handling alone. The
`omit` arm writes files with a `-noavoid` suffix.

*Coupling:* `rendersPureAvoidanceClause` (with `PREFERRED_TOOL_MIN_BIAS` = 2 and
`AVOIDED_TOOL_MAX_BIAS` = -1, critical-path tools never counted as avoided)
must match the branches of `actionProfileFor` in
`src/content/action-preference-bias.ts` exactly. Testing `bias >= 2` alone
would also catch the balanced group. If `actionProfileFor` changes, update the
predicate.

**Scoring** (`scoring.ts`). The tool buckets come from `ACTION_TOOLS` in
`src/content/action-preference-bias.ts`, and the bucket records list their keys
exhaustively, so adding or removing a tool is a type error rather than silent
drift. (`face` once drifted like that and left `toolBiasSum` indexed by a column
the table no longer had.) Run-level rates are weighted by repetition count
(sum of counts / sum of repetitions), so scenarios of different sizes combine
correctly.

**Output.** `docs/evals/daemon-action-variation/<mode>[-<label>][-noavoid]-<date>.{md,json}`,
where `<mode>` is `baseline` or `with-profiles`.

## content-pack-flakiness (`pnpm eval:content-pack-flakiness`)

**Purpose.** Replays the production dual content-pack retry loop
(`BrowserContentPackProvider.generateDualContentPacks`, ADR 0010) against
OpenRouter to show which validation rules fail in practice. The model call
mirrors `chatCompletionJson` (JSON response format, reasoning off, usage
included) but goes straight to OpenRouter.

**Shape.** Each iteration draws a fresh pair of settings, a theme, weather and
time of day for each side, 1–3 obstacles and `OBJECTIVE_TYPES_PER_PACK` (3)
objective types, then runs the `OUTER_BUDGET` = 3 loop as production does:
corrective feedback after a validation failure, and a clean restart after a
hard error (network, empty content, JSON parse).

**Needs.** `OPENROUTER_API_KEY`. Knobs: `EVAL_ITERATIONS` (default 10),
`EVAL_PARALLEL` (default 1, the number of iterations in flight), `EVAL_MODEL`
(default `PINNED_MODEL`).

**Output.** A summary on stdout (first-try versus after-retry success,
exhausted, thrown, histograms by rule and by retry unit, cost) and
`docs/evals/content-pack-flakiness/<timestamp>.json`.
