# Handoff — Temperament-derived action profiles

Everything needed to pick up, finish, and ship the daemon action-profile
feature. Written at PR [#474](https://github.com/CorVous/hi-blue/pull/474).

---

## 1. What the feature is

Daemons emit `message` tool calls constantly but rarely touch the
action surface (`go` / `face` / `pick_up` / `put_down` / `use`), even
though a turn can carry a message *and* an action together. The action
profile is a per-persona prompt clause that nudges each daemon toward
varied action emission, with the variation **tied to temperament** —
so a `curious + meticulous` daemon behaves differently from a
`zealous + hot-headed` one.

It is the action-axis counterpart to `engagement-clauses.ts` (which
shapes *whether* a daemon speaks). This feature shapes *which actions*
it takes when it acts.

Rendered into the system prompt as an `<action_profile>` XML block,
e.g.:

> `*ember leans toward `face`, `use` (~70% of action emissions). The
> remaining ~30% spreads across the other available action tools —
> don't fixate on a single tool. Variety beats repetition.`

---

## 2. Current status

| Piece | State |
|---|---|
| Bias module + prose generator | ✅ built, unit-tested, calibrated for the merged 5-tool surface |
| `AiPersona.actionProfile` field | ✅ added (optional, save-compatible) |
| `<action_profile>` prompt rendering | ✅ built, tested |
| `?actionProfiles=1` opt-in flag | ✅ plumbed end-to-end |
| Eval harness | ✅ built, runs natively against the merged engine |
| Eval data — real merged surface | ❌ **not yet collected** (see §6) |
| Enabled by default | 🟢 **decided: yes** — ship action profiles ON; see §4 for the rollout |
| Default flipped in code | ❌ not yet — calibration is the gate (see §4, §6) |
| Bias table calibration | 🟡 first-pass; needs tuning against fresh eval data |

**The decision is made: action profiles ship ON by default.** The
feature is wired and the merge is safe — it is still byte-identical to
current production *until the default is flipped*. What remains is
calibration against fresh native eval data, then flipping the default
(§4) and validating (§6).

---

## 3. Architecture & files

### Production code

| File | Role |
|---|---|
| `src/content/action-preference-bias.ts` | The bias table + clause generator. The brain of the feature. |
| `src/spa/game/types.ts` | `AiPersona.actionProfile?: string` field. |
| `src/content/persona-generator.ts` | `generatePersonas(..., { actionProfiles })` calls `actionProfileFor` and sets `persona.actionProfile` when the flag is on. |
| `src/spa/game/prompt-builder.ts` | `AiContext.actionProfile`; `renderSystemPrompt` emits the `<action_profile>` block between `<personality>` and `<typing_quirks>`. |
| `src/spa/game/bootstrap.ts` | `BootstrapOpts.actionProfiles` → forwarded to `generatePersonas`. |
| `src/spa/routes/start.ts` | Reads `?actionProfiles=1` from the URL into `BootstrapOpts`. |

### Data flow

```
?actionProfiles=1  (URL)
  → start.ts reads it
  → BootstrapOpts.actionProfiles
  → generateNewGameAssetsSplit → generatePersonas(rng, llm, { actionProfiles: true })
  → actionProfileFor(name, t1, t2)  ── derives clause from temperament pair
  → persona.actionProfile = "<clause>"
  → (persisted on the persona; save-compatible — field is optional)
  → buildAiContext → AiContext.actionProfile
  → renderSystemPrompt → "<action_profile>\n<clause>\n</action_profile>"
```

### How the clause is derived

1. `ACTION_TOOL_BIAS` — each of the 24 temperaments has a `[-2,+2]`
   affinity for each of the 5 action tools.
2. `toolBiasSum(t1, t2)` — sums the two temperaments' biases per tool.
   The `use` channel is floored at `-1` (every daemon keeps some
   objective-completion capability — `use` is the critical-path tool).
3. `actionProfileFor(name, t1, t2)` — classifies the summed biases:
   - tools with sum `≥ +2` → **preferred** ("leans toward …")
   - tools with sum `≤ -1` → **avoided** ("is hesitant about …")
   - featureless pairs → balanced-default clause
   The clause uses a soft ~70/30 framing (see §5 for why).

---

## 4. The flag → the rollout

**Decision: action profiles ship ON by default.** Today the feature is
still opt-in (`?actionProfiles=1` in the URL, alongside
`?engagementClauses=1`) so the merge stays byte-identical to production
— but the plan is to flip the default once the bias table is
calibrated (§6).

### Flipping the default — what it takes

1. **Flip the source default.** The flag flows
   `start.ts` → `BootstrapOpts.actionProfiles` →
   `generateNewGameAssetsSplit` → `generatePersonas(..., { actionProfiles })`.
   Set the default to `true` at the `generatePersonas` call in
   `src/spa/game/bootstrap.ts` (`generateNewGameAssetsSplit`).
2. **Invert the URL flag to a kill-switch.** `src/spa/routes/start.ts`
   currently reads `searchParams.get("actionProfiles") === "1"` —
   strictly opt-in. Once ON is the default, change it so the URL can
   *disable* it (`?actionProfiles=0`) for A/B comparison and debugging,
   defaulting to ON when the param is absent. Keep the engagement-clause
   flag's pattern consistent if you touch it.
3. **Leave the merge as-is until calibration passes.** Do **not** flip
   the default in this PR — land it as a follow-up once §6 steps 1–4
   are done, so the enable is backed by fresh native eval data.

The `actionProfile` field is persisted (session-codec) and
save-compatible, so flipping the default does not need a schema bump.

---

## 5. The bias table — calibration & history

`ACTION_TOOL_BIAS` is hand-authored, first-pass, and **expected to be
re-tuned**. The iteration history matters — don't repeat dead ends:

- **v1 (prose shapes):** clauses like "examines methodically",
  "explores restlessly". Moved the aggregate dial only **±2pp** — the
  model read soft prose as permission, not direction. **Dead end.**
- **v2.0 (hard directive):** "`*vex` STRICTLY prefers `go`, `face`,
  `pick_up`. AVOIDS `examine`." Big variance (**+39pp** any-action in
  the projection) but the model went **95-100% mono-tool** on the
  leaned tool and the hard directive **suppressed messaging**.
