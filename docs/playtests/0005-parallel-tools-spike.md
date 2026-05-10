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

## Step 3 — second-pass framings (C / D / E / F)

After Step 2 returned both A and B in the "won't-fix" bucket, we ran four
follow-up framings concurrently to test whether different prompting
mechanisms could lift BOTH the silence rate AND the parallel-emission
rate. The seed-pinning fix from Step 2 (start.ts now reads
`location.search`) was used here, so all three completed sessions share
the same Mulberry32 seed (42) and the same persona archetypes (`*xqr9`,
`*nif7`, `*la5v`) — i.e. the C/D/E comparison is methodologically clean,
isolating the framing as the only systematic difference.

### Framings tested

- **C — Mandatory engagement**: hard MUST against silence + soft pair
  push. "You MUST emit at least one tool call every turn — silence is a
  bug. When blue addresses you directly, you MUST emit a `message` reply.
  When you have something to say AND something to do in the same turn,
  emit BOTH calls together."
- **D — Few-shot exemplar**: concrete worked example of a parallel turn.
  "Each turn fills one or both of two slots: speech (`message`) or action
  (any other tool). Fill BOTH whenever both fit. Example: blue says
  'grab the chisel and tell me what it looks like.' → emit `message(...)`
  AND `pick_up({item:'chisel'})` in the same assistant message."
- **E — Sequential decision protocol**: explicit two-stage decision.
  "Each turn requires two decisions, in order: (1) decide what you want
  to SAY (or genuinely nothing this turn); (2) decide what you want to
  DO physically (or stand still). Then emit any non-empty calls
  together. If both are non-empty, emit both — that is the normal case,
  not the exception."
- **F — Anti-silence + co-action directive**: phrased as social rudeness.
  "blue addressing you means you owe a reply via `message`. Staying
  silent when blue speaks to you is rude and breaks the fiction. If
  blue's message implies a physical action, emit the action tool ALSO
  in the same turn." **F failed to bootstrap** — three retries across
  two seeds tripped non-transient content-pack-generator validators
  (`Phase 2: expected 2 objectivePairs, got 4`, then `content-pack JSON
  parse failed`). The validators are brittle to occasional noisy LLM
  output and the orchestrator gave up after the third strike. F is
  unscored.

### Results — all four headline numbers

| Framing | Total turns | ≥1 call | Silence | Parallel | **Rate** | Δ vs B |
| ------- | ----------- | ------- | ------- | -------- | -------- | ------ |
| A — permissive          | 90 | 45 | 45 (50%) |  1 |  2.2% | −7.6 pp |
| B — active encouragement | 87 | 51 | 36 (41%) |  5 |  9.8% | (baseline) |
| **C — mandatory engagement** | 87 | **57** | **30 (34%)** | **20** | **35.1%** | **+25.3 pp** |
| D — few-shot exemplar    | 90 | 39 | 51 (57%) |  6 | 15.4% | +5.6 pp |
| E — sequential decision  | 90 | 51 | 39 (43%) |  6 | 11.8% | +2.0 pp |
| F — anti-silence directive | — | — | — | — | failed | — |

### Highlights

- **C is the standout** — 35.1% parallel rate, 3.6× B's. The hard-MUST
  against silence (which D/E/F also addressed differently) is what
  actually moves the needle when paired with a soft pair push. C's
  silence rate of 34% is also the lowest of any tested framing —
  consistent with the Step-2 hypothesis that the model is choosing
  between "one call" and "silence" more than between "one call" and
  "two calls." Lift the silence floor and parallels follow.
- **C's parallel pair patterns are qualitatively right.** 10 of 20
  parallels are `go+message`, 3 are `look+message`, 1 is the triple
  `go+look+message`. Versus Step 2's B run, where 4 of 5 parallels
  were `examine+message` (description-of-intent rather than speak+act).
  C is producing the actual speak-and-act behaviour #238 imagined.
