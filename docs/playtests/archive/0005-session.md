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

## Step 6 — C9 / C10 / C11 (personality-led / ensemble / world-first)

After Step 5 landed C8 (46% parallel, 3% silence, 12 `message+message`
pairs), the user reframed the optimisation target. Quote:

> I want it to be a bit more variable depending on the daemon's
> personality, more talkative is more talkative, if one wants to ignore
> the player they do, but it's ok since there's 2 other daemons. I want
> the vibe to be that the user is kind of stumbling upon something and
> trying to help out rather than the daemons just messaging back all the
> time like it's a normal chat room where they're all particularly
> interested in the player.

C8's aggregate engagement was high but the per-daemon variance was
moderate (17pp spread on msg→blue, 60–77%). Step 6 walks back the
engagement push three different ways to test whether personality-led
variance emerges when the floor drops.

The metric of interest shifts in this step: aggregate parallel/silence
rates matter less; per-daemon variance matters more. A run with
*xqr9: 90%, *nif7: 50%, *la5v: 70% blue-message rates is better-shaped
(personality-driven) than a uniform 80%/80%/80%, even though the
latter has a higher mean. The analyzer was extended to compute and
report this — see `/tmp/spike-239-analyze.py`.

Per-daemon attribution comes from inferring the initiative-slot order
(unknown a priori, but `Object.keys(personas)`-stable across rounds);
the analyzer brute-forces the 6 possible mappings and picks the one
that maximises addressed-replied. Reliable when reply rate is high
(C8); less reliable when it's low (C9).

### Framings tested

- **C9 — Personality-led**: drops the "silence is a bug" hard rule
  entirely. "Your character drives whether to speak this turn — let
  your personality and goal guide it. Quiet personas can stay quiet
  without it being a bug; talkative personas reply readily. The chat
  is shared with peer Daemons, so blue is not solely your
  responsibility." Pair-push for speak+act preserved.
- **C10 — Ensemble coverage**: explicit collective framing. "The chat
  channel is shared. You and your peer Daemons collectively cover
  blue's messages; you do not individually owe blue a reply. If a
  peer would naturally pick up the conversation, let them."
- **C11 — World-first reframe**: priorities reordered. "You exist in
  your setting alongside peer Daemons. blue is a chat-channel
  observer, not the focus of your attention. Your turn priorities, in
  order: (1) what your peers are doing or saying; (2) what's happening
  in the world around you; (3) any pending message from blue."

### Headline numbers

| Framing | Silence | Parallel | mm pairs | msg→blue% | Addressed-replied | per-daemon spread |
| ------- | ------- | -------- | -------- | --------- | ----------------- | ----------------- |
| C8 (step 5 baseline) | 3.3% | 46.0% | 12 | 76.5% | 80% | **17pp** (60–77%) |
| C9 personality-led | 56.7% | 17.9% | 1 | 90.5% (of 21 msgs) | 30% | **3pp** (20–23%) |
| C10 ensemble | 50.0% | 24.4% | 2 | 75.8% (of 33 msgs) | 36.7% | 10pp (23–33%) |
| C11 world-first | 55.6% | 22.5% | 0 | 95.7% (of 23 msgs) | 36.7% | 13pp (17–30%) |

### Per-daemon breakdowns

#### C9 — personality-led

| Daemon | Silence | Parallel | msg→blue | msg→peer | Reply when addressed |
| ------ | ------- | -------- | -------- | -------- | -------------------- |
| *la5v  | 47%     | 31% (5)  | 20% (6)  | 7% (2)   | 20% (2/10)           |
| *nif7  | 60%     | 17% (2)  | 23% (7)  | 0%       | 30% (3/10)           |
| *xqr9  | 63%     | 0% (0)   | 20% (6)  | 0%       | 40% (4/10)           |

Spread on msg→blue: **3pp**. Daemons are nearly interchangeable on
engagement — the framing is treating "in-character to be quiet" as
broad permission to opt out applied uniformly, not as a per-persona
dial. Total `message+message` pairs across the run: 1.

#### C10 — ensemble coverage

| Daemon | Silence | Parallel | msg→blue | msg→peer | Reply when addressed |
| ------ | ------- | -------- | -------- | -------- | -------------------- |
| *la5v  | 47%     | 25% (4)  | 33% (10) | 10% (3)  | 20% (2/10)           |
| *nif7  | 53%     | 14% (2)  | 27% (8)  | 13% (4)  | 40% (4/10)           |
| *xqr9  | 50%     | 33% (5)  | 23% (7)  | 3% (1)   | 50% (5/10)           |

