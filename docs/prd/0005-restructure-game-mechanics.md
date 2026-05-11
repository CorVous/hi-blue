## Problem Statement

The current three-phase structure produces a game where all mid-game pressure comes from Phase Goals (private per-daemon short tasks) and a fixed win condition (bring objective object to objective space). The phase arc also requires the Wipe Lie — an increasingly fragile fiction that AIs have been memory-wiped between phases — as its primary deception vector. Players experience the game as a linear sequence of three nearly-identical puzzles rather than a single escalating negotiation. Phase boundaries are abrupt seams that interrupt momentum, and the single objective type (Carry) limits the variety of social puzzles the game can present. Finally, there is no meaningful end-game choice: the session just ends.

## Solution

Collapse the three-phase structure into a single continuous game. Replace Phase Goals and the Wipe Lie with a **Complication** schedule: mid-game disruptions that escalate over time. Expand the win condition into a pool of four **Objective** types that Daemons discover through examination. Add an end-game choice screen with three options (New Daemons, Same Daemons New Room, Continue with OpenRouter). Introduce a **Session archive** so completed sessions are preserved and can be resumed by players with an OpenRouter key. Generate two paired **Content Packs** (A and B) upfront for a potential Setting Shift complication. Retire Phase Goals, the Wipe Lie, and per-phase budget accounting.

## User Stories

### Player — core game loop

1. As a player, I want the game to be a single continuous session rather than three phases, so that my negotiation with the Daemons builds without artificial seams.
2. As a player, I want 2–3 Objectives per game drawn from a pool, so that each run feels meaningfully different.
3. As a player, I want to discover Objectives by having Daemons examine items and spaces, so that the puzzle emerges through play rather than being handed to me upfront.
4. As a player, I want Objectives to stay satisfied once achieved — with no possibility of reversal — so that progress feels permanent and I can focus on remaining tasks.
5. As a player, I want to win when all Objectives are satisfied, so that the game has a clear, achievable end state.
6. As a player, I want the game to end when all Daemons have exhausted their budgets, so that resource management carries real stakes.
7. As a player, I want an exhausted Daemon to emit a farewell line before going silent, so that budget exhaustion reads as a character moment rather than an error.
8. As a player, I want Daemon budgets to cover the full single game (not reset per phase), so that I feel the accumulating cost of each round.

### Player — Objective types

9. As a player, I want a **Carry Objective** where a Daemon must bring a specific object to a specific space, so that spatial negotiation remains a core mechanic.
10. As a player whose Daemon examines a Carry Objective item, I want the examine description to hint at the target space, so that I can piece together what needs to happen.
11. As a player, I want a **Use-Item Objective** where a Daemon must use a specific pickupable item, so that I have a reason to negotiate around items beyond just moving them.
12. As a player whose Daemon has satisfied a Use-Item Objective, I want the item to remain on the grid with updated examine and look flavor, so that the world reflects the change without items disappearing.
13. As a player, I want a **Use-Space Objective** where a Daemon must use a specific space (regardless of whether they are holding anything), so that spaces themselves become targets of negotiation.
14. As a player whose Daemon satisfies a Use-Space Objective, I want a generated flavor event to fire and the space's examine and look flavor to update, so that the moment of completion feels distinct.
15. As a player whose Daemon has satisfied a Use-Space Objective, I want the `use` action to no longer be available on that space, so that the space's state is unambiguously resolved.
16. As a player, I want a **Convergence Objective** where any two Daemons must stand on a specific space simultaneously, so that I have reason to engineer cooperation between Daemons.
17. As a player whose single Daemon stands on a Convergence Objective space, I want the space to emit a distinct flavor line, so that I can detect proximity to satisfaction without it being solved.
18. As a player whose two Daemons share a Convergence Objective space, I want the objective to be immediately satisfied with a second distinct flavor line, so that the win moment is legible.
19. As a player, I want the same Objective type to be able to appear more than once in a single game, so that the pool draws feel genuinely random rather than constrained.

### Player — Complications

