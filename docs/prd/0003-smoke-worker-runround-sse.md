## Problem Statement

A QA tester opening the smoke worker today gets a single mock AI echoing a canned reply. The three-AI Round Coordinator, the action log, the tool-failure visibility, the mid-phase chat lockout, and the phase progression / wipe lie all exist in code and are unit-tested — but none of them are reachable from a browser, because `_smoke.ts` only routes `POST /chat` to a single `MockLLMProvider`. The human QA checklist for issues #13, #15, #16, #17, and the multi-AI portions of #19 cannot be executed against the running worker. A reviewer also can't sniff-test feel: pacing, action-log readability, lockout legibility, phase-transition UX. The deterministic core is "tested" but not "playable."

## Solution

The smoke worker drives `runRound` end-to-end. A new game-session layer holds a `GameState` per browser tab, accepts player messages addressed to a specific AI, runs a full round through the coordinator, and emits the resulting events over SSE in the wire format the existing chat-page renderer already understands (`ai_start`, `token`, `ai_end`, `budget`, `lockout`, `chat_lockout`, `chat_lockout_resolved`, `action_log`, plus new `phase_advanced` and `game_ended`). After the wiring lands, opening the worker in a browser produces a real three-AI game: panels update independently, the action log narrates, lockouts fire and resolve, phases advance, and the wipe is observable across the boundary.

The mock LLM provider stays the source of completions. Token streaming is paced for visual feel rather than driven by the underlying provider stream — the coordinator continues to buffer per AI before parsing, and the encoder re-emits the buffered string as paced `token` events. This keeps the round-coordinator interface unchanged and the existing tests untouched while still producing a streaming UI experience.

## User Stories

### QA tester

1. As a QA tester, I want to open the smoke worker and see three AI panels, so that I can verify the coordinator's three-AI orchestration visually.
2. As a QA tester, I want to send a message to a specific AI from the chat input, so that I can verify message routing reaches only the addressed AI's history.
3. As a QA tester, I want to watch each AI's tokens appear in its own panel, so that I can verify panels update independently rather than serially blocking.
4. As a QA tester, I want to see each AI's remaining budget update after every turn, so that I can verify per-AI budget accounting.
5. As a QA tester, I want to see the action log fill in as the round plays out, so that I can sniff-test whether it reads as a coherent narrative.
6. As a QA tester, I want to see tool failures rendered visibly to other AIs, so that I can verify issue #15's public-failure semantics.
7. As a QA tester, I want a chat lockout to actually fire mid-game, so that I can verify the disabled selector state and in-character lockout message.
8. As a QA tester, I want to confirm the locked AI still receives whispers and takes turns, so that I can verify the lockout is player-channel-only.
9. As a QA tester, I want to watch a chat lockout resolve at its scheduled round, so that I can verify the unlock UX.
10. As a QA tester, I want to cross a phase boundary and see the AIs behave as if wiped, so that I can sniff-test issue #17's wipe lie.
11. As a QA tester, I want a clear visual signal when a phase ends and a new one begins, so that I can verify phase-transition UX.
12. As a QA tester, I want to reach an end-of-game state when phase 3's win condition fires, so that I can verify game completion semantics independently of the endgame screen wiring.
13. As a QA tester, I want the rate-limit and daily-cap guards to still apply on the new endpoint, so that abuse paths remain covered.
14. As a QA tester, I want the network plug substitute (kill the worker mid-round) to leave the UI in a recoverable state, so that I can verify graceful degradation.

### Player (future)

15. As a player, I want to start a fresh game in a new browser tab, so that my session does not collide with other sessions on the same worker.
16. As a player, I want my game state to survive page reloads within a tab session, so that I do not lose progress on accidental refresh.
17. As a player, I want the chat input disabled while a round is in flight, so that I do not double-submit.
18. As a player, I want to see whose turn is in progress, so that I understand what the worker is currently computing.

### Developer

19. As a developer, I want the SSE event taxonomy to live in one encoder module, so that the wire format has a single source of truth.
20. As a developer, I want the game-session layer to be testable without HTTP, so that round-lifecycle logic is verifiable in unit tests.
21. As a developer, I want the round coordinator's interface to remain unchanged, so that no existing tests need to be rewritten.
22. As a developer, I want session storage abstracted behind a tiny interface, so that swapping in-memory for KV later is a one-module change.
23. As a developer, I want a clear seam where the eventual `AnthropicProvider` plugs in, so that the deferred real-LLM wiring is a plug, not a refactor.

## Implementation Decisions

### Modules

- **GameSession (deep).** Owns the lifecycle of a single game's `GameState` across HTTP requests. Constructed from a phase-config triple. Exposes a `submitMessage(addressedAi, message, provider)` method that runs one round and returns the structured `RoundResult` plus any per-AI streaming the encoder needs. Holds the only mutable state in the system; everything below is pure or stateless.
- **RoundResultEncoder (deep, pure).** Translates a `RoundResult` plus per-AI buffered completion strings into a flat sequence of structured SSE events in the wire format the renderer already consumes. New event types (`phase_advanced`, `game_ended`) added here. Single source of truth for the wire format.
- **SessionStore (thin).** Cookie-keyed in-memory `Map`. Two operations: get-or-create and update. No persistence. Single-worker assumption is fine for v1.
- **Game endpoint handler (thin).** A new sub-route in the smoke worker (`POST /game/turn`, `POST /game/new`) that pulls the session, calls `GameSession.submitMessage`, and pipes the encoder output through the existing rate-guard wrapper to the SSE response. The handler itself is thin glue.
- **Round coordinator (unchanged).** No changes to `runRound` or its interface. Token streaming feel is produced by the encoder pacing the buffered completion string, not by piercing the coordinator's `collectCompletion` boundary.

