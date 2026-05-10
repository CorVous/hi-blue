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
3. **Pin the seed**: TODO — note the URL params used so personas, settings,
   content pack, and lockout-AI are identical between A and B.
4. Use a scripted ~30-prompt sequence designed to consistently warrant
   speak+act. Same script across A and B. Don't ad-lib — once the
   conversations diverge, the comparison is noise.

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