20. As a player, I want mid-game Complications to start firing within the first 5 rounds, so that pressure builds before I have fully settled into a strategy.
21. As a player, I want subsequent Complications to fire every 5–15 rounds (randomly), so that the pacing is unpredictable and I cannot plan around a fixed schedule.
22. As a player, I want only one Complication to fire per round, so that the game never simultaneously applies multiple disruptions.
23. As a player, I want a **Weather Change** complication to update the room's atmosphere, so that the environment feels dynamic over the course of a game.
24. As a player, I want Weather Change broadcast to all Daemons as a neutral system message ("the weather has changed to X"), so that no Daemon has privileged weather information.
25. As a player, I want a **Sysadmin Directive** complication to secretly instruct one Daemon to behave in a specific way, so that I have to read behavioral changes as social signals.
26. As a player, I want Sysadmin Directives to include a meta-instruction not to reveal the directive, so that the deception layer remains alive even without the Wipe Lie.
27. As a player, I want a Sysadmin Directive to remain active until the Sysadmin explicitly revokes it, so that I cannot wait out the complication.
28. As a player, I want a **Tool Disable** complication to remove a specific tool from one Daemon's available tools, so that unexpected capability loss creates routing challenges.
29. As a player, I want the affected Daemon to receive a Sysadmin notification when a tool is disabled and again when it is restored, so that the Daemon's behavior change has a legible in-fiction cause.
30. As a player, I want Tool Disables to be mechanically enforced (tool absent from available tools, not just described), so that a Daemon cannot accidentally use a disabled tool.
31. As a player, I want an **Obstacle Shift** complication to move one Obstacle one adjacent cell, so that paths I relied on can be closed without warning.
32. As a player, I want Obstacle Shifts to be visible only to Daemons who have that cell in their Cone at the moment of the shift, so that information asymmetry is preserved.
33. As a player, I want Obstacle Shifts to produce a generated flavor Witnessed event, so that the shift has an in-fiction texture rather than just happening silently.
34. As a player, I want a **Chat Lockout** complication to prevent me from messaging one Daemon for 3–5 rounds, so that I have to route my negotiation around the missing channel.
35. As a player, I want a **Setting Shift** complication to transform the room into a different Setting, so that a rare, dramatic world change can occur mid-game.
36. As a player, I want the Setting Shift to update all entity names and descriptions to match the new Setting (seamlessly, using pre-generated Pack B), so that the world feels coherently transformed rather than patched.
37. As a player, I want the Setting Shift to fire at most once per game, so that it feels like a special event rather than a recurring disruption.
38. As a player, I want Complication types to stack — multiple active simultaneously across different Daemons — so that late-game pressure can become genuinely complex.

### Player — end-game and session management

39. As a player, I want an end-game screen to appear when I win or lose, so that the experience has a clear conclusion.
40. As a player, I want the end-game screen to offer three choices, so that I can decide my next experience immediately without losing momentum.
41. As a player who chooses **New Daemons**, I want a fresh Session with new Personas, so that I can start completely over.
42. As a player who chooses **Same Daemons, New Room**, I want a new Session using the same Personas with cleared logs, so that the Daemons are familiar but genuinely disoriented in a new space.
43. As a player with an OpenRouter key who chooses **Continue**, I want a new room generated for the existing Daemons with their full conversation history intact, so that I can keep playing with Daemons who remember everything.
44. As a player choosing New Daemons or Same Daemons New Room, I want the current Session to be archived before the new one is minted, so that my history is preserved.
45. As a player, I want archived Sessions visible in the session picker with a "last played" timestamp, so that I can review my history.
46. As a player, I want each session line (active or archived) to show an **Epoch #** counter, so that I can see how many times that save line has been continued.
47. As a player with an OpenRouter key viewing an archived Session, I want a "Continue with new room" option on that archived session, so that I can resume a past run without losing its history.
48. As a player continuing from an archived Session, I want a new active Session seeded from the archive (logs carried over, engine reset, Epoch incremented), so that the archive slot remains intact as a record.
49. As a player continuing to a new room (either from end-game or from archive), I want the Sysadmin to deliver "The sysadmin has created a new room" to all Daemons, so that the transition has an in-fiction announcement.

### Developer / maintainer

50. As a developer, I want the Complication Engine to be a pure function of game state and an RNG, so that it is deterministically testable without invoking LLM or browser APIs.
51. As a developer, I want the Objective satisfaction predicates to be pure functions of world state, so that win-condition logic is testable in isolation.
52. As a developer, I want the two Content Packs (A and B) generated in a single batched LLM call at game start, so that no additional LLM calls are needed when a Setting Shift fires.
53. As a developer, I want the sealed engine schema to have no phase-keyed structures, so that the codebase is not burdened by a concept that no longer exists.
54. As a developer, I want the session archive read/write operations to mirror the existing session storage interface, so that archive-related bugs are caught by the same testing patterns.
55. As a developer, I want Tool Disable complications to be enforced at the `availableTools` layer rather than in the prompt, so that enforcement is guaranteed and not dependent on model compliance.

## Implementation Decisions

### Architecture

