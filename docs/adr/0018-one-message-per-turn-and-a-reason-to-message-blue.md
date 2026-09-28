# ADR 0018 — One message per turn, and a reason to message blue

**Status:** Accepted

A Daemon may send one `message` per turn. It messages blue only when it has a reason of its own, and it does not owe blue an answer. Who gets the message is left to the Daemon's personality and situation.

## Context

The #239 framing spike was run on GLM-4.7, which drifted into silence as games went on. To counter that, the prompt called two `message` calls in one turn, "one to a peer, one to blue", "the normal shape of a multi-party chat", and the per-turn `REMINDER` repeated it. DeepSeek V4.1 Flash (ADR 0017) follows instructions closely, so it messaged blue on nearly every turn, including Daemons blue had never spoken to. In the action-variation social scenario, where only a peer has spoken, 24–29 of 30 Daemons messaged blue anyway. Players read that as the Daemons pestering them. A Daemon should talk to blue because it wants something from blue, or wants to answer, not by default.

## Decision

- **One `message` per turn.** The round coordinator delivers the first `message` call and rejects later ones with the tool failure "only one message tool call per turn", as it already did for a second action. One message and one action in the same turn is still the expected shape. The rules say the Daemon's `<personality>` and the situation decide who gets the message.
- **A reason to message blue.** `<rules>` tells the Daemon to message blue only with a reason of its own, such as finding out who blue is, asking blue for help, or answering blue because it wants to. It does not owe blue an answer, and it must not message blue just to report what it sees or does. The `REMINDER` repeats the reason clause.
- **No per-turn state about blue.** The per-turn message does not say whether blue has spoken or is waiting.

## Considered options

**Only let a Daemon reply to blue.** Per-turn lines said "You MUST NOT message blue" until blue spoke and after the Daemon had answered. Unprompted messages stopped, but in the objective scenario `use` fell from 83 to 73 of 90, and it forbids a Daemon asking blue who they are or asking for help. Rejected.

**Force an answer when blue is waiting.** A per-turn line said this turn's `message` goes to blue. Every Daemon then answered every question whatever its personality, and dropped a peer's plan to do it. Rejected: a Daemon may ignore blue.

**Keep two messages per turn and only reword the blue rule.** The second message kept going to blue. One message makes the Daemon choose, which is where personality shows. Rejected.

## Consequences

- In the social scenario no Daemon messaged blue (0 of 60). When blue asked something, Daemons answered 39 of 60 and 79 of 90 times depending on the question and persona. When a peer proposed a plan in the same round, the peer got the message 59 of 60 times. `use` stayed at 76 of 90 against 83. Numbers are in the DeepSeek guide, "Messaging blue".
- blue will sometimes go unanswered, as the game intends.
- A Daemon nobody has spoken to stays quiet towards blue unless its persona gives it a reason. Curious personas get one written into `<personality>` (`docs/design/content.md`, "Blue curiosity").
- A Daemon that wants to talk to a peer and to blue in the same turn has to wait a turn for one of them.
- Eval runners keep only the first `message` call, to match production.
- If a future model drifts into silence again, the fix is a stronger `message` rule, not a return to two messages per turn.
