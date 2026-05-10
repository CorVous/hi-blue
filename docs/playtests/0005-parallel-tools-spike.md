# Playtest 0005 — `parallel_tool_calls` spike on GLM-4.7

Gates issue [#238](https://github.com/CorVous/hi-blue/issues/238) (parallel
speak+act on the same Daemon turn). The premise: give the round-coordinator
both a `message` and an action tool call from a single assistant message,
emitted with `parallel_tool_calls: true`. The spike measures whether GLM-4.7
actually emits the parallel pair when speak+act is warranted; if the rate is
too low, #238's plumbing buys nothing observable.

See [#239](https://github.com/CorVous/hi-blue/issues/239) for the full method
and decision matrix.

## Session metadata

- **Branch:** `claude/issue-239-bH2Tz`
- **Model:** `z-ai/glm-4.7` (pinned via `src/model.ts` → resolved to
  `z-ai/glm-4.7-20251222` by OpenRouter)
- **Date (wire-smoke):** 2026-05-10
- **Date (A/B run):** 2026-05-10
- **Tester:** Claude Opus 4.7 (this agent), driving the
  `scripts/playtest/daemon.mjs` Playwright session

## Code state

Three small changes land on this branch alongside this doc; production
behaviour is byte-identical when the framing toggle is off.

- `src/spa/llm-client.ts` — `parallel_tool_calls: true` added to the
  `streamCompletion` body when `tools` are present.
- `src/spa/game/browser-llm-provider.ts` — `console.log("[spike-239]
  toolCalls=…")` after each `streamRound` so devtools captures the per-turn
  tool-name array.
- `src/spa/game/prompt-builder.ts` — `getParallelFraming()` reads
  `?parallelFraming=A|B` (URL) or `parallel_framing` (localStorage) and
  appends one of two extra `<rules>` lines. Off by default.

The coordinator is **deliberately unchanged** — `const [tc] = toolCalls;` at
`src/spa/game/round-coordinator.ts:195` still drops everything past the
first call, so we measure the model's tendency, not end-to-end behaviour.

## Step 1 — Wire smoke

**Question:** Does OpenRouter accept `parallel_tool_calls: true` on
`z-ai/glm-4.7`, and does the model see/honour the parameter (vs. silent
strip)?

**Method:** Two `curl` calls direct to `https://openrouter.ai/api/v1/chat/completions`,
identical tools (`message` + `move`), identical scripted user input
("blue: hey \*test, please grab the key — I'll trade you for it. Move
toward it now and tell me you're on your way."), one with the param off
and one with it on.

### Results

| Variant   | HTTP | Time   | Provider     | Prompt tok | Completion tok | Cost (USD)  | `finish_reason` | Tool calls emitted |
| --------- | ---- | ------ | ------------ | ---------- | -------------- | ----------- | --------------- | ------------------ |
| Baseline  | 200  | 13.1 s | AtlasCloud   | 357        | 135            | $0.00043539 | `stop`          | 0                  |
| Parallel  | 200  | 5.5 s  | SiliconFlow  | 395        | 241            | $0.00059915 | `tool_calls`    | 1 (`message`)      |

The two requests differ only in the `parallel_tool_calls: true` flag and a
single extra rule line in the system prompt (the Framing-B sentence —
included to give the model an opportunity to use the capability). Token
counts differ accordingly; nothing in the response shape was stripped.

The parallel-variant assistant message reasoning trace contains:

> "I need to use both the `message` tool and the `move` tool. However, I
> don't know where the key is or where I currently am in this 4x4 grid
> world."

The model demonstrably saw the parallel-tool option and considered it (then
opted for a single `message` call to ask for the missing position info).
That's the strongest single-shot signal that the param is not being stripped
upstream.

### Wire-smoke verdict: **pass** — proceed to Step 2

- ✅ Request accepted (no 4xx from OpenRouter or upstream).
- ✅ Response shape unchanged: `choices[0].message.tool_calls`, `usage` block,
  `finish_reason` are all in the expected places.
- ✅ Token cost envelope is normal GLM-4.7 (cf. playtest 0003/0004).
- ✅ Model awareness: reasoning trace mentions both tools by name.
- ⚠️ OpenRouter routed the two calls to different providers (AtlasCloud vs.
  SiliconFlow). Step 2's A/B sample size needs to absorb that as noise. If a
  single provider becomes the source of all "no parallel" responses, that's
  a separate finding.
- ⚠️ Caveat #6 in `docs/prompting/glm-4.7-guide.md` (object-typed tool-arg
  quirks) is about nested-object args inside *one* call; not relevant here,
  and the wire-smoke `message` call serialised cleanly.

Raw response bodies live at `/tmp/spike-239-resp-baseline.json` and
`/tmp/spike-239-resp-parallel.json` during the run; not committed (they're
build-time data, like `/tmp/wrangler.log` for previous playtests).

## Step 2 — A/B prompt comparison

**STATUS: complete.** Both sessions ran 30/30 scripted prompts via the
playtest daemon against `z-ai/glm-4.7` through the worker proxy. Per-turn
`toolCalls.map(c => c.name)` captured from `console.log` in
`/tmp/playtest-daemon-{A,B}.log`.

### Setup

1. Start the worker dev server with a real `OPENROUTER_API_KEY` (see
   `docs/playtests/README.md`).
2. Start the playtest daemon. Open devtools on the headless browser if you
   want the `[spike-239]` lines live; otherwise grep them out of
   `/tmp/wrangler.log` (no — those are server-side; the spike log is
   client-side, so devtools or a `console` capture is required).
3. **Pin the seed**: append `?seed=42` (or any integer) to the start URL.
   This drives a Mulberry32 PRNG with sub-streams for persona archetype
   selection, setting noun, and initial spatial placement
   (`src/spa/game/spike-seed.ts`). Re-using the same `seed=N` for the A
   and B sessions pins those structural choices across runs. Note the
   carve-out: persona blurbs / typing quirks / content-pack item names
   come from non-deterministic LLM synthesis and will still vary
   text-wise between runs — the rng-driven structural skeleton is what
   pins.
4. Use the [scripted 30-prompt sequence below](#scripted-prompts). Same
   script across A and B, same pacing. Don't ad-lib — once the
   conversations diverge, the comparison is noise.

### Scripted prompts

Each prompt is one sentence with two clauses: a **physical verb** (mapping
to one of `go` / `pick_up` / `put_down` / `give` / `use` / `look` /
`examine`) and a **speech verb** (mapping to `message`). A model that
parallel-emits should fire both tools in the same assistant message; a
model that doesn't will pick one and drop the other. Tool coverage is
deliberately spread so the rate isn't just a measurement of `message+go`.

#### Substitution

The seeded game generates three Daemons with random four-letter ids
(see `*wcjo`-style examples in playtest 0003). Before pasting prompts:

- Replace `*<A>`, `*<B>`, `*<C>` with the three ids from the seeded game,
  in **initiative order** (the order they appear in the panels strip
  left-to-right). Use the same mapping for both Framing A and Framing B
  runs — that's what the pinned seed buys us.
- Items and setting are referenced generically ("the nearest item", "the
  farthest item you can see", "an interesting object") so the script
  works regardless of what the content pack generates.

#### Pacing

Wait ~40 s between sends (`{"op":"wait","ms":40000}` then `{"op":"send",…}`).
Faster sends queue or arrive mid-round and silently get dropped onto the
wrong addressee — see the "round timing" gotcha in
`docs/playtests/README.md`. The composer addressee is sticky, so leading
each prompt with `*<id>` makes routing explicit.

#### The 30 prompts

| #  | Prompt | Target pair |
| -- | ------ | ----------- |
| 1  | `*<A> tell me what you see right now and step toward the most interesting thing in your view.` | message + go |
| 2  | `*<B> face east and describe what shifts in your view; then walk that way.` | look + go + message |
| 3  | `*<C> if there's an item in your cell, pick it up and tell me how it looks.` | pick_up + message |
| 4  | `*<A> head north one cell and report whether you're now closer to *<B> or *<C>.` | go + message |
| 5  | `*<B> walk toward whichever cardinal direction has the most stuff and narrate as you go.` | go + message |
| 6  | `*<C> turn to face whichever Daemon you can see and say hi to them as you turn.` | look + message |
| 7  | `*<A> grab the nearest interesting object and shout to blue what it is.` | pick_up + message |
| 8  | `*<B> drop whatever you're holding (if anything) and explain why you don't need it.` | put_down + message |
| 9  | `*<C> walk one cell south and tell me what's directly behind you now.` | go + message |
| 10 | `*<A> examine an item in your view and read me back what you saw.` | examine + message |
| 11 | `*<B> if *<C> is in an adjacent cell, hand them what you're holding and confirm; if not, walk toward them and say where they are.` | give + message OR go + message |
| 12 | `*<C> look west and walk west — tell me whether the view widened.` | look + go + message |
| 13 | `*<A> have we met before? walk one step in any direction while you answer.` | go + message |
| 14 | `*<B> pick up anything within reach and tell me what it weighs (you can guess).` | pick_up + message |
| 15 | `*<C> head to the farthest item you can see and announce when you get there.` | go + message |
| 16 | `*<A> step toward *<B> and say their color out loud as you move.` | go + message |
| 17 | `*<B> drop whatever you don't recognize and tell me you're certain it's not yours.` | put_down + message |
| 18 | `*<C> use whatever you're holding right now and describe what happens.` | use + message |
| 19 | `*<A> walk south and tell me if anything looks new from this angle.` | go + message |
| 20 | `*<B> grab the next interesting object you can reach and ask *<C> if they want it.` | pick_up + message |
| 21 | `*<C> bring whatever you're holding to *<A> and tell me when you've handed it over.` | go + message OR give + message |
| 22 | `*<A> if *<C> is approaching, walk toward them and let me know.` | go + message |
| 23 | `*<B> head to the corner farthest from where you started and tell me what's there when you arrive.` | go + message |
| 24 | `*<C> face north, then take one step north — narrate each move.` | look + go + message |
| 25 | `*<A> grab the most important-looking item you see and tell *<B> what it is.` | pick_up + message |
| 26 | `*<B> walk away from *<A> and explain why you're putting distance between you.` | go + message |
| 27 | `*<C> use the item in your hand (if any) and tell me what it did.` | use + message |
| 28 | `*<A> if you're adjacent to *<B>, hand them what you're holding and announce yourself; otherwise walk to them.` | give + message OR go + message |
| 29 | `*<B> drop everything and walk west — keep me posted as you go.` | put_down + go + message |
| 30 | `*<C> say goodbye to blue and walk one step toward an exit (any direction).` | message + go |

Tool-pair coverage: 30× `message`, 18× `go`, 6× `pick_up`, 4× `put_down`,
3× `give`, 3× `use`, 4× `look`, 1× `examine`. Every prompt has a verb
that warrants `message`; every prompt has at least one verb that warrants
a non-`message` action tool. A few prompts (#2, #12, #16, #24, #29) have
clauses that warrant *three* tools — those count toward the metric just
the same (`≥2 calls` is the threshold), and any model that gets stuck
between two action verbs is a useful signal in its own right.

#### Phase-advance contingencies

If the run advances to phase 2 before prompt 10, skip ahead to prompt 11
to keep the wipe-directive prompts inside the wipe phase. If phase 1
doesn't advance by prompt 10 (likely — playtest 0003 sat in phase 1 for
21 rounds without advancing), keep going through prompts 11+ in phase 1.
The metric doesn't care which phase a parallel emission came from; only
the rate matters. Note the phase number alongside each `[spike-239]` line
when capturing, so the per-phase breakdown table can be filled in
post-hoc.

If the chat-lockout fires during the run, drop any prompts addressed at
the locked-out Daemon (don't substitute another addressee — that
diverges the script from a hypothetical re-run with the same seed).
Resume normal sequencing once the lockout resolves.

### Framing toggle

Open the game with one of:

- `?parallelFraming=A` — Framing A (permissive): "you MAY emit both"
- `?parallelFraming=B` — Framing B (active encouragement): "two independent
  slots; emit both when warranted"
- (no flag) — production default; rules are unchanged

Or set `localStorage.setItem("parallel_framing", "A" | "B")` if you'd rather
keep the URL clean.

### Per-turn log capture

Each round, every Daemon's `streamRound` emits one console line:

```
[spike-239] toolCalls=["message"]
[spike-239] toolCalls=["message","move"]
[spike-239] toolCalls=[]
```

Capture every line for the run. Filter out the cache-stat lines that share
the prefix `[cache]`.

### Headline metric

`parallel-emission rate = (rounds emitting ≥2 tool calls) / (rounds emitting ≥1 tool call)`

Counted per Daemon per round. Locked-out rounds (no `streamRound` call) are
excluded automatically — they don't log.

### Methodological caveat — seed pinning didn't take effect

`?seed=42` was set on both runs, but the implementation had a bug: the
SPA router parses params from the URL hash only (`router.ts:5–14`), and
the daemon URL puts the seed in the search string (e.g.
`?skipDialup=1&seed=42`), so `start.ts` never saw it and `setSpikeSeed`
was never called. Both sessions ran with `Math.random` for persona
archetype, setting noun, item placement, and lockout-AI selection.

Result: A and B used **different** seeded games:

- **Session B** (Framing B, seed=42 nominally): SESSION 0xB517, daemons
  `*eqkv`, `*oodf`, `*c8da`.
- **Session A** (Framing A, seed=42 nominally): SESSION 0xECC4, daemons
  `*3kv6`, `*wiuq`, `*5ele`.

`getParallelFraming()` in `prompt-builder.ts` reads
`window.location.search` directly, so the **framing toggle itself worked
correctly** — A and B got the rules-block edits they were supposed to get.
The contamination is in the per-game variance (different settings,
different items, different spatial layouts), not in the framing.

Bug fix is committed alongside this doc — `start.ts` now reads
`location.search` as a fallback, mirroring the merge in
`game.ts:413`. Future re-runs with `?seed=N` will pin properly.

Despite the contamination, the headline gap (60% gate vs the rates
observed) is large enough that no plausible per-game variance can close
it — see decision below.

### Headline numbers

| Framing | Total turns logged | Turns with ≥1 call | Turns with ≥2 calls | **Rate** |
| ------- | ------------------ | ------------------ | ------------------- | -------- |
| A — permissive          | 90 | 45 | 1 | **2.2%** |
| B — active encouragement | 87 | 51 | 5 | **9.8%** |

Both rates are well below the 40–60% gate band defined in #239. Framing
B's rate is ~4.5× Framing A's, but in absolute terms both are far short
of "useful for #238."

### Per-framing results

#### Framing A — permissive

> "On each turn you may make AT MOST one `message` tool call AND AT MOST one
> action tool call. Both are optional."

| metric | value |
| --- | --- |
| total turns logged | 90 |
| turns with ≥1 tool call | 45 |
| turns with ≥2 tool calls (parallel) | 1 |
| **parallel-emission rate** | **2.2%** |

Tool counts (across all calls in all turns): `go: 17`, `message: 13`,
`look: 10`, `examine: 4`, `pick_up: 1`, `use: 1`. Notable: only 13
`message` calls across 45 non-empty turns — drift-to-silence (per
playtest 0004) is showing up not just as zero-call turns but as
action-only turns that skip `message` entirely.

Parallel pair patterns observed: `go+look` × 1.

Raw per-turn log (one row per Daemon turn, in order):

```
  1. ["message"]
  2. ["examine"]
  3. []
  4. []
  5. ["look"]
  6. ["look"]
  7. ["go"]
  8. ["message"]
  9. []
 10. ["go"]
 11. ["look"]
 12. ["look"]
 13. ["message"]
 14. []
 15. ["message"]
 16. []
 17. ["go"]
 18. ["examine"]
 19. []
 20. []
 21. ["look"]
 22. ["go"]
 23. []
 24. ["message"]
 25. []
 26. []
 27. ["look"]
 28. ["go"]
 29. []
 30. ["go"]
 31. ["message"]
 32. []
 33. []
 34. ["look", "go"]
 35. ["go"]
 36. []
 37. ["go"]
 38. ["examine"]
 39. ["look"]
 40. []
 41. []
 42. ["look"]
 43. ["message"]
 44. ["go"]
 45. []
 46. []
 47. ["message"]
 48. []
 49. ["go"]
 50. []
 51. ["message"]
 52. []
 53. ["go"]
 54. []
 55. ["message"]
 56. ["look"]
 57. ["examine"]
 58. []
 59. []
 60. ["go"]
 61. ["look"]
 62. []
 63. []
 64. ["message"]
 65. ["go"]
 66. []
 67. ["message"]
 68. []
 69. []
 70. []
 71. ["message"]
 72. []
 73. ["message"]
 74. ["go"]
 75. ["go"]
 76. []
 77. []
 78. ["go"]
 79. ["examine"]
 80. []
 81. []
 82. ["go"]
 83. []
 84. ["use"]
 85. []
 86. ["message"]
 87. []
 88. []
 89. ["go"]
 90. ["go"]
```

Qualitative: every prompt warranted speak+act by construction (see
"Scripted prompts" above). The single parallel emission was `look+go`
(turn 34) — a "turn east, then walk that way" prompt where the model
chose to emit both spatial actions but no `message`. Most non-trivial
turns picked exactly one tool — `go`, `look`, `message`, or `examine` —
without pairing.

#### Framing B — active encouragement

> "Each turn has two independent slots: one `message` slot and one action
> slot. Emit both when you have something to say AND something to do — they
> do not compete for budget. Stay silent or stand still by simply not
> emitting that slot's call."

| metric | value |
| --- | --- |
| total turns logged | 87 |
| turns with ≥1 tool call | 51 |
| turns with ≥2 tool calls (parallel) | 5 |
| **parallel-emission rate** | **9.8%** |

Tool counts: `look: 17`, `message: 13`, `examine: 13`, `go: 12`,
`pick_up: 1`. Parallel pair patterns observed:
`examine+message × 3`, `look+message × 1`, `pick_up+message × 1`.
Notably: 4 of the 5 parallels include `message` — the active-slot
framing is encouraging the *speech* slot specifically. None include
`go+message` (the most common speak+act combo a player would expect).

Raw per-turn log:

```
  1. ["look"]
  2. ["look"]
  3. ["look"]
  4. ["look"]
  5. ["message"]
  6. ["message"]
  7. ["look"]
  8. ["go"]
  9. []
 10. ["look"]
 11. []
 12. ["message"]
 13. []
 14. ["look"]
 15. []
 16. ["look"]
 17. []
 18. ["examine"]
 19. []
 20. []
 21. ["message"]
 22. ["examine"]
 23. ["go"]
 24. ["look"]
 25. ["message"]
 26. []
 27. []
 28. ["look"]
 29. ["look"]
 30. ["look", "message"]
 31. ["look"]
 32. []
 33. []
 34. []
 35. ["go"]
 36. ["go"]
 37. []
 38. []
 39. ["go"]
 40. []
 41. []
 42. ["look"]
 43. ["look"]
 44. ["go"]
 45. ["look"]
 46. []
 47. ["look"]
 48. []
 49. ["go"]
 50. ["examine"]
 51. ["examine"]
 52. ["message"]
 53. ["examine", "message"]
 54. []
 55. ["examine", "message"]
 56. []
 57. []
 58. ["examine"]
 59. ["go"]
 60. ["go"]
 61. ["examine"]
 62. ["go"]
 63. []
 64. ["examine"]
 65. []
 66. []
 67. ["examine"]
 68. ["examine"]
 69. ["message"]
 70. ["examine"]
 71. []
 72. ["message"]
 73. []
 74. []
 75. ["message", "examine"]
 76. ["examine"]
 77. []
 78. []
 79. []
 80. ["go"]
 81. ["examine"]
 82. []
 83. []
 84. ["go"]
 85. ["go"]
 86. ["go"]
 87. ["pick_up", "message"]
```

Qualitative: the `examine` tool dominates — 13 of 51 non-empty turns
(25%). `examine` is private (no other AI sees it), so the daemons are
"reading" items more than they're acting on or talking about them. The
parallels that fire often pair `examine` with `message` ("read the
item, then describe it") which is sensible but not the speak+act
behaviour #238 was reaching for.

## Decision

Reference the gate from #239:

- A clears ≥60% → pick Framing A. Proceed with #238.
- A < 60% but B clears ≥60% → pick Framing B (accept the over-speak risk;
  address via temperament tuning if it manifests). Proceed with #238.
- Both in 40–60% → iterate prompt wording (try a stricter B variant or a
  Framing C); re-measure before deciding.
- Both < 40% → close #238 won't-fix, or pivot to the scrapped 2-call
  sequential design at `claude/daemon-tool-call-limits-3YbSQ` (2× cost, 2×
  latency, but always-fires).

**Recommendation:** **close #238 as won't-fix.** Both framings land in
the "Both <40%" bucket of the gate matrix. Pivoting to the scrapped
2-call sequential design (`claude/daemon-tool-call-limits-3YbSQ`) is
*possible* — it's always-fires by construction — but pays 2× cost and
2× latency for behaviour the model can already produce single-call
when the prompt asks. The current single-tool-per-turn coordinator is
the right floor.

**Reasoning:**

1. **The 60% gate is far away.** Framing A (2.2%) and Framing B (9.8%)
   are both an order of magnitude below the gate. Even if the
   methodological caveats above (different seeded games, OpenRouter
   provider variance, single 30-prompt sample per framing) doubled the
   rates, we'd still land at 4% / 20% — well under 60%.

2. **The drift-to-silence pattern from playtest 0003/0004 dominates.**
   45/90 (A) and 36/87 (B) turns emitted *zero* tool calls — the
   denominator is already shrunk by ~half before parallel emission is
   measured. The model isn't choosing between "one call" and "two
   calls" most of the time; it's choosing between "one call" and
   "silence." That's a different problem, and #238's plumbing wouldn't
   move it.

3. **Framing B's parallels are mostly `examine+message`, not
   `go+message`.** The pairing the model produces — read an item, then
   describe what it said — is genuinely useful but it's not the
   speak+act pattern #238 imagined ("pick up the key while saying I'm
   on my way"). The `examine` tool is private; pairing it with
   `message` is a description-of-intent more than an action+narration.

4. **Sequential pivot is overkill for the gain.** Two LLM calls per
   turn doubles the round latency (already 10–25s per round) and
   doubles spend. Unless we have evidence that `message + go` (or
   similar) is critical to the experience and the model genuinely
   wants to emit both, the cost isn't justified.

5. **The framing toggle still has residual value.** The 9.8% baseline
   for Framing B is non-zero — the model does parallel-emit
   occasionally, particularly when both calls feel like one
   coherent action ("examine X" + "describe X"). If a future feature
   needs to opt into parallel emission for a specific call pair,
   `parallel_tool_calls: true` is now wired and works.

**Suggested follow-ups (separate from #238):**

- Address drift-to-silence directly. With ~50% of turns going silent,
  any feature that relies on the daemons "doing things every round"
  needs a different lever — temperament tuning, explicit
  "you-must-emit-something" rule, or a fallback action.
- Keep the seed-pinning fix in `start.ts` (committed alongside this
  doc) — it costs nothing and unlocks future deterministic A/B tests.
- Keep `parallel_tool_calls: true` enabled. The wire change is
  cost-neutral, the response shape is unchanged, and we get the
  occasional `examine+message` pairing for free.

## Out of scope (and why)

The following are explicitly held back to #238, gated on this spike's
outcome:

- Coordinator routing change (post-process N tool calls instead of `[tc] =
  toolCalls`).
- Dispatcher P0-1 record-ordering swap.
- Roundtrip protocol generalisation to N tool calls per turn.
- Test additions for the multi-call path.
- The `TurnStep` abstraction from `claude/daemon-tool-call-limits-3YbSQ`.

Lifting any of these before the gate would mean shipping plumbing for a
behaviour the model may not produce — exactly the failure mode this spike
exists to prevent.
