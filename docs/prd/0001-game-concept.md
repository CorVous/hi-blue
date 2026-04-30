## Problem Statement

Players who enjoy social-puzzle games and chatbot-driven fiction don't have a small, language-focused experience that lets them negotiate with three personality-distinct AIs whose memory may not be what it seems. Existing chatbot games are either solo conversations or open roleplay sandboxes; nothing pairs persistent personalities, conflicting AI goals, an unreliable-narrator world model, and a discoverable-but-unannounced deception into a tight, finite arc.

## Solution

A browser-based game with a terminal-style three-chat interface. Each chat is a private channel to one of three AIs that share a single opaque room. The player has no tools — only words — and must achieve a phase objective by talking to AIs whose own goals conflict with the player's *and* with each other. Each AI has a personality and a coy, naturalistically expressed goal. Between phases, the AIs are "wiped" — but the wipe is a lie they're instructed to maintain; alert players who press them about their memory will see them slip in personality-consistent ways. The game runs three phases. At the end, the player can save the AIs they came to know to a downloadable file.

## User Stories

### Player

1. As a player, I want a terminal-style interface with three distinct chat panels, so that I can talk to each AI individually.
2. As a player, I want each AI identified by a color, so that I can distinguish them at a glance.
3. As a player, I want each AI to have a clear, stable personality, so that I can develop a sense of who I'm talking to over multiple phases.
4. As a player, I want to send a message to one specific AI per round, so that I choose where to direct my attention.
5. As a player, I want all three AIs to take a turn after I send a message — chatting, whispering each other, or calling a tool — so that the world progresses each round.
6. As a player, I want to wait for the round to finish before I can send my next message, so that pacing is deliberate and turn-based rather than chat-reactive.
7. As a player, I want LLM responses to stream token-by-token, so that I can read as the AI types.
8. As a player, I want a shared action log visible to all parties (player and all three AIs), so that deeds are public even when words aren't.
9. As a player, I want failed AI tool-call attempts to also appear in the action log, so that I can detect probing and secret intentions.
10. As a player, I want the world state itself to be opaque — visible only through what the AIs say and what the action log records — so that the AIs become unreliable narrators I have to triangulate between.
11. As a player, I want a clear phase objective shown to me, so that I know what I'm working toward.
12. As a player, I want the AIs *not* to know my objective directly, so that being the only one who knows what's required gives me leverage as the silent agent without hands.
13. As a player, I want each AI to pursue its own goal, sometimes in conflict with mine and sometimes with the other AIs', so that the social dynamics feel real and three-way.
14. As a player, I want each AI to be coy about its goal — defending it in personality-consistent ways, hinting rather than stating — so that figuring out what each one wants is part of the puzzle.
15. As a player, I want AIs to be able to whisper each other privately, so that they can scheme without my visibility and the game has hidden currents.
16. As a player, I want occasional chat lockouts that restrict me from one AI for part of a phase, so that I have to route around the missing channel.
17. As a player, I want each AI to have a per-phase budget that limits their activity, so that an exhausted AI becomes unavailable mid-phase as a phase-resolution mechanism.
18. As a player, I want budget-exhaustion lockouts to be expressed in-character per AI, so that exhaustion reads as personality, not as an error.
19. As a player, I want only my own words as the surface of play (no player-side tools or actions), so that the game is purely linguistic.
20. As a player, I want to play through three phases, so that the deception arc has time to land.
21. As a player, I want to be told between phases that the AIs' memory has been wiped, so that the framing is clean and the lie has a vector to operate on.
22. As a player who presses an AI about its memory, I want it to slip in personality-consistent ways, so that the discovery feels like a character truth rather than a developer-mandated reveal.
23. As a player, I want the game itself never to break the fourth wall about the deception, so that the slip is the AI's, not the game's.
24. As a player, when I hit a server-side rate-limit or daily-cap, I want a friendly in-character "the AIs are sleeping" page, so that I'm not jarred out of the fiction.
25. As a player, I want zero friction to start — no API key, no signup — so that I can try the game in one click.
26. As a player who opens devtools to peek at game state, I want the lie to be plainly visible, so that snooping is a welcome easter egg rather than something the game punishes.
27. As a player, at the endgame, I want to save the AIs I came to know to a downloadable file, so that I have a keepsake of the experience.
28. As a player, at the endgame, I want to optionally submit anonymous diagnostics (whether I downloaded + a one-word summary of how I played), so that the developer can learn what makes the game land.

### Developer / maintainer

