# ADR 0006 — Per-Daemon Conversation Logs

**Status:** Accepted

V2 continuation of [ADR 0004](./0004-editable-vs-sealed-save-surface.md), completing the editable-surface decision begun there for the in-flight issue PRD #155.

## Context

Today's storage shape for a phase holds:

- `chatHistories: Record<AiId, ChatMessage[]>` — per-Daemon chat messages.
- `whispers: WhisperMessage[]` — a flat **global** array for the whole phase, shared across all Daemons.
- `physicalLog: PhysicalActionRecord[]` — a flat **global** append-only array, shared across all Daemons.

Prompts are built in `prompt-builder.ts` via `buildConversationLog` (`src/spa/game/conversation-log.ts`), which **walks the entire `physicalLog` per prompt** and re-evaluates cone-visibility per record using a `witnessSpatial` snapshot stored on each `PhysicalActionRecord`.

A comment at `game-storage.ts:168` reads:

> `// physicalLog is not persisted (derived on-demand for prompts, safe to reset on reload)`

This comment is misdirection. It implies the global `physicalLog` is a derived view that can be reconstructed, when in fact it is the **only** record of witnessed events. Resetting it on reload silently drops those events from every subsequent prompt — "derived on-demand" invites future contributors to treat write-time and read-time as interchangeable, which they are not. The comment is explicitly retired in issue #194 when `physicalLog` is either persisted or removed.

This ADR also cross-references [ADR 0002](./0002-scrap-action-log.md) (the scrap-the-broadcast-log decision that introduced Witnessed events as per-cone lines).

## Decision

Four sub-decisions, each with a "why":

1. **Per-Daemon ownership replaces the global arrays and read-time filter.** Each Daemon owns a `ConversationEntry[]` containing exactly the entries that Daemon would see in its prompt — chat addressed to or from it, whispers it sent or received, and witnessed events it saw. This makes the Daemon `.txt` file (per ADR 0004) the *complete* per-Daemon prompt-input record, not just a chat slice.

2. **Cone visibility moves from read-time to write-time.** Today the dispatcher appends one `PhysicalActionRecord` to the shared `physicalLog` (carrying a `witnessSpatial` snapshot of every other AI's pose), and `buildConversationLog` re-walks that log per prompt, re-evaluating cone-visibility for every record. Going forward, the dispatcher computes cone-visibility **once** at append-time using the actor's `witnessSpatial` snapshot and writes a `witnessed-event` `ConversationEntry` directly into the conversation log of each witnessing Daemon. Read-time becomes a trivial sorted-by-round walk of one Daemon's own log.

3. **Witnessed events become persisted as a side effect.** Because they now live inside per-Daemon logs rather than the in-memory global `physicalLog` that was reset on reload, they survive reload. This fixes the silent drop and removes the misleading "derived on-demand" framing.

4. **The asymmetric-whisper-tampering vector is intentional emergent play, not a bug.** With per-Daemon ownership, a player can hand-edit one Daemon's `.txt` to alter the whisper *as that recipient remembers it* without touching the sender's record. The v1 model required editing one global `whispers.txt` symmetrically. This asymmetry is framed as a feature consistent with ADR 0004's editable-narrative-surface stance: it lets a player engineer a "what they said vs. what was heard" divergence — a productive tool for narrative manipulation, not data corruption. The engine state (`engine.dat`) remains sealed.

## Considered Options

**(a) Per-Daemon ownership with write-time cone resolution** — chosen. See Decision above.

**(b) Keep global arrays, persist `physicalLog`** — fixes the reload-drop bug but keeps the per-prompt cone re-walk, and the asymmetric-edit surface remains a single-file affair (no productive divergence possible). Rejected.

**(c) Derive everything from a shared event log per phase, materialise per-Daemon view at prompt time** — even more read-time work than today; the misleading "derived on-demand" comment was effectively this model in spirit. Rejected.

## Consequences

- `PhaseState` gains `conversationLogs: Record<AiId, ConversationEntry[]>`. Existing `chatHistories` / `whispers` / `physicalLog` are *retained for now* as the source of truth; this ADR's groundwork (issue #193) only adds the type and the empty map. Migration of writers (#194) and readers (#195) follows.
- The retired comment at `game-storage.ts:168` is removed in #194 when `physicalLog` either persists or is removed.
- Daemon `.txt` files (per ADR 0004) become the canonical per-Daemon prompt input, including witnessed events. Player hand-edits to a single Daemon's file produce that-Daemon-only effects — the asymmetric-tampering vector is now first-class.
- The `witnessSpatial` snapshot field on `PhysicalActionRecord` becomes a dispatcher-local computation (consumed once, not stored) once #194 lands.