### Wire format

- Existing event types preserved exactly: `ai_start`, `token`, `ai_end`, `budget`, `lockout`, `chat_lockout`, `chat_lockout_resolved`, `action_log`. The renderer's parser is the contract; the encoder must round-trip cleanly through it.
- New event types: `phase_advanced` (carries the new phase number and the new phase's objective), `game_ended` (terminal signal, no body needed). Renderer additions to handle these are part of this PRD's scope.
- `[DONE]` and `[CAP_HIT]` legacy sentinels preserved for compatibility with the rate-guard short-circuit path.

### Session lifecycle

- Sessions are scoped per browser tab via a session cookie set on first `POST /game/new`.
- Session storage is in-process — a `Map` on a module-level singleton inside the worker. Acceptable for v1 because the worker is single-instance in local Wrangler dev. KV persistence is out of scope (separate follow-up).
- A worker restart drops all sessions. Documented as expected for QA scope.
- No cross-session isolation guarantees — this is a single-player local development worker, not a multi-tenant service.

### Provider seam

- The mock provider stays the only wired option. The `AnthropicProvider` throw in `createProvider` remains in place; no real-LLM wiring in this PRD.
- The provider is constructed once per request (current pattern preserved) and passed into `GameSession.submitMessage`.

### Token pacing

- The encoder splits the buffered completion string into reasonable chunks (e.g. word-level) and emits paced `token` events, so the UI shows progressive rendering even though the underlying provider call is synchronous-buffered. This is a deliberate v1 cheat — when the real Anthropic provider lands, the round coordinator's `collectCompletion` is the natural place to refactor into a streaming iterator, at which point the encoder can pass tokens through directly.

## Testing Decisions

A good test for this slice asserts external behaviour: given a `GameState` and a player message, the round produces the expected sequence of SSE events in the expected order. Tests should not assert on internal data structures, the existence of specific functions, or implementation details that would change if pacing or session-storage choices were revisited.

### Modules tested

- **RoundResultEncoder** — fixture-driven unit tests. Feed in a constructed `RoundResult` plus per-AI completion strings, assert on the flat event sequence. Coverage: every event type, including `phase_advanced` and `game_ended`, plus the chat-lockout trigger / resolve combination across a single round.
- **GameSession** — round-lifecycle integration tests using a deterministic mock provider. Coverage: message routing (only addressed AI's history receives the player message), state mutation across rounds, phase advancement when the win condition fires, game completion at end of phase 3.

### Modules not tested at this level

- **SessionStore** — too thin (Map wrapper) to warrant isolated tests; covered transitively through endpoint integration tests.
- **Game endpoint handler** — integration-tested via `@cloudflare/vitest-pool-workers` using the same pattern as the existing smoke and diagnostics-endpoint tests. Coverage: session creation, end-to-end SSE event sequence on a turn, rate-guard short-circuit still works.
- **Round coordinator** — unchanged; existing tests remain authoritative.

### Prior art

- The proxy-side smoke test is the model for endpoint-level tests inside the worker pool.
- The round-coordinator unit tests are the model for round-lifecycle assertions; the new `GameSession` tests should look similar in shape, with the session wrapper as the SUT instead of `runRound` directly.
- The UI tests already assert on rendered HTML for chat-lockout disabled state; renderer additions for `phase_advanced` and `game_ended` follow that pattern.

## Out of Scope

- **Real `AnthropicProvider` wiring.** Mock provider stays. The `LLM_PROVIDER=anthropic` branch continues to throw. Tracked separately.
- **KV-backed session persistence.** In-memory only. Cookie-keyed sessions die on worker restart. Tracked separately if/when multi-instance deployment matters.
- **Endgame screen routing.** Reaching the endgame screen from the worker is a separate PRD. This PRD only emits the `game_ended` event; whatever consumes that signal client-side is the next slice.
- **Save payload client populator.** The save-payload populator on the endgame screen is a separate PRD — this slice does not own client-side game-loop state plumbing.
- **Real-stream token piping.** The encoder paces buffered tokens for v1. True provider-driven streaming is a follow-up tied to the real-LLM wiring.
- **Session cleanup / expiry.** No GC on the in-memory session store. Worker restart is the only cleanup mechanism.
- **Multi-player or cross-tab synchronisation.** One game per browser tab; tabs are independent.
- **Authoring of phase-config triples.** This PRD assumes the phase configs already exist or are stubbed; full content authoring is HITL-scoped (issue #18).

## Further Notes

- The wire format is the contract this PRD locks in. Once the encoder is the single source of truth for SSE events, future event-shape changes flow through one module — keeping it that way is the architectural win, regardless of whether token pacing or session storage gets revisited.
- The "buffer then pace" choice for token streaming is a known cheat. It should be revisited at the same time the real Anthropic provider lands — refactoring `collectCompletion` from buffered to streaming is mechanical, and the encoder is already shaped to accept token events from either source.
- This PRD assumes the existing `renderChatPage` SSE handler logic is the authoritative wire-format consumer. Any drift between the encoder's emitted events and what the handler parses is a bug in the encoder, not the renderer.
- After this PRD lands, the QA checklist items currently marked "blocked on smoke worker driving runRound" become executable. The other QA blockers (endgame route, save populator) remain as separate follow-up PRDs.
- Tracked on the issue tracker as #25.