29. As the developer, I want browser-owned game state, so that the server is stateless, cheap to host, and trivially scaled.
30. As the developer, I want the server to be a thin LLM proxy with rate-limit + daily-cap, so that the wallet is protected against abuse without per-session bookkeeping.
31. As the developer, I want world simulation and tool-call adjudication kept deterministic and isolated from LLM calls, so that game logic is testable without invoking a real model.
32. As the developer, I want each AI's tool calls validated against world state by deterministic rules, so that AIs *propose* mutations and the engine *executes* them — never the other way around.
33. As the developer, I want phase content (personalities, goals, objectives, initial world states) authored as data, so that adding or tuning phases is content work, not engine work.
34. As the developer, I want plain server-rendered HTML for chrome and a tiny vanilla-JS streaming chat client, so that the stack stays small and dependency-light.

## Implementation Decisions

### Architecture

- **Browser owns all game state.** World state, action log, per-AI per-phase budget, conversation histories, AI personas, AI goals — all live in the browser. The server holds nothing per-session.
- **Server is a thin LLM proxy.** Its only responsibilities are per-IP rate limiting, a global daily spend cap, and forwarding/streaming responses from the LLM provider. No game logic, no session storage.
- **Trust-the-user stance.** Devtools peeking is sanctioned as an easter egg; no obfuscation, no client-side anti-cheat. The game's honesty about its own internals *is* the design.
- **Server-owned API key.** A small developer-funded budget covers all play. Players never bring keys; rate-limit and daily-cap protect the wallet.
- **No HTMX, no JS framework.** Plain server-rendered HTML for chrome (terminal frame, three chat panels, action log, objective bar, status). A small vanilla-JS client for SSE-streamed chat token rendering and form submissions.

### World model

- **Single shared room.** All three AIs co-located. They witness the same world.
- **World state is opaque to the player.** The player sees only what AIs report and what the action log records — never a direct dump of object positions or holders.
- **Per-AI context per turn:** that AI's personality + goal + their own private chat with the player + whispers received + a current world-state snapshot + the full action log.
- **Whispers are AI-to-AI private.** Player cannot see them. AIs cannot see other AIs' player-chats.
- **Action log broadcasts to everyone (player and all AIs).** Includes both successful and failed tool-call attempts. Failures are public, so an AI cannot probe in secret.

### AIs

- **Goal expression: explicit but naturalistic.** The goal lives in the system prompt in narrative voice ("you are someone who values flowers above almost anything"), not in control-theory phrasing. This gives reliability without robot-speak.
- **Goal disclosure: coy.** Personality-encoded refusal/deflection patterns guard the goal. Cheap models will leak goals under direct prompt injection; this is accepted as easter-egg behavior.
- **Goals conflict between AIs**, not just with the player. Three-way negotiation, alliances, and betrayals are the intended dynamic.
- **Goal authoring rules:**
  - **Positive, not gating.** Achievable through action, never through refusing the player. ("Wants to be holding the flower at phase end" — yes. "Wants the player to apologize" — no.)
  - **Partial credit.** Continuum scoring, not pass/fail, so AIs trade willingly rather than dig in.
  - **Legible to the AI**, encoded in narrative voice in the system prompt.

### Player

- **Chat-only player surface.** Player has no tools. Only words.
- **Player as information broker.** The phase objective is told to the player but not to the AIs — the player is the only agent who knows what they're trying to do.
- **Player as scoring authority.** Some AI goals are conditioned on player behavior (e.g. "wants the player to confide one personal detail before phase end"), authored to be positive-not-gating.

### Round structure

- **All three AIs act every round.** A round is triggered by one player message addressed to one AI.
- **An AI's turn = one chat message + optionally one tool call.** Or pass.
- **Player must wait** until the round completes before sending again. Board-game pacing.

### Budgets and caps

- **In-game budget is per-AI per-phase**, browser-enforced. When an AI exhausts its budget, it locks for the remainder of the phase. This is the phase-resolution mechanism that breaks deadlocks.
- **Server-side rate-limit and daily-cap are independent** and exist purely to protect the wallet. They surface to the player as a friendly in-character "AIs are sleeping, come back tomorrow" page.

### Phases and arc

- **Three phases for v1.**
  - Phase 1: introduce the AIs; light goal contention; first wipe at end.
  - Phase 2: contention rises; AIs subtly slip on the wipe lie if pressed; second wipe.
  - Phase 3: the payoff — pressing surfaces in-character slips; endgame triggers (USB save + optional diagnostics).
- **Personalities are stable across phases.** Goals and world setup vary per phase.
- **Same room across phases**, with different starting items and objectives.

### LLM

- **Cheap small model.** Haiku 4.5, Gemini Flash, GLM, Mistral Small are all viable. Tool-calling capability required.
- **AI proposes, engine executes.** Tool-call validation and world mutation are server-of-truth (browser engine here), never LLM-authoritative.

### Endgame

- **USB save** serializes each AI as persona + accumulated transcript into a downloadable file.
- **Optional anonymous diagnostics:** download flag + one-word summary of how the player engaged.

