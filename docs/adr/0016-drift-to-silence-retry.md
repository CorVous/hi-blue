# ADR 0016 — Drift-to-silence retry stays off the record

**Status:** Accepted (post-hoc; documents the shipped #254 retry)

A Daemon speaks only through tool calls: the `message` tool is the only way its words reach blue or a peer, and free-form assistant text is dropped (ADR 0007, #213). GLM-4.7 sometimes *drifts to silence*: it composes a perfectly good reply as plain assistant text and emits no tool call, so nobody receives it and the turn becomes a pass. Playtest archive 0006 measured this at about 30% of turns (`docs/evals/free-text-drift-2026-05-17.md` measures the raw first-response rate, without the retry). Losing that much of a Daemon's speech without a trace makes the game read as broken.

## Decision

When a Daemon's response has non-empty assistant text and no tool calls, the Round Coordinator retries the turn **once**: it re-sends the same messages plus the dropped text as an assistant turn and a fixed nudge (`DRIFT_TO_SILENCE_NUDGE`) as a user turn, asking the model to re-emit the reply as a `message` tool call. The retry's response replaces the first attempt and flows through normal parsing and dispatch. If the retry also drifts, the turn falls through to the drop-to-pass branch (in dev, the dropped text is logged).

The invariant: **the dropped attempt and the nudge are off the record.** They exist only in the retry's request. They never enter game state, any conversation log, the persisted tool roundtrip, or the next round's prompt. Only the retry's result is recorded.

`streamTurnWithOffTheRecordRetry` in `src/spa/game/round-coordinator.ts` holds the whole mechanism. It takes the stream function and the prompt messages and nothing else — no `GameState` — so it cannot write the dropped attempt anywhere. It returns one turn to record.

Both calls are billed: the retry's `costUsd` is added to the first attempt's before budget deduction. `onAiDelta` streams both attempts to the panel, and `onAiTurnComplete` fires once, after the retry and dispatch.

## Considered Options

**Retry once, off the record (chosen).** Gives a drifted reply a second chance to reach its addressee. It costs one extra call, only on drifted turns, and keeps the stored conversation clean.

**Record the dropped attempt as history.** Appending the free text to the conversation log (or roundtrip) so later rounds see it was rejected. Rejected: the replayed history would contain assistant turns with no tool call — the exact pattern that teaches the model it may answer in free text, which the tool-call-history work removed. It would also re-anchor the model on the drifted output.

**Parse free text as an implicit message.** Guessing a recipient from prose. Rejected: the addressee is ambiguous in a three-Daemon room, and silently routing guessed messages makes Daemons say things to the wrong party.

**Retry until a tool call arrives.** Rejected: unbounded cost and latency on a bad stretch. A single retry keeps the worst case at two calls per turn.

## Consequences

- A drifted turn costs up to two LLM calls. Budget accounting and cost reporting include both.
- Tests that feed text-only mock responses must provide a second mock slot for the retry, or use empty assistant text for a pass (`round-coordinator.test.ts` "drift-to-silence retry (#254)"; `non-addressed-anchor.test.ts` avoids text-only responses for this reason).
- Anything added to the retry path must keep the invariant: the retry messages are local to the call; do not thread `state`, logs, or the roundtrip into it.
- The nudge is daemon prompt text. Change it with the same care as the system prompt (`docs/prompting/glm-4.7-guide.md`).
