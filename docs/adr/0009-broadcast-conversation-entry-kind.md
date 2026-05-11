# ADR 0009 — Add a `broadcast` kind to ConversationEntry for environmental events

**Status:** Accepted

Environmental events that affect the whole room — Weather Change and Setting Shift complications — need to be appended to all three Daemons' conversation logs simultaneously. The natural alternative would be to have the Sysadmin send a targeted `message` to each Daemon in turn; but the Sysadmin is the named source of directive authority (Phase Goals, Tool Disable notifications, Sysadmin Directives). Routing environmental facts through the Sysadmin channel blurs that identity: a Daemon reading its log cannot tell whether a Sysadmin entry is an instruction it must follow or a world observation it can ignore. The Sysadmin's authority depends on its entries being unambiguously directive.

## Decision

Introduce a third `ConversationEntry` kind — `broadcast` — that carries a neutral system message with no `from` field. A broadcast entry is appended to all three Daemons' logs in a single logical write. It renders in the conversation log as a voice that belongs to neither the Sysadmin nor any Daemon: environmental narration, not command.

`SESSION_SCHEMA_VERSION` bumps from 4 to 5 at this boundary (alongside the broader single-game restructure in PRD 0005).

## Considered Options

**(a) `broadcast` kind with no sender** — chosen. Semantically honest: weather and setting shifts are world events, not directives. The log's three-way source taxonomy — `Sysadmin` (instructions), `*xxxx / blue` (messages), `broadcast` (environment) — is now closed and unambiguous.

**(b) Sysadmin sends targeted messages to all Daemons** — rejected. Reuses the Sysadmin channel for non-directive content, weakening its authority signal. A Daemon that has learned "Sysadmin messages = things I must act on" will misread weather updates as instructions.

**(c) Witnessed event** — rejected. Witnessed events are cone-gated (only Daemons who could physically observe the event receive them). Weather changes and Setting Shifts are global facts; modeling them as Witnessed events would require either faking the cone check or adding a "broadcast witnessed event" special case — the same problem one level down.

## Consequences

- `ConversationEntry` is now a three-way discriminated union: `message | witnessed-event | broadcast`. Any code that exhaustively switches on the kind must add the `broadcast` branch.
- The session codec (`session-codec.ts`) must serialise and deserialise `broadcast` entries; v5 round-trip tests cover this.
- `broadcast` composes cleanly with ADR 0007's unified message primitive: the routing axis (`from`, `to`) only exists on `message` entries. `broadcast` has neither, which is its defining property — it represents the world speaking, not a participant.