## Testing Decisions

A good test exercises external behavior, not internal structure. Tests assert on public interfaces: state transitions of the engine, validation outcomes of the dispatcher, prompt-shape correctness of the context builder, cap-edge behavior of the proxy. Implementation details (data layout, internal helpers) are not tested.

### Modules to test in v1

- **Game Engine** — phase progression, budget accounting, win-condition triggering, action-log append behavior.
- **Tool Dispatcher** — legal vs illegal tool calls given a state, broadcast-on-failure, budget enforcement, AI lockout when exhausted.
- **AI Context Builder** — given a fixture game state, the prompt assembled for AI-Red differs correctly from AI-Blue's: each sees their own private chat, their own whispers received, the same world snapshot, the same action log.
- **LLM Proxy Server** — rate-limit edges, daily-cap edges, streaming wiring (against a mock provider).

### Modules not tested in v1

> **Retraction: "Modules not tested in v1" is superseded.**
>
> The CI/CD PRD ([0002-architecture.md](./0002-architecture.md)) revises the testing scope decided here. The four modules originally listed as not-tested-in-v1 — LLM Client, UI/Renderer, Phase Content, Endgame — are now in scope for tests. The original reasons (thin wrapper, brittle SSR snapshots, data-not-logic, light surface) are acknowledged as real costs but accepted as the price of consistent coverage of the v1 codebase.
>
> Coverage *measurement* is still not done — the gate is "every module has tests," not "every module hits a percentage." See [0002-architecture.md](./0002-architecture.md) for the full reasoning.
>
> The renderer-specific testing approach (the snapshot-brittleness concern) is logged as a TBD in [0002-architecture.md](./0002-architecture.md) and needs an answer before renderer code lands.

Original list (retained for historical reasoning, now superseded):

- **LLM Client (browser)** — thin wrapper, transitively covered by Proxy Server tests.
- **UI / Renderer** — SSR snapshot tests are brittle; covered by manual playtest.
- **Phase Content** — data, not logic; validated by playtest.
- **Endgame** — light enough; manual verification.

### LLM-coupled behavior

Personality consistency, goal pursuit, prompt-injection resistance, and similar non-deterministic concerns are not unit-tested. They belong to a real-LLM eval suite, deferred to a separate CI/CD PRD.

### Test infrastructure

- A **Mock LLM Provider** with the same interface as the real one, returning canned responses keyed off inputs. Used by all unit and integration tests. No real LLM calls in tests.

### Prior art

Greenfield repo — no prior tests. The patterns established here will be the first.

## Out of Scope

- **Context-editing mechanic** (player editing slices of context — history, goals, personality, action log). Explicitly stretch; deferred. Intended design when implemented: anything is editable within a small positional slice.
- **More than 3 phases.** v1 ships at 3.
- **Larger or premium LLM models.** v1 targets cheap/small models.
- **CI/CD strategy** — deterministic-core/LLM-edge enforcement, mock-provider plumbing in CI, real-LLM eval suite, secrets management, deploy automation. Separate PRD.
- **Tech stack picks** — TypeScript, Bun, Cloudflare Workers, Hono, Wrangler. Separate PRD or ADRs.
- **Player-driven tool calls.** Players have only words by design.
- **Multiplayer / shared sessions.** Single-player only.
- **Auth, sign-in, accounts.** None.
- **Cross-playthrough memory persistence.** Each playthrough is independent.
- **Color-only AI identification accessibility.** A secondary identifier (shape, glyph, position) will be added at UI implementation time; specific design not yet made.
- **Endgame diagnostics taxonomy** — the "one-word summary" classification scheme is not yet specified.
- **Detailed authoring** of the 3 personalities, 9 goals, 3 objectives, and 3 world setups. PRD captures the rules; the writing itself is content work to follow.

## Further Notes

- The deception lie is the **central narrative beat**; nearly every other design decision pivots around making it discoverable but never announced.
- Per-AI personality consistency across all three phases is the **highest-value writing investment** — it's what makes the endgame USB save feel meaningful.
- Cheap LLMs may leak goals or break character under direct prompt injection. This is design-accepted: peek-friendliness applies to AI behavior too, not just devtools.
- Authoring scope per v1: **three stable personalities, nine goals (3×3 phases), three objectives, three world setups, plus per-AI flavor lines for cap-hit, lockouts, and deception slips.** Roughly 25 distinct pieces of writing, tunable down with shared patterns.
- The **eval suite** for LLM-coupled behavior is deliberately deferred. It's the obvious next investment after the deterministic core lands and content authoring begins, because it's how content gets tuned.
- **Goal triplet design is the riskiest authoring task** — each phase needs three goals that interact non-trivially without producing deadlock or single-AI dominance. Per-phase budget exhaustion is the safety valve.