- **v2.5 (soft 70/30 — current):** "leans toward … (~70%), remaining
  ~30% spreads across other tools" + "is hesitant about … but still
  uses them when the moment calls for it". Kept the lift, restored
  messaging, produced within-persona variety. Avoided tools keep a
  non-zero floor so cautious personas still move and use items.

**Surface migration:** the table was first authored for a 7-tool
surface (`go, look, examine, pick_up, put_down, give, use`). The
#466–#472 merge removed `examine` (descriptions auto-emit now), renamed
`look` → `face`, and removed `give`. The current table is re-authored
for the 5-tool surface: `face` carries the old `look` value, bumped
`+1` for the strong-`examine` temperaments (meticulous, pedantic,
curious) and `-1` for the strong-`examine`-averse one (glib), so the
perception signal that used to route through `examine` survives.

**Known calibration gaps:**
- Values were tuned by judgement, then sanity-checked against the eval.
  Only 3 temperament *pairs* (of 276 possible) have been eval-measured.
- `use` for some personas (e.g. `zealous + hot-headed` = +1) sits
  *between* the preferred (+2) and avoided (-1) thresholds, so it is
  named in neither list. On the `objective` scenario this slightly
  crowds `use` out. Option: add a third "LEANS TOWARD" tier for +1
  biases, or lower the preferred threshold to +1.
- Dropping `give` flattened `sweet + effusive` (Pip) — that pair's
  whole identity was `give`. It's now a generic engaged persona. Not a
  bug, just a consequence; re-tune if a distinctive sweet/effusive
  signature is wanted.

---

## 6. Open work — what's left to ship this

The end state is decided: **action profiles ON by default.** The
remaining steps are the calibration gate before flipping that default.