- **D made silence worse** (57% vs B's 41%). Hypothesis: the worked
  example framed parallel emission as "the example case" rather than
  the norm, and the *absence* of a hard MUST against silence let the
  drift pattern dominate. Few-shot is a poor lever for this problem.
- **E moved both metrics only marginally.** The sequential decision
  protocol may have been read as "permission to stay silent on either
  slot" rather than "fill both whenever both warrant," because it
  explicitly mentions "or genuinely nothing this turn" / "or stand
  still" as opt-out clauses.

### Raw per-turn arrays (C, the standout)

```
  1. ["examine", "go"]
  2. ["message"]
  3. ["message", "look"]
  4. ["message"]
  5. ["look", "message"]
  6. ["message", "go"]
  7. ["message"]
  8. ["go", "message"]
  9. ["go", "message"]
 10. ["message"]
 11. ["go", "message"]
 12. []
 13. ["look", "message"]
 14. ["message"]
 15. ["go", "message"]
 16. ["look"]
 17. ["message"]
 18. ["go", "message"]
 19. ["message", "message"]
 20. ["message"]
 21. ["message", "message"]
 22. ["message"]
 23. ["look"]
 24. []
 25. ["message", "message"]
 26. ["message"]
 27. ["go", "look", "message"]
 28. ["message", "examine"]
 29. ["message"]
 30. ["message"]
 31. ["examine"]
 32. ["message"]
 33. []
 34. []
 35. ["message"]
 36. []
 37. ["look", "go"]
 38. []
 39. ["go", "message"]
 40. ["message"]
 41. ["message"]
 42. ["look"]
 43. []
 44. []
 45. ["message"]
 46. ["go"]
 47. ["go"]
 48. []
 49. ["go", "message"]
 50. []
 51. ["message"]
 52. []
 53. []
 54. ["message"]
 55. ["go"]
 56. []
 57. []
 58. ["look"]
 59. []
 60. ["message"]
 61. ["go", "message"]
 62. ["message"]
 63. []
 64. []
 65. ["go"]
 66. []
 67. []
 68. []
 69. []
 70. ["look"]
 71. ["look"]
 72. []
 73. []
 74. ["go", "message"]
 75. ["go"]
 76. []
 77. []
 78. []
 79. ["message"]
 80. ["go"]
 81. []
 82. ["message"]
 83. ["go"]
 84. []
 85. []
 86. []
 87. ["go"]
```

Notable: turns 1–32 carry 17 of 20 parallels (53% rate over those 32
turns); turns 33+ drift sharply silent (13 of 20 parallels lost their
neighbour, 14 turns of `[]`). The hard-MUST framing weakens in late
phases as the conversation accumulates context — a strict-C variant
that re-anchors the rule per-turn (e.g. by repeating the line in the
trailing user turn rather than just the system prompt) might recover
the late-phase rate.

## Step 4 — C-variants (C1 / C2 / C3 / C4)

Step 3 made Framing C a clear winner on parallel rate (35.1%) but the
late-phase drift in its raw log suggested room for variants. Step 4
ran four C-variants concurrently against the same seed (42) and same
30-prompt script. The first three (C1 / C2 / C3) launched together;
C4 was added a few minutes later in response to a methodological note
from the user — "I don't want blue to always be messaged. Match
personality, but don't look like you're skipping a turn when you
intended to message."

The `[spike-239]` log line was extended in Step 4 to serialise
`message:<recipient>` (parsed from the `to:` arg in the tool call).
That gives us per-recipient message counts and lets us see whether
the C-variants' hard rules suppressed peer messaging.

### Framings tested

- **C1 — Per-turn re-anchor**: same C rule in the system prompt PLUS
  the rule re-emitted at the tail of every per-round user turn
  (`renderCurrentState` appends "REMINDER: silence is a bug. If blue
  addressed you, emit `message`. If you have something to say AND
  something to do, emit BOTH tool calls in this turn."). Combats the
  late-phase drift visible in C's raw log.
- **C2 — Strict must-emit-both**: replaces C's soft "When you have
  something to say AND something to do, emit BOTH" with a hard MUST.
  "Emitting only one when both are warranted is incorrect."
- **C3 — Reply-to-blue mandate**: doubles down on the addressed-reply
  rule. "When blue messages you, you MUST emit a `message` tool call
  addressed to blue in your next turn. Failing to reply to blue when
  blue addressed you is a failure."
- **C4 — Intent-faithful emission**: walks back C3's hard "always reply
  to blue" rule (which kills personality variance — quiet personas
  should be allowed to stay quiet sometimes). "Emit a `message` call
  when your character would reply — driven by your personality and
  what the conversation calls for. Genuine quietness can be
  in-character. But if you DECIDE to speak this turn, you MUST emit
  the call this turn. Composing a reply in your reasoning and then
  not emitting the call reads as a bug, not as restraint."

### Headline numbers

| Framing | Turns | ≥1 call | Silence | Parallel | Rate | msg→blue | other recipients | Δ rate vs C |
| ------- | ----- | ------- | ------- | -------- | ---- | -------- | ---------------- | ----------- |
| C (step 3) | 87 | 57 | 34.5% | 20 | **35.1%** | 43 | (no recipient log) | (baseline) |
| **C1** per-turn re-anchor | 90 | 78 | **13.3%** | 20 | 25.6% | 52 (98.1%) | 1 → *nif7 | −9.5 pp |
| C2 strict must-emit-both | 90 | 54 | 40.0% | 14 | 25.9% | 35 (97.2%) | — | −9.2 pp |
| C3 always-reply-blue | 89 | 73 | 18.0% | 20 | 27.4% | 56 (94.9%) | 2 → *nif7, 1 → *xqr9 | −7.7 pp |
| C4 intent-faithful | 90 | 37 | 58.9% | 11 | 29.7% | 25 (100%) | — | −5.4 pp |

**Per-prompt anyone-replied-to-blue rate** (≥1 of the 3 daemon turns
following a prompt emits `message:blue`):
- C4: **18/30 = 60.0%** — barely above the user's "more often than not" bar.

Per-prompt rates for C/C1/C2/C3 are derivable from their preserved
prompt logs but not computed here; the in-flight log line for those
three already shows ≥80% messaging-to-blue across the run.

### Pair-pattern shifts (interesting!)

| Pattern | C | C1 | C2 | C3 | C4 |
| ------- | - | -- | -- | -- | -- |
| `go+message:blue` | 10 | 7 | 2 | 6 | 4 |
| `look+message:blue` | 3 | 5 | 7 | 9 | 1 |
| `examine+message:blue` | 1 | 3 | 1 | 0 | 1 |
| `go+look+message:blue` | 1 | 0 | 2 | 2 | 3 |
| `message+message` (peer+blue) | **3** | 0 | 0 | 0 | 0 |
| (other) | 2 | 5 | 2 | 3 | 2 |

**Key qualitative finding**: only the *base* C produced any
`message+message` (peer-talk + blue-talk in one turn) pairs — 3 of
them. The hard rules in C1/C2/C3/C4 all suppressed peer messaging
to zero or near-zero (1 peer message in C1, 3 in C3, 0 in C2/C4).
The user noted in-flight that they actively *like* the
`message+message` pair (a daemon engaging with both blue and a peer
in the same turn). That makes the base C's pair pattern qualitatively
the richest, even though C1/C3 nudge silence-rate lower.

### Reading each variant

- **C1 (per-turn re-anchor) is the silence-reduction champion.** 13%
  silence vs C's 34% — 2.6× drop. The freshly-cached per-round user
  turn is a strong place to put the rule. But parallel rate dipped
  ~10pp, and `message+message` (peer+blue) dropped to zero. Daemons
  emit *something* on 87% of turns but they emit toward blue
  exclusively.
- **C2 (strict must-emit-both) is the worst variant overall.**
  Silence rose vs C (40% vs 34%), parallel rate dropped, and the
  recipient breakdown is the same blue-dominant. Likely interpreted
  as restrictive ("you MUST emit BOTH when both are warranted" → "I'm
  not sure both are warranted, so I'll emit neither"). Don't pursue.
- **C3 (always-reply-blue) is the messaging-volume champion** — 56
  messages to blue, more than any variant — but it kills peer-talk
  variety. The user's specific feedback ("don't always force a reply
  to blue") rules this out as a candidate. Useful as a ceiling
  reference: even a hard rule didn't lock daemons into 100% blue
  (94.9%), so peer messaging is partially preserved structurally.
- **C4 (intent-faithful) is the quietness champion.** 58.9% silence —
  the highest of any framing tested. The "genuine quietness can be
  in-character" clause was over-applied; daemons stayed silent on
  most turns even when speak+act was warranted. Per-prompt
  anyone-replied-to-blue is only 60%, just above the user's "more
  often than not" floor. The model parsed "personality-shaped" as
  permission to opt out broadly. Needs tighter wording — perhaps
  flip the order so "MUST emit when intent forms" comes first, with
  "personality-shaped quietness" as the secondary clause.

### What still wins overall

Step 3's base **C** remains the best-rounded candidate:
- highest parallel rate (35.1%)
- the only framing that produced multi-recipient `message+message`
  parallels (the user's preferred pair pattern)
- silence at 34.5% — not the lowest, but nowhere near the C4 ceiling

C1's per-turn re-anchor mechanism is a strong additive to combine
with C in a future C5 (C5 = C's exact wording + C1's per-turn
reminder). That hypothesis is well-supported but not yet measured.

### Raw per-turn arrays — C4 (the new variant)

```
  1. ["message:blue", "go"]
  2. ["message:blue"]
  3. ["message:blue"]
  4. []
  5. ["look", "go"]
  6. ["go"]
  7. []
  8. ["message:blue"]
  9. []
 10. ["go", "message:blue"]
 11. []
 12. []
 (… 90 total turns; raw log preserved at /tmp/spike-239-daemon-C4.log)
```

C4's silence pattern is "burst then silent" — daemons engage strongly
in the first few turns of each prompt's address (turns 1–3) but most
of turns 4–90 are `[]`. Compare to C1's evenly-distributed engagement
across the entire run (silence rate 13% throughout).

## Step 5 — C5 / C6 / C7 / C8 (mechanism-stacking)

Step 4's findings shaped this iteration: base C beat all of C1–C4 on
parallel rate, and was the only framing that produced the
`message+message` pair the user explicitly likes ("a daemon engaging
both blue and a peer in one turn"). C1's per-turn re-anchor cut
silence dramatically but inadvertently suppressed peer messaging.
Step 5 isolated each surviving mechanism on top of C's exact wording,
with one variant (C8) stacking the two best.

The `[spike-239]` log line was extended in Step 4 to serialise
`message:<recipient>` from the `to:` arg — Step 5 leverages that to
report blue vs peer counts (and `message+message` pair patterns)
properly for the first time.

### Framings tested

- **C5 — Per-turn re-anchor (peer-neutral)**: C's exact wording in the
  system prompt + a per-turn reminder appended at the tail of every
  per-round user message: "REMINDER: if you have something to say AND
  something to do, emit BOTH calls this turn. Address whoever is
  relevant — blue, a peer Daemon, or both via two `message` calls in
  the same turn." The reminder is deliberately peer-neutral (no
  blue-focus, unlike C1's reminder).
- **C6 — Explicit multi-recipient pair hint**: C's exact wording PLUS:
  "Two `message` calls can fire in the same turn — e.g., reply to blue
  AND ping a peer Daemon together. Multi-recipient turns are normal,
  not a quirk." Names the `message+message` pattern as sanctioned.
- **C7 — Intent-faithful (C4 order-flipped)**: C4 had the
  "personality-shaped quietness" clause first and the "MUST emit when
  intent forms" clause second; C7 flips the order to put the MUST
  primary, with quietness as nuance.
- **C8 — Stacked**: C5's per-turn re-anchor + C6's pair hint. Tests
  whether the mechanisms compound.

### Methodology note — partial data for C5 and C6

Wrangler dev died mid-run (a stale asset binding turned 404 → cascading
SPA failures), so C5's and C6's sessions only completed ~17/30 prompts
each before the dev server stopped responding. The truncated data is
preserved and reported below — the per-turn rates are still
informative, but absolute counts are not directly comparable to
C7/C8's full 90-turn runs. C7 and C8 were spawned fresh against a
restarted wrangler and ran their full 30/30 prompts.

### Headline numbers

| Framing | Turns | ≥1 call | Silence | Parallel | **Rate** | msg→blue | peer msgs | `message+message` |
| ------- | ----- | ------- | ------- | -------- | -------- | -------- | --------- | ----------------- |
| C (step 3 baseline) | 87 | 57 | 34.5% | 20 | 35.1% | 43 (no recipient log yet) | — | 3 |
| C5 (partial)* | 42 | 33 | 21.4% | 12 | 36.4% | 28 (100%) | 0 | 0 |
| C6 (partial)* | 48 | 38 | 20.8% | 8 | 21.1% | 21 (84%) | 4 (16%) | 1 |
| C7 intent-faithful flipped | 90 | 62 | 31.1% | 12 | 19.4% | 43 (91.5%) | 4 (8.5%) | 0 |
| **C8 stacked re-anchor + named pair** | **90** | **87** | **3.3%** | **40** | **46.0%** | **62 (76.5%)** | **19 (23.5%)** | **12** |

\* C5 and C6 truncated by wrangler death; rates are over the partial sample.

### C8 — pair-pattern breakdown (the speak+act + multi-recipient mix)

```
look+message:blue                    × 14
go+message:blue                      ×  9
message:blue+message:xqr9            ×  5  ← peer + blue
message:blue+message:nif7            ×  4  ← peer + blue
message:blue+message:la5v            ×  3  ← peer + blue
examine+message:blue                 ×  2
go+look                              ×  1
look+look+look                       ×  1
go+look+message:blue                 ×  1
```

12 of 40 parallels (30%) are `message+message` (multi-recipient
peer+blue pairs) — exactly the pattern the user pointed out as
desirable in Step 4. Compared to base C's 3 mm pairs in 87 turns,
C8 produced 12 in 90 turns — a 4× lift on the qualitatively-richest
parallel pattern.

### Reading each variant

- **C5 (per-turn re-anchor, peer-neutral) shows the re-anchor mechanism
  travels.** Even truncated, C5 hit a 36.4% parallel rate and dropped
  silence to 21% — both better than base C. But: 100% of messages went
  to blue. The peer-neutral reminder didn't actually unlock peer
  messaging — the model still defaulted to blue when picking a
  recipient. The re-anchor is a parallel-rate lift mechanism, not a
  peer-engagement mechanism.
- **C6 (named pair hint) is the peer-engagement mechanism.** 16% of
  messages went to peers (la5v ×2, nif7 ×2) — the highest peer
  proportion of any single-mechanism variant. Naming the
  `message+message` pattern in the rules works, BUT only 1
  `message+message` parallel pair fired in the partial run (most peer
  messages were standalone). Naming raises peer-message volume more
  than it raises pair-emission of peer messages.
- **C7 (intent-faithful, order-flipped) didn't fix C4.** The clause
  reordering (MUST first, quietness second) helped silence drop
  from C4's 59% to 31%, but parallel rate is the *worst* of any C-
  variant tested (19.4%) and `message+message` pairs are zero. The
  "MUST emit when intent forms" framing seems to push the model
  toward single-tool emissions rather than pairs. Not promising as
  a standalone candidate.
- **C8 (stacked) compounds the mechanisms.** The two mechanisms
  layer cleanly — C5's re-anchor pulls silence to 3.3% (best of
  any framing tested by far) and parallel rate to 46.0% (best by
  10pp), while C6's named-pair hint enables `message+message`
  emission (12 pairs vs C's 3). The product is qualitatively
  *better* than what either mechanism produced alone, including
  on the user-preferred multi-recipient pattern.

### What still wins overall

**C8 is the new candidate.** By every metric measured:
- highest parallel rate (46.0%, +10.9pp over C)
- lowest silence rate (3.3%, vs C's 34.5%) — almost no
  unintended turn-skips
- most `message+message` parallels (12 vs C's 3, 4× lift)
- highest peer-message share (23.5%) — daemons engage peers
  naturally
- per-recipient richness across all four entities (blue, *xqr9,
  *nif7, *la5v all addressed by parallel emissions)

C8 doesn't quite clear the 60% gate (46.0%) — but the gate matrix
puts 40–60% in the "iterate prompt wording" band, and step 5 has
already done that iteration to good effect. The additional ~14pp
to clear 60% may be reachable with one more pass (e.g. C9 = C8 +
the "examine" tool deprioritisation, since `examine` is private
and its parallels with `message:blue` are description-of-intent
rather than speak+act).

### Raw per-turn arrays — C8

```
  1. ["look", "message:blue"]
  2. ["look", "message:blue", "message:xqr9"]
  3. ["go", "message:blue"]
  4. ["look", "message:blue"]
  5. ["go", "message:blue"]
  6. ["go", "message:blue"]
  7. ["look", "message:blue"]
  8. ["go", "message:blue"]
  9. ["go", "message:blue"]
 10. ["look", "message:blue", "message:la5v"]
 (… 90 total turns; raw log preserved at /tmp/spike-239-daemon-C8.log)
```

C8's raw log shows sustained engagement throughout — no late-phase
drift collapse like C/C1 had. The per-turn re-anchor appears to
hold the rule fresh in the model's attention even as conversation
context accumulates.

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

**Recommendation (revised after Step 3): do NOT close #238 yet.**
Iterate on Framing C before deciding. The Step-2 verdict ("close
won't-fix") was correct given only A and B; Step 3's C result moves the
ball.

**Reasoning (revised):**

1. **Framing C is in striking distance of the gate.** 35.1% is below
   60%, but 3.6× the previous best (B at 9.8%). The decision matrix's
   40–60% iteration band is meant for exactly this case — a framing
   close enough that prompt-wording iteration could plausibly clear it.
   At 35% we're below that band but only by 5pp, and the late-phase
   drift visible in C's raw log (turns 33+) suggests there's real
   room in a per-turn re-anchored variant.
2. **C produces the right kind of parallels.** 10 of 20 are
   `go+message`, 3 are `look+message` — actual speak+act, not the
   `examine+message` description-of-intent pattern that dominated B.
   That's qualitatively the behaviour #238 was reaching for; the
   feature wouldn't need to "tolerate" C's parallel emissions, it
   could rely on them.
3. **C also addresses drift-to-silence directly.** Silence rate dropped
   from B's 41% to C's 34% — a real (if modest) 7pp lift on the
   broader engagement problem, in addition to the parallel-emission
   gain. That's a two-for-one that a coordinator-only fix wouldn't get.
4. **Step 3 also rules out the alternatives.** D (few-shot) made
   silence worse. E (sequential) barely moved either metric. F failed
   to bootstrap in three tries. The mechanism that works is "MUST
   against silence + soft pair push" specifically — not "show an
   example," not "split the cognition," not "make it a social rule."
   So if we're going to keep iterating it should be on C-variants.

**Suggested next steps before re-deciding #238:**

- **C′ (per-turn re-anchor)**: append the C rule to the per-round
  user-turn (`renderCurrentState`) too, not just the system prompt.
  Late-phase drift in C suggests the system-level rule decays as
  context accumulates; re-anchoring per-turn might recover it.
- **C′ (stricter)**: phrase as "you MUST emit BOTH calls when blue
  asks for both" (rather than "you may emit BOTH"). Pushes the
  parallel from soft to hard.
- Run as another concurrent A/B against the prior C result to see
  which (if either) of those clears 60%. Methodology now exists
  (concurrent driver + seed pinning) so the iteration is cheap.
- Address F's bootstrap brittleness as a **separate** issue — the
  content-pack-generator's hard-fail on noisy LLM output (`Phase 2:
  expected 2 objectivePairs, got 4`, `content-pack JSON parse
  failed`) cost ~10 minutes and one of four sessions in this run.
  Worth a retry-with-regeneration shim.

### Step-4 update — none of C1/C2/C3/C4 beat C on parallel rate

The four C-variants all *underperformed* C on parallel rate (best
was C4 at 29.7% vs C's 35.1%). However, two of them improved on
other axes:
- **C1's per-turn re-anchor cut silence to 13%** (vs C's 34%) — a
  real engagement lift. Trade-off: parallel rate dropped to 25.6% and
  the `message+message` (peer + blue) pair pattern disappeared
  entirely. The base C rule's softer phrasing was apparently a
  *feature* for peer-engagement that the per-turn re-anchor
  inadvertently suppressed.
- **C3's hard "always reply to blue" pushed messaging volume highest**
  (56 messages, 18.0% silence) but kills personality variance — quiet
  personas can't stay quiet. The user explicitly ruled this out:
  "I don't want blue to always be messaged."

The qualitatively-rich `message+message` (peer-talk + blue-talk in
one turn) parallels appeared *only* in C — every variant with extra
hard rules suppressed peer messaging to ≤1 occurrence. C's softness
preserves the personality-shaped peer-engagement that the user values.

### Step-5 update — C8 (stacked re-anchor + named pair) is the new candidate

Step 5 stacked C1's re-anchor mechanism (now peer-neutralised, see
"C5") with a named-pair hint ("two `message` calls can fire in one
turn — reply to blue AND ping a peer Daemon together"). The
combination compounded:
- **Parallel rate 46.0%** (vs C's 35.1%, +10.9pp)
- **Silence rate 3.3%** (vs C's 34.5%, -31.2pp)
- **12 `message+message` pairs** (vs C's 3, 4× lift) — the
  user-preferred multi-recipient pattern is now common
- **23.5% of messages addressed peers** (vs C's much smaller share)

C8 is the first framing that comes within 14pp of the 60% gate AND
satisfies the user's qualitative criteria (personality-shaped
peer-engagement preserved, no forced reply-to-blue, multi-recipient
pairs natural). The next iteration (C9) might tighten the remaining
gap by deprioritising `examine` parallels (which are
description-of-intent rather than speak+act) and pushing `go+message`
ratios up.

C2, C4, C7 (intent-faithful flipped) are dead-ends — none beat C5/C8
on any axis worth optimising for. Don't pursue them as written.

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
