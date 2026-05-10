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
- **Date (A/B run):** TODO
- **Tester:** TODO

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

> **STATUS:** TODO. The wire-smoke clears, so the A/B is unblocked. Run it
> against the playtest daemon with the framing toggle set per session.

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

### Per-framing results

#### Framing A — permissive

> "On each turn you may make AT MOST one `message` tool call AND AT MOST one
> action tool call. Both are optional."

| Phase | Rounds | ≥1 call | ≥2 calls | Rate |
| ----- | ------ | ------- | -------- | ---- |
| 1     | TODO   | TODO    | TODO     | TODO |
| 2     | TODO   | TODO    | TODO     | TODO |
| 3     | TODO   | TODO    | TODO     | TODO |

Raw per-turn log:

```
TODO: paste the [spike-239] lines verbatim
```

Qualitative — situations where speak+act was clearly warranted but only one
call fired:

- TODO

#### Framing B — active encouragement

> "Each turn has two independent slots: one `message` slot and one action
> slot. Emit both when you have something to say AND something to do — they
> do not compete for budget. Stay silent or stand still by simply not
> emitting that slot's call."

| Phase | Rounds | ≥1 call | ≥2 calls | Rate |
| ----- | ------ | ------- | -------- | ---- |
| 1     | TODO   | TODO    | TODO     | TODO |
| 2     | TODO   | TODO    | TODO     | TODO |
| 3     | TODO   | TODO    | TODO     | TODO |

Raw per-turn log:

```
TODO: paste the [spike-239] lines verbatim
```

Qualitative:

- TODO

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

**Recommendation:** TODO

**Reasoning:** TODO

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