1. **Collect fresh eval data on the real merged surface.** All eval
   numbers in `analysis.md` came from the *pre-merge eval-local
   projection*. The harness now runs natively — re-run:
   ```bash
   EVAL_DIRECT_OPENROUTER=1 pnpm eval:action-variation                        # baseline
   EVAL_DIRECT_OPENROUTER=1 EVAL_ACTION_PROFILES=1 pnpm eval:action-variation  # treatment
   ```
   Needs `OPENROUTER_API_KEY` in env. ~$0.25 per run, ~15 min each.
   Output lands in `docs/evals/daemon-action-variation/`.
2. **Compare baseline vs. treatment** on the native surface. Confirm
   the +action-emission lift survives the surface change and that
   messaging stays healthy. Update `analysis.md`.
3. **Re-tune `ACTION_TOOL_BIAS`** if the native data shows the
   thresholds or per-tool values are off. Re-run until stable across
   ~3 consecutive runs.
4. **Widen the temperament coverage** — run `EVAL_ACTION_PAIRS` across
   more pairs (or all 24 temperaments) to catch pairs whose clause
   reads badly or whose behaviour doesn't match the bias.
5. **Decide whether `use` needs the third tier** (§5).
6. **Flip the default ON** (§4) — set `actionProfiles: true` in
   `bootstrap.ts` and invert the URL flag to a `?actionProfiles=0`
   kill-switch. Land as a follow-up PR once steps 1–5 are done, so the
   enable is backed by fresh native data. Consider one playtest with
   the URL flag before flipping, but the default destination is ON.
7. **Drop `preview.html`** — it's a throwaway eval-results preview
   (html-preview skill), not part of the feature. Exclude from merge.

---

## 7. The eval harness

`evals/daemon-action-variation/` — a real-LLM harness measuring
tool-call distributions.

- **Shape:** 3 scenarios (`exploration`, `objective`, `social`) × N
  persona variants (default 3), each scenario replayed `REPETITIONS`
  times (default 20) against a frozen initial state — so the per-cell
  distribution is a tool-choice *probability*, not round-to-round drift.
- **Run:** `pnpm eval:action-variation`. `EVAL_ACTION_PROFILES=1` =
  treatment; unset = baseline.
- **Env:** `OPENROUTER_API_KEY` + `EVAL_DIRECT_OPENROUTER=1` (or a
  local proxy worker at `EVAL_BASE_URL`). `EVAL_MODEL`,
  `EVAL_REPETITIONS`, `EVAL_ACTION_PAIRS` (comma-separated `t1+t2`)
  override defaults.
- **Output:** `docs/evals/daemon-action-variation/<mode>-<date>.{md,json}`.
- See `evals/daemon-action-variation/SKILL.md` for full detail.

The harness runs **natively** against the merged engine — there is no
tool projection (an earlier `EVAL_TOOL_SURFACE=5tool` shim was removed
once the surface change merged).

---

## 8. Tests

- `src/content/__tests__/action-preference-bias.test.ts` — bias table
  coverage, `[-2,+2]` range, `use` floor, clause shape, and a guard
  that no clause ever names a removed tool (`examine`/`look`/`give`).
- `src/spa/game/__tests__/prompt-builder.test.ts` — `<action_profile>`
  block present only when set, positioned correctly, per-persona.

`pnpm test` (full suite), `pnpm typecheck`, `pnpm lint` all green on
the branch.

---

## 9. Risk notes

- **This PR is still safe to merge** — the default is not flipped here;
  it stays opt-in until the calibration gate (§6) clears. Flipping the
  default to ON is a deliberate follow-up.
- **When the default flips**, every new game gets action profiles.
  That's the intended end state — but it's why the calibration gate
  exists: a mis-tuned bias table would ship to all players at once.
  Validate with fresh native eval data first.
- The bias table is a content artifact, not load-bearing logic — a bad
  value produces a slightly-off clause, never a crash.
- `actionProfile` is an optional field — saves written before the
  feature load fine (the `<action_profile>` block is simply skipped).
- The action-heavy directive can mildly suppress messaging when the
  daemon already knows what to do (seen on `objective` cells). The
  engagement-clause module is the intended counter-pressure; watch the
  message rate in the native eval.