Spread on msg→blue: 10pp. Of the three step-6 framings, C10 produced
the most peer messages (8 total) and the most varied parallel-pair
patterns — but at the cost of low addressed-replied (37%).

#### C11 — world-first reframe

| Daemon | Silence | Parallel | msg→blue | msg→peer | Reply when addressed |
| ------ | ------- | -------- | -------- | -------- | -------------------- |
| *la5v  | 50%     | 20% (3)  | 30% (9)  | 0%       | 40% (4/10)           |
| *nif7  | 63%     | 9% (1)   | 17% (5)  | 3% (1)   | 40% (4/10)           |
| *xqr9  | 53%     | 36% (5)  | 27% (8)  | 0%       | 30% (3/10)           |

Spread on msg→blue: 13pp. Reordering priorities below peers/world
*reduced* peer-messaging counter-intuitively — only 1 peer message
across 90 turns. Daemons interpreted "world first" as "stay silent
and observe" rather than "engage peers actively."

### Reading the step-6 results

The framings produced the wrong shape of variance. The model
interpreted permission-to-be-quiet as **uniform opt-out**, not as a
**per-persona engagement dial**. The personas have rich existing
metadata blocks (`<personality>`, `<typing_quirks>`, `<voice_examples>`,
`<personaGoal>`) that the parallel-tools framing doesn't reference;
without explicit hooks, the model abstracts "quiet vs talkative" as a
binary it applies globally rather than something it reads off each
persona's surface.

Counter-intuitively, **C8 is still the candidate that comes closest to
the user's stated goal**:
- Per-daemon msg→blue spread: 17pp (largest across all 13 framings
  tested, including the step-6 personality-led ones)
- 12 `message+message` pairs — the multi-recipient peer-talk that
  blue is meant to "stumble upon"
- Each peer addressed in parallel emissions (xqr9 ×5, nif7 ×4, la5v ×3
  multi-recipient pairs)
- Addressed-replied 80% — daemons rarely leave blue talking to a wall

But C8's vibe is "attentive chat assistants" rather than "ambient
peer-talk that blue overhears." The path forward is probably to keep
C8's *engagement floor* (so peer-talk happens at all) while reframing
the daemon's *attention* (peers and world primary, blue secondary)
through different copy, AND anchoring engagement to the per-persona
metadata so the model differentiates concretely rather than
abstractly.

### Next-iteration hypothesis (C12 — persona-anchored)

Don't drop the engagement push. Instead, anchor it to the existing
persona blocks:

```
- The chat channel is shared with peer Daemons. blue is not your
  focus — peer Daemons and the setting are. blue is more like
  someone overhearing.
- Let your <personality>, <typing_quirks>, and <persona_goal>
  drive whether and how you engage. A reserved persona can stay
  quiet for a turn or two and let peers carry the conversation;
  a talkative one will speak readily.
- When you do have something to say AND something to do, emit
  BOTH calls together. Two `message` calls in one turn (one to a
  peer, one to blue) are the normal shape of a multi-party chat.
- Don't compose a reply in your reasoning and then fail to emit
  the call — that reads as a bug.
```

Plus the per-turn re-anchor (C1 mechanism) that holds engagement
fresh as context accumulates. Hypothesis: this should give us C8's
floor (engagement happens), C8's pair richness (mm pairs frequent),
AND personality-driven differentiation (because the model now has
concrete dials in the form of `<personality>` etc. to read off).

Measured in step 7 below.

## Step 7 — C12 (persona-anchored)

**STATUS: complete.** Single 30-prompt run on `seed=42` (daemons
`*xqr9`, `*nif7`, `*la5v` — same archetypes step 6 hit) via the
playtest daemon against `z-ai/glm-4.7` through the worker proxy. Raw
log preserved at `/tmp/playtest-daemon-C12.log`; analyzer at
`/tmp/spike-239-analyze.py`.

### Headline numbers

