# ADR 0007 — Retire the Voice; unify the directional message primitive

**Status:** Accepted (post-hoc; documents shipped commits c60e995 / #213 and 1866636 / #218)

## Context

Before commit c60e995, the game's communication model rested on three interlocking concepts:

- **chat** — broadcast messages from the player or another AI, routed to all Daemons.
- **whisper** — directed messages between two Daemons, stored in a flat global `whispers[]` array shared across all parties.
- **The Voice** — a deliberately opaque label for the source of Phase Goal directives. By design, "the Voice" meant both the Sysadmin-style authority that hands each Daemon its goal *and* the player's chat. The AI could never tell which source was speaking. CONTEXT.md described this as "productive ambiguity."

The productive-ambiguity framing was a coherent early design choice, but it created three concrete problems:

1. **Parallel code paths with semantic drift.** `chat` and `whisper` are the same physical act at different scopes; diverging types force every writer and reader to branch on a distinction that carries no real information the unified recipient axis couldn't carry.

2. **Voice as the player's identity collapses routing.** When the player sends a message, it arrives as Voice traffic — indistinguishable from a Phase Goal. There is no stable axis on which a Daemon can say "this came from the player." Any prompt language that tries to reference the player specifically has to invent fiction that may contradict other prompt fiction.

3. **Per-Daemon logs (ADR 0006) need a clean shape.** ADR 0006 moved Daemon conversation logs from global arrays to per-Daemon ownership. The natural shape for that store is a single entry kind with a recipient axis. Keeping `chat`/`whisper` as two types adds write-time branching for no payoff.

Commit c60e995 (issue #213) collapsed `chat` and `whisper` into a single directional `message` primitive and bumped `SESSION_SCHEMA_VERSION` from 3 to 4. Commit 1866636 (issue #218) renamed the test-fixture `AiId` previously called `blue` to `cyan`, freeing the handle `blue` for the player. This ADR documents the combined rationale and brings CONTEXT.md into alignment.

## Decision

Four sub-decisions:

**1. Collapse `chat`/`whisper` into a single `message` primitive.**

A `ConversationEntry` of kind `message` carries a `(from, to, content)` triple where `to` is an `AiId` or the literal string `"blue"`. The recipient axis encodes routing completely. There is no longer a semantic distinction between "broadcast" and "directed" messages — a message addressed to `"blue"` is player-facing, a message addressed to `*xxxx` is peer-to-peer. `SESSION_SCHEMA_VERSION` was bumped 3 → 4 at this boundary.

**2. Give the player a real handle: `blue`.**

`blue` is the player's lowercase chat-channel handle as it appears to Daemons. It is a real entry on the same routing axis as `*xxxx` AiIds, not a special-cased `"player"` sentinel or an invisible source. This makes per-Daemon logs self-explanatory: every message line carries a readable sender and recipient. The old `"voice is silent"` anchor special case — needed because the Voice had no stable handle — is eliminated. Player-facing UI does not change; `blue` exists only in the Daemons' world.

The test-fixture AiId formerly named `blue` was renamed to `cyan` in #218 specifically to free this handle. PRD-historical references to `AI-Blue` in `docs/prd/0001-game-concept.md` are intentionally untouched; they describe a specific AI persona, not the player handle.

**3. Peer-to-peer messages stay silent in the player UI — no placeholders.**

When two Daemons exchange messages, that traffic does not surface in the player's terminal. The alternative of rendering a redacted placeholder (`[*xxxx sent a message to *yyyy]`) was considered and rejected: a placeholder tells the player a message exists while withholding content. That is anti-information — it confirms a channel the player cannot read without letting them act on it. Silence composes cleanly with ADR 0005's engine-state opacity (the curious player who digs into the Daemon `.txt` files already has the unredacted record) and with ADR 0006's asymmetric-tampering vector (only one Daemon's log needs editing to engineer a divergence).

**4. Replace the Voice with the Sysadmin as the named Phase Goal source.**

The Sysadmin is the in-fiction name for the authority that delivers Phase Goal directives. Each Phase Goal arrives as a Sysadmin message addressed exclusively to the receiving Daemon. Daemons never see another Daemon's Phase Goal or Sysadmin traffic. This kills the player-as-Voice conflation: the player is `blue` and the Phase Goal source is the Sysadmin — two distinct, named, unambiguous sources on the same routing axis. A Daemon reading its conversation log can always tell where a message originated.

## Considered Options

**(a) Unify primitive, name Sysadmin, give player a `blue` handle** — chosen. See Decision above.

**(b) Keep `chat`/`whisper` split, rename the Voice** — rejected. Naming the Sysadmin without unifying the message types still leaves parallel write paths and a branchy type in `ConversationEntry`. The routing problem (two entry kinds for what is semantically one act at different scopes) persists. The ADR 0006 per-Daemon log shape also fits the unified type more naturally.

**(c) Unify the primitive but keep the Voice framing** — rejected. Without a real player handle, the unified `message` type requires a synthetic sender sentinel for player messages — effectively re-introducing the ambiguity under a different name. Any prompt language that distinguishes "what the player said" from "what the Sysadmin said" still has to invent fiction to cover the gap.

**(d) Render redacted peer-to-peer placeholders in the player UI** — rejected. A placeholder is anti-information: it reveals that a channel exists while withholding its content, giving the player something to be frustrated by without giving them anything to act on. The curious player who reads Daemon `.txt` files already sees the unredacted content. Silence is the honest choice.

## Consequences

- **CONTEXT.md** is updated in this slice (issue #216): the `### The Voice` section is replaced by `### Communication and identity` containing the **Sysadmin** and **blue** entries; the **Wipe lie**, **Conversation log**, and **ConversationEntry** entries are rewritten; the **Relationships** bullet referencing the Voice is replaced; the **Flagged ambiguities** "Player" bullet is updated.
- **PRD-historical `AI-Blue`** reference in `docs/prd/0001-game-concept.md` is intentionally left untouched — it describes a specific AI persona in early concept art, not the player handle, and is out of scope.
- **`voiceExamples` field** on Persona, the `<voice_examples>` prompt block, and character speech-style few-shots use "voice" in the literary sense (a character's distinctive register). They are unrelated to the retired Voice framing and stay.
- **Composes with ADR 0005** (engine.dat sealed): peer-to-peer message content lives only in per-Daemon logs and sealed engine state. Silence in the player UI does not weaken the curious-player escape hatch — the `.txt` files still expose everything.
- **Composes with ADR 0006** (per-Daemon conversation logs): the unified `message` kind is the natural shape for per-Daemon ownership. A single recipient axis means every writer knows exactly which Daemon logs to append into. The asymmetric-tampering vector ADR 0006 introduced as a feature applies uniformly to all message kinds under the unified type.
