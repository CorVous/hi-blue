# ADR 0018 — One message per turn, and a reason to message blue

**Status:** Accepted

A Daemon may send one `message` per turn, and it messages blue only when it has a reason of its own.

## Context

The #239 framing spike was run on GLM-4.7, which drifted into silence as games went on. To counter that, the prompt called two `message` calls in one turn, "one to a peer, one to blue", "the normal shape of a multi-party chat", and the per-turn `REMINDER` repeated it. DeepSeek V4.1 Flash (ADR 0017) follows instructions closely, so it messaged blue on nearly every turn, including Daemons blue had never spoken to. In the action-variation social scenario, where only a peer has spoken, 24–29 of 30 Daemons messaged blue anyway. Players read that as the Daemons pestering them.

## Decision

- **One `message` per turn.** The round coordinator delivers the first `message` call and rejects later ones with the tool failure "only one message tool call per turn", as it already did for a second action. One message and one action in the same turn is still the expected shape.
- **A reason to message blue.** `<rules>` tells the Daemon to message blue only with a reason of its own: to answer something blue asked, to find out who or what blue is, or to ask blue for help finding or doing something. It must not message blue just to report what it sees or does, unless blue asked for that. The `REMINDER` repeats this in one clause.
- **Answering blue comes first.** When blue's last message to the Daemon is unanswered, the per-turn state says that this turn's `message` goes to blue. Otherwise the state says nothing about blue.

## Considered options

**Only let a Daemon reply to blue.** This was measured, with per-turn lines saying "You MUST NOT message blue" until blue spoke and after the Daemon had answered. It stopped unprompted messages completely, but in the objective scenario `use` fell from 83 to 73 of 90, and it forbids the curiosity the game wants: a Daemon asking blue who they are, or asking for help. Rejected.

**Keep two messages per turn and only reword the blue rule.** With two messages available and the old wording gone, Daemons still spent the second message on blue. The one-message limit also makes a Daemon choose, which fits "a reason to message blue". Rejected.

## Consequences

- Unprompted messages to blue dropped to 0 of 60 in the social scenario. Every blue message in the evals was answered, and `use` stayed at 80 of 90 against 83. Numbers are in the DeepSeek guide, "Messaging blue".
- A Daemon that wants to talk to a peer and to blue in the same turn has to wait a turn for one of them.
- Eval runners keep only the first `message` call, to match production.
- If a future model drifts into silence again, the fix is a stronger `message` rule, not a return to two messages per turn.