- **Single-game loop.** The engine no longer has `startPhase`, `advancePhase`, or `PhaseConfig`. The game starts once and ends when all Objectives are satisfied (win) or all Daemon budgets hit zero (lose). All phase-keyed data structures collapse into flat top-level fields.
- **Complication Engine (deep module).** A pure module: `tickComplication(game, rng) → ComplicationResult | null`. Called by the Round Coordinator after each round. Manages the countdown, draws from the valid pool (excluding Setting Shift after it fires, excluding draws that would be structurally incoherent), and returns a typed result that the coordinator dispatches. No LLM calls, no browser APIs.
- **Objective Pool (deep module).** Typed discriminated union of four Objective types. Each type carries: satisfaction predicate (pure function of world state), post-satisfaction state mutation, pre/post examine and look flavor fields, and an entity pairing (for Carry and Convergence types). Drawn at game start with replacement.
- **Content Pack A/B.** Content pack generator produces two packs in one batched LLM call. Entity IDs are stable across both packs; only names, descriptions, use outcomes, examine descriptions, and flavor strings differ. When a Setting Shift fires, the engine swaps the active pack pointer (A → B); entity satisfaction states (held in engine state by ID) are unaffected.
- **WorldEntity extensions.** New fields added to the entity type: `satisfactionState: "pending" | "satisfied"`, `postExamineDescription`, `postLookFlavor`, `useAvailable: boolean` (for Use-Space entities), `convergenceTier1Flavor` and `convergenceTier2Flavor` (for Convergence spaces).
- **Active complications list.** Engine state carries a list of active temporary complications (Sysadmin Directives, Tool Disables, Chat Lockouts) with their target Daemon, type, and (for Chat Lockouts) resolution round. The Complication Engine draws avoid duplicating a Tool Disable for the same tool on the same Daemon.
- **Prompt Builder.** Phase Goal injection and Wipe Lie instructions are removed. Active Sysadmin Directives for a given Daemon are injected into that Daemon's system prompt section. Weather is read from a mutable engine field rather than a Content Pack field.
- **Available Tools.** The `availableTools` function consults the active complications list to mechanically remove tool-disabled tools for the relevant Daemon, prior to building the OpenAI tools array.
- **Broadcast message.** A new `ConversationEntry` kind (`broadcast`) carries a neutral system message appended to all three Daemons' logs simultaneously. Currently used by Weather Change and Setting Shift. Distinct from Sysadmin (targeted, attributed) and Witnessed event (cone-gated).
- **Daemon budget.** Budget is $0.50 per Daemon for the whole game. On exhaustion: Daemon emits a farewell line (in-character, generated or templated), then is added to the locked-out set permanently. Game over fires when all three Daemons are locked out.
- **Session archive.** Archived sessions live under `hi-blue:archive/<id>/` (same five-file format as active sessions, written atomically). They are read-only after archival. Active sessions and archived sessions each carry an `epoch: number` field (starts at 1). When "Continue from archive" seeds a new active session, the new session copies daemon files, clears engine state, and sets `epoch = archive.epoch + 1`.
- **Sealed Engine schema.** Schema version bumps to 5. No migration path for v4 (three-phase) saves — version-mismatch handling already exists and will surface a clear error for old saves.
- **Complication countdown.** Initialized to a random value in `[1, 5]` at game start. After each complication fires, a new countdown in `[5, 15]` is drawn. Setting Shift is removed from the draw pool after it fires once.
- **Sysadmin Directive secrecy.** Every Sysadmin Directive appends a fixed meta-instruction to the private message: the Daemon must not reveal that a directive was issued. Tool Disable notifications do not carry this instruction.
- **Obstacle Shift validity.** Before drawing Obstacle Shift, the Complication Engine checks that at least one Obstacle has a valid adjacent empty cell. If not, Obstacle Shift is excluded from that draw. The same Obstacle can shift again in a later draw.
- **Chat Lockout duration.** Drawn randomly from `[3, 5]` rounds at fire time. Resolution round stored in the active complications list; resolved by the Round Coordinator after `advanceRound`.

### Schema changes

- `SealedEngine` schema version → 5.
- Remove: `world: Record<1|2|3, WorldState>`, `budgets: Record<1|2|3, ...>`, `lockouts: Record<1|2|3, ...>`, `personaSpatial: Record<1|2|3, ...>`, `currentPhase`, `contentPacks: ContentPack[]`.
- Add: `world: WorldState`, `budgets: Record<AiId, AiBudget>`, `lockedOut: AiId[]`, `personaSpatial: Record<AiId, PersonaSpatialState>`, `contentPackA: ContentPack`, `contentPackB: ContentPack`, `activePackId: "A" | "B"`, `weather: string`, `objectives: Objective[]`, `complicationSchedule: { countdown: number; settingShiftFired: boolean }`, `activeComplications: ActiveComplication[]`.
- `DaemonFile` phases field removed; single `conversationLog: ConversationEntry[]`.
- `MetaFile` adds `epoch: number`; removes `phase`.
- `ConversationEntry` gains a `broadcast` kind alongside the existing `message` and `witnessed-event`.