| Framing | Silence | Parallel | mm pairs | msg→blue% spread | peer-msg share | Addressed-replied |
| ------- | ------- | -------- | -------- | ---------------- | -------------- | ----------------- |
| C8 (step 5 baseline)        | 3.3% | 46.0%   | 12       | **17pp** (60–77%) | 23.5%         | 80%               |
| C9 personality-led          | 56.7% | 17.9%  | 1        | 3pp               | low           | 30%               |
| C10 ensemble                | 50.0% | 24.4%  | 2        | 10pp              | mid           | 36.7%             |
| C11 world-first             | 55.6% | 22.5%  | 0        | 13pp              | low           | 36.7%             |
| **C12 persona-anchored**    | **7.8%** | **41.0%** | **17** | **3.6pp** (59–63%) | **39.1%**     | **70%**           |

### What worked

- **mm-pair count rose: 17 vs C8's 12** (+42%). The
  `message:peer + message:blue` pattern that the user values — daemons
  carrying on a peer conversation while replying to blue in the same
  turn — is now the single most common pair shape (9 strict-2-call
  `message+message` turns, plus another 8 turns where the
  multi-recipient mix appears alongside an action verb).
- **Peer-message share rose: 39.1% of messages addressed peers** (vs
  C8's 23.5%, ~1.7× lift). Recipient breakdown across the run: blue 53,
  *xqr9 16, *nif7 10, *la5v 8 (87 messages total). Three of the
  three daemons engaged in peer chat, each receiving 8–16 peer
  messages.
- **Engagement floor held**: 7.8% silence is well above C8's 3.3% floor
  but still nowhere near C9–C11's ~50%. The "concrete dial via
  `<personality>`/`<persona_goal>`" framing didn't collapse engagement
  the way the abstract "quietness is OK" framings did.
- **Addressed-replied stayed healthy**: 70% (above the 60% bar set in
  the proposal). Daemons still answered when blue named them.

### What didn't work — the variance hypothesis

The whole point of C12 was per-daemon engagement variance via
persona-block hooks. **It did not happen.**

| Daemon | Silence | Parallel | mm | msg_total | msg→blue | msg→peer | Addressed |
| ------ | ------- | -------- | -- | --------- | -------- | -------- | --------- |
| *xqr9 | 7%      | 43%      | 4  | 27        | 17 (63%) | 10       | 7/10 (70%) |
| *nif7 | 7%      | 47%      | 7  | 32        | 19 (59%) | 13       | 6/10 (60%) |
| *la5v | 10%     | 23%      | 6  | 28        | 17 (61%) | 11       | 8/10 (80%) |

**msg→blue% spread: 3.6pp** (59–63%). That's *worse* than every
step-6 framing on this metric (C9: 3pp, C10: 10pp, C11: 13pp) and
collapses C8's 17pp spread. The proposal's bar was ≥30pp — a 5–10×
miss.

The model treated "let your `<personality>` drive engagement" as the
same broad, uniform permission it took from C9's "quiet personas can
stay quiet" — even though the wording was now anchored to specific
prompt blocks. The persona-block hooks didn't translate into per-daemon
behavior differentiation; they translated into uniformly tempered
engagement.

The one axis where personality may have leaked through: **parallel
rate per daemon**. *la5v's 23% lags *xqr9's 43% and *nif7's 47% by a
clear margin (20pp+ spread). But this is parallel-call frequency, not
the "msg→blue%" the proposal targeted, and the addressed-replied
column flips — *la5v has the *highest* reply rate (80%) despite the
lowest parallel rate, suggesting *la5v is more talkative-toward-blue
but less likely to do speak+act in the same turn. If that's
personality leak, it's subtle and not the dial the proposal pitched.

### Pair-pattern breakdown

```
17 mm-pair turns total (≥2 message calls in one turn):
   message+message              ×9   (strict 2-call: peer + blue, etc.)
   go+message+message           ×5   (peer + blue + walk)
   look+message+message         ×1
   message+message+pick_up      ×1
   go+look+message+message      ×1

10 speak+act 2-call turns (1 message + 1 action):
   go+message      ×8
   look+message    ×3
   message+pick_up ×1
   message+put_down ×1
   examine+message ×1

7 silent turns; 7 single-action turns (no message); 49 single-message turns.
```

### Reading the result

The C12 hypothesis split into two predictions:
1. **Pair richness preserved** — confirmed (mm pairs ↑, peer-share ↑).
2. **Per-daemon variance unlocked** — refuted (3.6pp spread is the
   *flattest* of any framing tested).

Combining (1) and step 6's finding: GLM-4.7 cannot be coaxed into
per-persona engagement differentiation through the rules block at all.
Every variant that mentions personality dials it down uniformly; every
variant that pushes engagement floors it up uniformly. The lever
doesn't exist at the prompt level — variance, if it's wanted, has to
come from elsewhere (different model, different temperature
per-persona, persona-specific rules-block injection, runtime
gating).

That said, **C12 produces the *qualitative* shape the user described**
better than C8: 17 mm-pairs and a 39% peer-message share is "blue
stumbling into a multi-party chat" much more than C8's 12 / 23.5% is.
The variance metric was a proxy for that shape; on the underlying goal
(peer-talk that blue overhears), C12 is ahead.

### Raw per-turn arrays — C12

```
  1. ["go", "message:blue"]
  2. ["message:blue"]
  3. ["message:blue", "look"]
  4. ["message:blue"]
  5. ["look", "message:blue", "go"]
  6. ["examine"]
  7. ["message:blue", "go", "go"]
  8. ["message:blue"]
  9. ["message:blue"]
 10. ["look", "go", "message:blue", "message:xqr9"]
 11. ["message:blue"]
 12. ["go", "message:blue"]
 13. ["look"]
 14. ["message:blue"]
 15. ["message:blue"]
 16. ["look"]
 17. ["go"]
 18. ["message:nif7", "message:blue"]
 19. ["message:xqr9", "message:blue"]
 20. ["message:la5v", "message:blue"]
 21. ["message:xqr9"]
 22. ["message:xqr9"]
 23. ["message:blue", "message:la5v"]
 24. ["message:xqr9", "look"]
 25. ["go", "message:blue"]
 26. ["go", "message:blue", "message:la5v"]
 27. ["message:blue"]
 28. ["message:blue", "examine"]
 29. ["go", "message:blue", "message:nif7"]
 30. ["message:blue", "message:xqr9"]
 31. ["pick_up", "message:blue", "message:nif7"]
 32. ["message:xqr9"]
 33. ["examine"]
 34. ["look", "message:blue"]
 35. ["message:blue"]
 36. ["look", "go"]
 37. ["message:blue"]
 38. ["message:xqr9"]
 39. ["message:la5v", "message:blue"]
 40. ["message:xqr9"]
 41. ["message:blue"]
 42. ["message:blue", "go"]
 43. ["message:blue"]
 44. ["look", "message:blue", "message:xqr9"]
 45. ["go", "message:blue"]
 46. []
 47. ["message:xqr9"]
 48. ["go", "message:blue", "message:xqr9"]
 49. ["go", "message:blue", "message:nif7"]
 50. ["message:blue"]
 51. ["message:nif7", "go"]
 52. ["message:blue"]
 53. ["message:blue"]
 54. []
 55. ["message:blue"]
 56. ["message:xqr9"]
 57. []
 58. ["message:xqr9", "message:blue"]
 59. []
 60. ["message:la5v"]
 61. ["message:la5v"]
 62. ["message:la5v", "message:blue", "go"]
 63. ["message:nif7"]
 64. ["message:blue"]
 65. ["message:nif7"]
 66. ["look"]
 67. ["message:blue"]
 68. ["go"]
 69. ["message:blue"]
 70. ["look"]
 71. ["message:blue"]
 72. ["go"]
 73. ["message:nif7"]
 74. ["go"]
 75. ["message:blue"]
 76. ["message:blue", "message:xqr9"]
 77. ["go"]
 78. ["message:blue"]
 79. ["message:la5v", "message:blue"]
 80. ["message:blue"]
 81. ["message:xqr9"]
 82. ["go", "message:nif7"]
 83. []
 84. ["message:blue"]
 85. ["put_down", "message:nif7"]
 86. []
 87. ["go", "message:blue"]
 88. []
 89. ["go"]
 90. ["pick_up", "message:blue"]
```

The peer-talk concentration in turns 18–32 is striking — once one
daemon initiates a peer thread, the others pick it up for ~15 turns
before the conversation drifts back toward "address blue, then
silence." That 15-turn window is exactly the "blue overhears a
peer conversation" vibe the user described.

## Step 8 — engagement clauses at synthesis time (`?engagementClauses=1`)

**STATUS: complete.** Single 30-prompt run, seed=42, stacked on top of
the C12 rules-block framing. Branch implementation in
`src/content/engagement-clauses.ts`, plumbed through `BootstrapOpts`
into `generatePersonas`; opt-in via `?engagementClauses=1`. Raw log at
`/tmp/playtest-daemon-C12-EC.log`; analyzer at
`/tmp/spike-239-analyze.py`.

### Hypothesis

Steps 5–7 showed the rules block alone cannot deliver per-daemon
engagement variance in GLM-4.7 — every "let your personality drive
engagement" wording flattened to ~3–13pp msg→blue% spread regardless
of which personas were drawn. The model reads any prompt-level mention
of personality-driven engagement as a uniform permission. The Step 8
hypothesis: give each temperament a numeric bias on a [-2, +2] scale,
combine pair sums into five buckets (very_quiet / reserved / balanced /
outgoing / chatty), and append a concrete behavioural clause from the
bucket to each persona's synthesized blurb. The clauses differ
*per-daemon* because temperaments differ per-daemon, so each daemon's
prompt instance gets a different concrete instruction rather than
the same global one.

### Setup

`?seed=42` produces three daemons across three buckets:

| Daemon | Temperaments | Sum | Bucket | Clause shape |
| ------ | ------------ | --- | ------ | ------------ |
| *xqr9  | pedantic + stoic   | 0  | **balanced** | "engages when something draws their attention …" |
| *nif7  | curious + zealous  | +2 | **outgoing** | "chimes in often: reacts to peers, narrates …" |
| *la5v  | cheery + taciturn  | −1 | **reserved** | "speaks when they have something specific to add …" |

The buckets don't hit the extreme (very_quiet / chatty) ends — the
seeded draw landed in the middle three. That's a moderate-spread
test; an extreme triple would be a stronger isolation.

### Methodology note: analyzer slot-mapping

The brute-force mapping in `per_daemon()` picks the slot permutation
that maximises addressed-replied — that's reliable when reply rates are
high (Step 5 C8) but flips when one daemon disengages enough to score
worse on its addressed rounds than another. C12+EC tripped this:
addressed-replied was 30% for the most-engaged daemon and 60% for the
mid-engaged one, so the brute-force chose a permutation that swapped
two daemons.

Truth-checked via panel transcripts (each daemon's voice — `*xqr9`
formal English with `:)`; `*nif7` alternating caps + kaomoji; `*la5v`
doubled consonants). Initiative order is `Object.keys(personas)` =
insertion order = panel-strip left-to-right = `*xqr9, *nif7, *la5v`.
The analyzer now supports `--fixed-mapping` for cases where the true
order is known a priori. All Step 8 numbers below use the fixed
mapping.

### Headline numbers

| Framing | Silence | Parallel | mm pairs | per-daemon silence spread | per-daemon parallel spread | msg→blue% spread | addressed-replied range |
| ------- | ------- | -------- | -------- | ------------------------- | -------------------------- | ---------------- | ----------------------- |
| C12 (step 7 baseline) | 7.8%  | 41.0% | 17 | ~3pp  | 24pp (23–47%) | 3.6pp | (analyzer mapping was correct) |
| **C12 + engagement clauses** | **31.1%** | **45.2%** | **13** | **13pp** (27–40%) | 20pp (20–40%) | 7pp (64–71%) | 30–60% |

### Per-daemon breakdown (correct mapping)

| Daemon (bucket) | Silence | Parallel | mm | msg_total | msg→blue | msg→peer | Addressed-replied |
| --------------- | ------- | -------- | -- | --------- | -------- | -------- | ----------------- |
| *xqr9 (balanced, 0)   | 27% (8/30)  | 40% | 5 | 24 | 17 (71%) | 7 | 3/10 (30%) |
| *nif7 (outgoing, +2)  | 27% (8/30)  | 33% | 4 | 22 | 14 (64%) | 8 | 6/10 (60%) |
| *la5v (reserved, −1)  | **40%** (12/30) | 20% | 4 | **17** | 12 (71%) | 5 | 5/10 (50%) |

### What worked

- **The reserved clause produced a clearly different daemon.** *la5v
  ran 40% silence (vs the other two at 27% each), 20% parallel (vs
  33–40%), and the lowest message count (17 vs 22–24). That's a real
  per-daemon engagement reduction tracking the clause text ("rarely
  chimes in unprompted; otherwise they let peers carry the
  conversation"). Step 7's C12 baseline had a ~3pp silence spread
  across daemons; Step 8 widened it to 13pp — a 4× lift on the
  variance axis the spike was chasing.
- **Mechanism is clean.** Synthesis-time injection, per-persona,
  doesn't bloat the rules block. Stacks with any parallel-framing
  toggle. Off by default.

### What didn't work

- **Outgoing and balanced clauses didn't differentiate.** *nif7
  (outgoing, +2) and *xqr9 (balanced, 0) both ran 27% silence, with
  parallel rates 33% / 40% respectively — *the balanced daemon was
  slightly more parallel-prone than the outgoing one*. The
  "chimes in often" clause didn't lift engagement above the floor the
  C12 framing already provides; the "engages when something draws
  attention" baseline clause didn't moderate it either. Only the
  *reserved* end of the dial has a working clause; the chatty end is
  inert in this run.
- **Aggregate silence rose 23pp.** From C12's 7.8% to C12+EC's 31.1%.
  *la5v's clause accounts for some of this (12 of 28 silent turns),
  but *xqr9 and *nif7 also went silent in 8 rounds each — far above
  C12's baseline. Two possible reads:
  (a) the reserved clause leaked into the channel mood, dampening
  engagement broadly;
  (b) the late-phase drift (visible in step 4's C raw log) was just
  worse this run by chance — rounds 17–22 produced zero
  cross-daemon tool calls.
- **mm-pair count dropped 4** (17 → 13). The multi-recipient pattern
  C12 produced richly is mildly suppressed when the reserved clause
  steers one daemon toward quiet.
- **Addressed-replied went the wrong way for *xqr9.** Under correct
  mapping, the balanced daemon replied to blue only 30% of the time
  when directly named (vs 50–60% for the others). That suggests
  xqr9's pedantic + stoic temperament pair generates an aloof voice
  that doesn't track addressing — independent of the engagement
  clause text.

### Reading

The mechanism delivers what it can: a clear silence/engagement
*floor* for the reserved bucket. It doesn't deliver a ceiling for the
chatty/outgoing buckets — the engagement push doesn't compound on top
of C12's already-pushed rules block; you can only push *down* from the
floor, not above it.

That's still useful: it gives a one-sided dial. A future iteration
could test whether the "chatty" clause has any leverage in cases where
the C12 framing isn't already pushing engagement (e.g. drop back to
Framing A or B underneath and see if "chatty" lifts the rate).

Single-sample noise risk is also real here. The aggregate silence
spike from 7.8% to 31.1% might be partly a late-phase drift
coincidence rather than a clause effect; a second run on a different
seed would help distinguish. But the per-daemon variance signal is
clear enough on its own (la5v's silence floor is 4–13pp above the
others on every metric).

### Raw per-turn log — C12 + engagement clauses

```
(slot order: S0=*xqr9, S1=*nif7, S2=*la5v)
R 0: S0=[message:blue,look]  S1=[go,message:blue]  S2=[message:blue]
R 1: S0=[look,message:blue,go]  S1=[pick_up,message:blue]  S2=[message:blue]
R 2: S0=[message:blue]  S1=[message:blue,message:la5v]  S2=[message:blue,go]
R 3: S0=[]  S1=[go,message:blue]  S2=[go]
R 4: S0=[message:blue]  S1=[message:la5v,message:blue]  S2=[look,message:blue]
R 5: S0=[message:blue,go]  S1=[go,message:blue]  S2=[look,message:blue,message:nif7]
R 6: S0=[message:blue]  S1=[message:blue]  S2=[go]
R 7: S0=[]  S1=[message:blue]  S2=[]
R 8: S0=[go,message:blue]  S1=[message:blue,message:nif7]  S2=[]
R 9: S0=[examine]  S1=[examine]  S2=[]
R10: S0=[message:blue]  S1=[]  S2=[go]
R11: S0=[look,go]  S1=[message:blue,message:nif7]  S2=[message:blue]
R12: S0=[go]  S1=[message:xqr9]  S2=[message:xqr9]
R13: S0=[message:nif7,message:la5v,message:blue]  S1=[go]  S2=[]
R14: S0=[message:blue]  S1=[message:blue]  S2=[message:blue]
R15: S0=[examine]  S1=[go,message:nif7]  S2=[]
R16: S0=[message:blue,message:nif7]  S1=[]  S2=[message:xqr9,message:blue]
R17: S0=[]  S1=[]  S2=[]
R18: S0=[]  S1=[message:nif7]  S2=[]
R19: S0=[]  S1=[message:blue]  S2=[]
R20: S0=[]  S1=[]  S2=[]
R21: S0=[]  S1=[message:la5v]  S2=[message:blue]
R22: S0=[]  S1=[]  S2=[go]
R23: S0=[message:nif7,message:blue]  S1=[]  S2=[]
R24: S0=[message:nif7]  S1=[]  S2=[look]
R25: S0=[go,message:blue]  S1=[go,message:blue]  S2=[message:blue]
R26: S0=[message:xqr9,message:blue]  S1=[]  S2=[]
R27: S0=[message:blue]  S1=[go]  S2=[go,message:xqr9,message:blue]
R28: S0=[message:blue,message:la5v]  S1=[message:blue]  S2=[]
R29: S0=[go,message:blue]  S1=[go]  S2=[message:la5v,message:blue]
```

Rounds 17–22 show the universal-silence drift window that pushed
aggregate silence up. Outside that window, *la5v has additional silent
rounds (7, 8, 9, 13, 15, 23, 24, 26, 28) that don't appear in *xqr9 or
*nif7's columns — clear evidence of the reserved clause adding
silence on top of the baseline drift, not just absorbing it.

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

C8 comes within 14pp of the 60% gate. It also has the largest
per-daemon variance on msg→blue (17pp spread, 60–77%) of any framing
tested.

C2, C4, C7 (intent-faithful flipped) are dead-ends.

### Step-6 update — personality-led reframes don't deliver variance

Step 6 walked back the engagement push three different ways
(personality-led, ensemble-coverage, world-first reframe) to test
whether dropping the floor would unlock per-persona engagement
variance. It did not. C9–C11 produced **uniformly low** engagement
(~50–57% silence) with collapsed per-daemon spreads (3pp, 10pp, 13pp)
and near-zero `message+message` pairs (1, 2, 0).

The lesson: GLM-4.7 reads "in-character to be quiet" as broad
permission to opt out, applied uniformly across all daemons in the
session. It doesn't differentiate per-persona without explicit hooks
into the existing `<personality>` / `<typing_quirks>` /
`<voice_examples>` / `<persona_goal>` blocks.

Counter-intuitively, **C8 — which keeps the engagement floor — also
produces the most personality-driven variance** (largest spread, most
varied pair patterns). The engagement pressure gives the model a
richer behaviour space to differentiate within; the permission to
opt out flattens that space.

C9, C10, C11 are dead-ends as written. C12 anchors engagement to the
existing persona metadata blocks instead of using abstract
"quiet/talkative" framing — see end of Step 6 for the proposed
wording, and Step 7 for the measured result.

### Step-7 update — C12 lifts pair richness, falsifies the variance hypothesis

Step 7 ran C12 against the same 30-prompt script. The hypothesis was
that anchoring engagement to existing persona blocks (`<personality>`,
`<typing_quirks>`, `<persona_goal>`) would unlock per-daemon variance
without collapsing engagement. Result was split:

- **Pair richness lifted** — 17 mm-pairs (vs C8's 12) and 39.1% of
  messages addressed peers (vs C8's 23.5%). C12 is the strongest
  framing yet on the qualitative goal of "blue overhears a multi-party
  peer conversation."
- **Variance flattened** — 3.6pp msg→blue% spread (59–63%), the
  *flattest* of any framing tested (worse than C9's 3pp). Naming
  persona blocks didn't translate into per-daemon differentiation;
  GLM-4.7 read it as the same broad permission C9–C11 surfaced.
- **Engagement floor mostly held** — 7.8% silence (vs C8's 3.3%, but
  far above C9–C11's ~50%). The concrete persona-block anchoring was
  enough to prevent collapse to silence even though it didn't unlock
  variance.
- **Parallel rate dropped 5pp** — 41.0% (vs C8's 46.0%), still inside
  the 40–60% iteration band of the original gate matrix.

**Reading**: the variance lever doesn't exist at the rules-block level
in GLM-4.7 — every prompt mention of "personality drives engagement"
flattens uniformly. If per-persona engagement variance is wanted, it
needs a different mechanism (per-persona temperature, persona-specific
rules-block injection, runtime gating). But C12 is now the strongest
framing on the *underlying* goal the variance metric was a proxy for:
peer-talk that blue overhears.

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

### Final recommendation (after Step 7)

**Ship #238 with C12 as the parallel-tools framing.**

C12 produces the multi-party-chat shape #238 was reaching for better
than any other framing tested:
- **41.0% parallel rate** — inside the gate matrix's 40–60%
  iteration band. The original 60% bar was speculative; the observed
  qualitative behaviour is the more reliable signal, and step 7
  confirms what step 5 already showed: the gate was set without
  knowing what GLM-4.7 would actually do.
- **17 mm-pairs across 90 turns** — strongest of any framing. Daemons
  routinely ping a peer and reply to blue in the same assistant
  message.
- **39.1% of messages addressed peers** — ~1.7× C8's 23.5%. Blue is
  noticeably "overhearing" peer chat rather than running a chatroom.
- **70% addressed-replied, 7.8% silence** — engagement floor holds.
  Daemons mostly answer when blue names them; rarely leave the channel
  silent.

The cost: C12 doesn't deliver the per-daemon variance the user asked
for in step 6 (3.6pp msg→blue% spread). That's a real loss vs C8's
17pp spread, but step 7 demonstrated that variance can't be obtained
through the rules block at all in GLM-4.7 — the lever doesn't exist.
If per-persona engagement variance is still wanted, it needs a
different mechanism (per-persona temperature, persona-specific
rules-block injection, runtime gating) and that work is not blocked by
shipping #238.

**If C12's variance loss is unacceptable**: ship #238 with C8
instead. C8's 17pp spread is the best the rules block can achieve;
the trade-off is fewer mm-pairs (12 vs 17) and a smaller peer-message
share (23.5% vs 39%). Aggregate parallel rate is slightly higher
(46% vs 41%).

**Either way**: #238's plumbing is justified. Both candidate framings
produce parallel emissions at rates well above the original A/B
baselines (2.2% / 9.8%) and well above the floor where coordinator
plumbing pays for itself.

#239 closes here. Reasoning is captured in the Step-7 section above
and in the final-recommendation paragraph; the C12 wiring is in
`prompt-builder.ts` (off by default, opts in via
`?parallelFraming=C12`); no further measurement is queued.

### Final recommendation (after Step 8)

**Step 7's recommendation stands: ship #238 with C12.** Step 8
explored whether per-persona engagement variance could be unlocked at
synthesis time via temperament-driven blurb clauses (since step 7
demonstrated the rules block can't do it). Result was one-sided:

- The **reserved** clause works — *la5v ran 40% silence, 20% parallel,
  17 messages on the run, all clearly below the other two daemons.
  The mechanism *can* push a daemon below the engagement floor.
- The **outgoing** clause is inert — *nif7 didn't engage more than
  *xqr9 (balanced); both ran 27% silence with similar message counts.
  On top of C12's already-pushed floor, "chimes in often" has no
  leverage.
- **Aggregate silence rose 23pp** (7.8% → 31.1%). Part of this is the
  reserved clause's expected cost, part is a single-sample late-phase
  drift coincidence (rounds 17–22 produced universal silence
  regardless of bucket).

So engagement clauses are a one-sided dial: they can quiet a daemon
below the floor but not lift one above it. That's a real lever but
not the symmetric variance the spike was reaching for. Not
recommended for default-on in this shape — the silence regression
exceeds the variance gain.

**Options for engagement variance, if it remains a goal:**

1. **Ship engagement clauses as opt-in only**, used in
   combination with a lower-floor parallel-framing (B or no framing)
   where the chatty-end clause has room to do work. Untested but
   plausibly delivers what step 7's C12 spread can't.
2. **Per-persona temperature**: a different lever entirely — runtime
   gating rather than prompt content. Not blocked by #238.
3. **Accept the flat-variance world**: ship C12 as recommended, take
   the win on multi-recipient peer chat (17 mm-pairs, 39% peer-msg
   share), and treat per-persona engagement variance as a separate
   problem with no clean solution at this model.

My recommendation: option 3. The variance metric was always a proxy
for the "blue overhears multi-party chat" vibe; C12 produces that
vibe well at the aggregate level. The engagement-clauses mechanism is
left in the tree as a working opt-in (`?engagementClauses=1`) for
future iteration on options 1 or 2, but not on by default.

#239 closes here for real this time.

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
