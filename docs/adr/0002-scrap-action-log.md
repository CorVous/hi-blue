# Scrap the broadcast action log; per-AI Witnessed events replace it

The shared **action log** broadcast to player + all three AIs is removed. Each AI now learns about other AIs' actions only through their own **Cone**: cone-visible events render as **Witnessed event** lines inside the **Conversation log**, interleaved chronologically with voice-chat and whispers. Tool calls that would be mechanically impossible (out-of-bounds movement, picking up an item not in the AI's cell, etc.) are filtered out of the per-turn tool list rather than being attempted-and-rejected — there is no "failed call" channel anymore.

## Status

Accepted. Supersedes [PRD 0001](../prd/0001-game-concept.md) User Stories 8, 9, 10 and the World Model "Action log broadcasts to everyone … Failures are public" decision.

## Considered Options

- **(a) Full hide of impossible tools + scrap action log entirely** — chosen.
- **(b) Scoped hide** — keep failures public for *interpersonally meaningful* attempts (e.g. give to non-adjacent AI), filter only mechanical-physics failures. Rejected because the broader action log itself was unwanted; hiding only some failures left the half of the log nobody wanted.
- **(c) Keep the action log untouched.** Rejected: cheap-model floundering produces noise that drowns the signal.

## Consequences

- The PRD's "probing-via-failed-tool-calls" mechanic is gone. AI scheming is now read by the player only through chat and whisper *content* (and through the AI's account of what it *witnessed*).
- The unreliable-narrator dynamic *strengthens*: different AIs witness different fragments of the same events from their own cones, and may report them differently or selectively.
- `PhaseState.actionLog`, `ActionLogEntry`, `appendActionLog` (in `src/spa/game/dispatcher.ts` and the engine) all delete. The per-turn tool list becomes a function `availableTools(game, aiId)` returning the OpenAI tool definitions filtered to currently-legal calls (with restricted `direction` / `item` / `to` enums).
- The dispatcher's validator logic is largely retained as a defence-in-depth check, but in normal operation no calls reach it as failures.