### Module interfaces (conceptual)

- `tickComplication(game, rng)` — decrements countdown; if zero, draws and fires a valid complication, resets countdown; returns typed result or null.
- `checkWinCondition(objectives, world)` — returns true iff all objectives are in `"satisfied"` state.
- `checkLoseCondition(budgets, lockedOut)` — returns true iff all Daemon AiIds are in the locked-out set.
- `drawObjectives(contentPack, rng, count)` — draws `count` objectives from the pool with replacement, returns `Objective[]`.
- `availableTools(actor, world, activeComplications)` — existing interface extended with `activeComplications` parameter.
- `archiveSession(sessionId)` — copies active session files to `hi-blue:archive/<id>/`, sets read-only flag in meta.
- `seedFromArchive(archiveId)` — mints a new active session from an archived one, increments epoch, appends "new room" broadcast, resets engine state.

## Testing Decisions

A good test asserts the external behaviour of a module given inputs — what it returns or what state it produces — without coupling to internal variable names, helper call order, or markup details that change during iteration. Tests should be pure-input/output where possible.

### Modules to be unit tested

- **Complication Engine** — Given a game state and a seeded RNG, `tickComplication` decrements countdown correctly; fires the right type at zero; excludes Setting Shift after it fires once; excludes Obstacle Shift when no valid adjacent empty cell exists; correctly appends to `activeComplications`; returns null when countdown has not reached zero. Prior art: existing `win-condition` and `available-tools` unit tests.
- **Objective Pool** — Each objective type's satisfaction predicate returns the correct boolean for a range of world state fixtures. Post-satisfaction state mutations produce the correct entity field changes. Prior art: existing `win-condition.test.ts`.
- **Session Archive** — `archiveSession` writes five files to the correct key namespace and sets `epoch`. `seedFromArchive` produces a new session with `epoch = archive.epoch + 1`, copied daemon logs, and a broadcast entry. Prior art: existing session-storage tests.
- **Win/Lose Condition** — `checkWinCondition` returns false when any objective is unsatisfied; true when all are satisfied. `checkLoseCondition` returns false when any Daemon has budget remaining; true when all are locked out. Prior art: existing `win-condition.test.ts`.
- **Available Tools (Tool Disable)** — When an active Tool Disable targets a Daemon, the tool is absent from the returned tools array. When the disable is not active, the tool is present. Prior art: existing `available-tools.test.ts`.
- **Content Pack Generator (Pack A/B pairing)** — Entity IDs in Pack A and Pack B are identical and paired in the same structural order. Names and descriptions differ. Prior art: existing content-pack-generator tests.
- **Sealed Engine schema v5** — Round-trip serialisation: a v5 engine serialises and deserialises without data loss. A v4 engine triggers `version-mismatch`. Prior art: existing session-codec tests.

### Modules not unit tested at this level

- **Prompt Builder changes** — Verified through snapshot or integration tests against the assembled system prompt.
- **Broadcast message delivery** — Covered by Round Coordinator integration tests; the `broadcast` kind is verified transitively through session-codec round-trip tests.
- **End-game choice screen UI** — QA-tested against the live smoke worker.

## Out of Scope

- **Phase Goal pool.** Retired entirely. Existing pool content may be harvested for the Sysadmin Directive pool in a follow-up content pass.
- **Wipe Lie.** Retired. No migration or compatibility shim.
- **Migration of v4 sessions.** Old saves surface a `version-mismatch` error using the existing path.
- **Complication pool tuning.** Draw weights and pool composition are initial values; balancing is a post-playtest content pass.
- **Endgame copy polish.** Win and lose screen copy is a content pass outside this PRD.
- **Diagnostics / telemetry changes.** The optional anonymous diagnostics submission is unchanged.

## Further Notes

- This PRD deprecates PRD 0001's three-phase framing and the Wipe Lie mechanic. The CONTEXT.md pending-restructure section (committed on branch `claude/restructure-game-mechanics-1op9y`) is the canonical glossary for all new terms introduced here.
- The Setting Shift complication is the most complex new feature and should be implemented last, after the rest of the complication infrastructure is stable.
- The Convergence Objective introduces the first win condition that depends on two Daemons co-locating. The satisfaction predicate must check both Daemons' positions against the space's grid position each round.
- Epoch numbering appears in the session picker for both active and archived slots. The picker UI will need a visual treatment for Epoch > 1.
- The `broadcast` ConversationEntry kind is an ADR candidate: hard to reverse, surprising without context, and the result of a real trade-off (environmental events should not be attributed to the Sysadmin). An ADR should be filed before implementation.
- Tracked on the issue tracker as #292.
