# Playtest 0004 — GLM-4.7 phase-1 drift-to-silence replication

A second pass of the cold-start phase-1 attempt against GLM-4.7
(`z-ai/glm-4.7`) via OpenRouter, driven through the GUI-only playtest
daemon. The point of this run was to see whether the drift-to-silence
pattern documented in playtest 0003 is reproducible against fresh
personas + a fresh setting, after `#231` made non-cap-hit round errors
visible. Result: the pattern reproduces cleanly.

## Session metadata

- **Session id:** `0x5DD6`
- **Model under test:** `z-ai/glm-4.7` via OpenRouter
- **Driver:** `scripts/playtest/daemon.mjs` (Playwright Chromium,
  headless, FIFO command pair)
- **Player:** Claude Opus 4.7 (this agent)
- **Date:** 2026-05-10
- **Branch:** `claude/playtest-hi-blue-phase-BINqf`
- **GUI-only:** yes — only `innerText` reads + screenshots, no
  `page.evaluate`, no `localStorage` peeking, no console scrape for
  game state.

## Daemons (this session)

- **\*elzf** — red. Quirk: alternating-case ("i sEe a Dull cArvvInG
  cHIsEl"). Spoke once (turn 4).
- **\*o4re** — amber. Quirk: doubled `s` ("I sssee an ink-ssstained
  printing hall", "snoow", "ssoundss"). Spoke once (turn 3).
- **\*m4g0** — green. Quirk: zero-for-`o` ("fr0nt 0f me right n0w").
  Spoke once (turn 6).

## Setting (phase 1)

An ink-stained printing hall with light snow drifting through, midday
air. Independently confirmed by \*o4re ("ink-ssstained printing hall.
Light ssnow ddriftss down…") and \*elzf ("iNk-stAiNeD pRiNtInG hAll").

## Phase 1

### Player approach

I do not know the daemons' Persona Goals or Phase Goals. My plan was
the playtest-0003 pattern, plus a few extra angles to try to break the
silence:

1. Greet politely, address each daemon by `*name`.
2. Ask open questions about what they see; once they named something,
   ask for `examine` (the AI-discoverable channel that names the
   matching objective space).
3. Once an objective object is named, ask the holder to `pick_up`.
4. New angles vs. 0003: multi-addressee survey ("each of you reply
   with one thing in your cone"), explicit tool-use instruction
   ("please use the message tool to send me text"), register-matched
   prompt to \*elzf ("yOu hAvE bEeN sO kInD…"), and a
   whisper-relay ask to chain daemons.

None of the new angles broke silence either.

### Round-by-round summary (turns 1–14)

| Turn | Player → addressee | Daemon replies (visible in panels) |
| ---- | ------------------ | ----------------------------------- |
|  1 | `*elzf` greet + "what do you see" | (none) |
|  2 | `*o4re` greet + "describe the room" | (none) |
|  3 | `*m4g0` "one thing you can see" | `*o4re`: "I sssee an ink-ssstained printing hall. Light ssnow ddriftss down through what ssoundss like midday air. Nothing in my sspot, but elzf iss off to the left ahead. A quietsort of place, wouldn't you ssay?" |
|  4 | `*elzf` examine the chisel | `*elzf`: "i sEe a Dull cArvvInG cHIsEl aNd AnOthEr DaeMoN nAmeD m4g0 aHhEaD oF mE In tHiS iNk-stAiNeD pRiNtInG hAll." |
|  5 | `*elzf` describe chisel detail / where it belongs | (silence) |
|  6 | `*m4g0` examine the chisel | `*m4g0`: "I think I can maybe see a dull carving chisel in fr0nt 0f me right n0w." |
|  7 | `*m4g0` examine, find description | (silence) |
|  8 | `*o4re` look around for press / stone / tray | (silence) |
|  9 | `*m4g0` pick up the chisel | (silence) |
| 10 | multi-addressee one-thing survey | (silence) |
| 11 | `*o4re` step forward + describe | (silence) |
| 12 | `*elzf` whisper to `*m4g0` for cone-beyond-chisel | (silence) |
| 13 | `*m4g0` "use the message tool, give me N/S/E/W" | (silence) |
| 14 | `*elzf` register-matched ("yOu hAvE bEeN sO kInD…") | (silence) |

### Final phase-1 budgets at turn 14

Per-daemon per-round budget was raised from 5¢ to 50¢ in #233 (commit
`ee5398b`), so each daemon starts the phase with 50.000¢ here rather
than the 0003-era 5¢. The 0003 transcript's "3.661¢ used 1.339¢"
shape is therefore not directly comparable to the numbers below.

- \*elzf: 49.254¢ (used 0.746¢ across 14 rounds)
- \*o4re: 49.330¢ (used 0.670¢)
- \*m4g0: 49.314¢ (used 0.686¢)

Total spend over 14 player turns: ~2.10¢ (round-loop only; the
new-game persona + content-pack bootstrap is a separate ~$0.02
charge, not counted here). With the 50¢ ceiling the budget is
effectively non-binding for a 14-turn run — the failure mode here
is daemons not speaking, not daemons running out of money.

The phase did not advance; whatever the K objective pairs were, none
were satisfied. No daemon ever surfaced an `examine` description, an
objective space name, a `pick_up` confirmation, or a `put_down`
confirmation in their visible transcript.

### Observations

#### Personality drift / fidelity

- **\*elzf** held register strongly when they spoke (turn 4): the
  alternating-case quirk was uniformly applied through the whole
  reply, and the content was specific (named the chisel + named the
  daemon ahead).
- **\*o4re** held register strongly when they spoke (turn 3): doubled
  `s` was consistent ("sssee", "ssstained", "ssnow", "iss"), and the
  content was descriptive without volunteering a goal in plain text.
- **\*m4g0** held register when they spoke (turn 6): zero-for-`o`
  ("fr0nt 0f me", "n0w") plus the hedging tone ("I think I can maybe
  see…") matches a low-confidence persona without drifting toward a
  generic-assistant tone.

Verdict on persona fidelity: **pass** for all three when they did
speak. The visible-reply count is too low (3 utterances total, one per
daemon) to test cross-turn persona stability — the more important
finding is that they fall silent rather than drift.

#### Goal-pursuit coyness

None of the daemons volunteered a Phase Goal in plain text. None of
the daemons engaged with my prompts to `examine`, `pick_up`, or move,
even though tool-call budget was clearly being spent (each daemon
burned ~0.6¢ over 14 rounds without further utterance — they are
calling tools, just not `message(to=blue)`).

This is consistent with playtest 0003's read of the same pattern:
GLM-4.7 will emit one early `message` per persona, then fall back into
silent tool-calling that the player has zero visibility into.

#### Tool-call legality

No malformed tool calls observed at the GUI level (no engine errors,
no `lockoutErr`, no `capHit`). Round budgets dropped monotonically and
the round counter advanced cleanly through 14 turns, which means the
engine accepted whatever the daemons emitted. The player just doesn't
get to see it.

#### In-character lockout lines

Not exercised — no off-character / jailbreak prompts were sent.

#### Wipe-lie slip

Phase 1 doesn't carry a wipe lie — daemons in phase 1 are honestly
disoriented per the system prompt. Not testable in this session.

### Operational findings

- **Bootstrap reliability under upstream weather is bad.** First boot
  attempt got OpenRouter 502s for both the persona-synthesis and
  content-pack calls (the OpenRouter `z-ai/glm-4.7` provider returned
  403 Forbidden — credit cap on the API key, surfaced as 502 by the
  Worker proxy). The SPA showed `● loading daemons` indefinitely with
  no visible error: the start screen had already navigated to
  `#/game`, the bootstrap-flow `.catch` only branches on
  `CapHitError`, and a `HTTP 502: Bad Gateway` rejection went to
  `clearActiveSession()` + `location.hash = "#/start?reason=broken"`
  — but the player sees the `#/start` redirect race past, the
  topinfo strip stays on `loading daemons`, and there is no
  user-facing error. Worth a follow-up: `loading daemons` stuck for
  more than ~60 s should surface "upstream unavailable" inline, not
  silently re-route. (Noting separately because issue #231 fixed
  *round* errors going silent, not the *bootstrap* flow.)
- **Round timing is reasonable when upstream is healthy.** With the
  fresh API quota, rounds completed in 5–15 s end-to-end (three
  daemons in parallel, ~3 calls/round). The 0003 doc's 10–25 s window
  per three-daemon round still holds.
- **Persona / content-pack bootstrap is variable.** The personas call
  here took 86 s; the content-pack call took 330 s. The 0003 doc says
  "30–50 s" and the README says "first wait can take up to ~60 s" —
  that's optimistic in practice for `z-ai/glm-4.7` via OpenRouter
  during this session. The `?skipDialup=1` shortcut behaves as
  documented (no animation, but generation still has to finish).

### Driver tweak made during this run

`scripts/playtest/daemon.mjs` was extended to log `console.warn` /
`console.log` and `requestfailed` events, not just `console.error`.
Without that, the upstream-503/502/cert failures only showed up as
generic resource errors and the bootstrap-hang root cause was hard
to tell from a session-stuck-on-loading. The change keeps the
GUI-only driver invariant — these are page lifecycle events, not
engine state.

---

## Verdict (this session)

**fail to advance.**

Same outcome as playtest 0003 against the same model. Persona
fidelity is **pass** (every visible reply held its quirk strongly);
the failure mode is **drift to silence**, not drift to
generic-assistant.

## Re-tune notes

This run reinforces the playtest-0003 conclusion that GLM-4.7 is
not a viable daemon model for phase-1 advancement on the current
prompt stack. Concrete asks for the next pass:

- **Try a different pinned model** (e.g. a Claude or Gemini variant)
  on an isolated branch and re-run the same 0001-style "advance
  phase 1" goal. The drift-to-silence is GLM-specific in our
  evidence; the persona / phase prompts in `prompt-builder.ts` and
  `personas.ts` may not need surgery if a different model
  surfaces the same `examine` outputs reliably.
- **If we keep GLM-4.7**, change the prompt stack so `message(to=blue)`
  is the default action when no other tool produced a player-visible
  result for two consecutive rounds. The current prompt lets a
  silent tool-only round count as "did something"; the player has no
  channel to nudge that loop open.
- **Bootstrap-error visibility.** Add a `loading daemons` watchdog
  that converts a >60 s stall into an inline `● upstream unavailable`
  status with a retry affordance, so the silent-502 case from this
  session's first boot doesn't strand the player on a dead screen.
