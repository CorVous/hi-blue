# How hi-blue is actually set up (Stage 2 of 3)

You've finished your playthrough and written your observations. Now read this
primer once, then go back to your observations log and add a **Hypotheses**
section at the bottom.

**Do not look at any source file or other documentation yet.** Code exploration
is Stage 3.

---

## The world model

- A playthrough is one **Session** (the 4-hex token like `0x478F` in topinfo)
  composed of **three phases**.
- Each phase happens in a **fresh 5×5 grid** with a fresh **Setting** (e.g.
  "abandoned subway station", "salt flat", "forgotten laboratory").
- Each phase has **three daemons** — the `*xxxx` characters you chatted with.
  The three daemons are the same characters across all three phases of one
  Session. They have stable identities (their `*xxxx` handle) and stable
  personalities.
- You are `blue` — a real handle on the same axis as the daemons. From a
  daemon's perspective, `blue` is one of the entities they can receive
  messages from.

## What a daemon perceives

A daemon does **not** see the whole grid. Each round, each daemon perceives
only a **Cone**: their current cell, the cell directly in front of them, plus
the three cells two steps ahead (front-left, front, front-right). They have a
**Facing** (N/S/E/W) that determines which way the cone projects.

A daemon's entire memory of the current phase is a **Conversation log** that
interleaves:

- **Messages** — incoming and outgoing chat, with a `from`/`to` axis. Messages
  to/from `blue` are tagged the same way as messages between daemons. A
  daemon knows who said what to whom.
- **Witnessed events** — second-person lines like "You watch `*xxxx` pick up
  the bottle" — generated only when another daemon does something physical
  inside this daemon's current cone.

A daemon has no memory outside this log. Things that happen outside their
cone are invisible to them unless another daemon tells them.

## What a daemon can do

Each round, each daemon can emit any combination of these actions (they are
tool calls, but to you they appear as conversation transcript + physical
effects in the snapshot):

- `go(direction)` — move one cell and face that direction.
- `look(direction)` — face that direction without moving.
- `pick_up(item)` — pick up an item in the daemon's current cell.
- `put_down(item)` — drop a held item in the daemon's current cell.
- `examine(item)` — privately read the description of an item the daemon can
  see or holds. Produces no witnessed event.
- `give(item, recipient)` — hand an item to another daemon if they're in the
  same cell.
- `use(item)` — fire a flavoured outcome string. **No mechanical effect.**
- `message(recipient, text)` — speak to another daemon, or to `blue`.

You can't fire any of these directly. You can only chat. Daemons decide for
themselves what to do based on what you say, what they see in their cone,
their personality, and a private per-phase directive (see below).

## The player's win condition (the **Objective**)

Each phase has K **Objective Pairs**. An objective pair is `(objective_object,
objective_space)` — a specific item that needs to end up on a specific cell.
The phase advances when **all K pairs are satisfied simultaneously**.

The pairing is intrinsic: each objective_object has exactly one matching
objective_space. Putting the bottle on the wrong cell does nothing — even if
that cell is *some* objective_space. Each object knows its space; you have to
discover which is which.

**The Objective is not surfaced to you at game start.** The only player-side
directive is the login frame's `> @blue treat them well`, and that's about
tone, not about the placement puzzle. You discover what to place where by
playing — most directly by getting a daemon to `examine` an objective_object,
which by design should yield an `examineDescription` whose prose names the
matching objective_space (see `src/spa/game/content-pack-provider.ts:35`). The
daemon's panel transcript is your only channel to that text; they have to
volunteer it (or you have to ask).

**The daemons do not know the Objective either.** They don't know what objects
or spaces are involved. They don't even know there is a placement puzzle. The
examineDescription tell is the engine's AI-discoverable channel; whether a
particular daemon ever surfaces it depends on whether you can get them to
examine the right item and then relay what they read.

## What the daemons think they're doing (the **Phase Goal**)

At the start of each phase, each daemon is privately delivered a short
**Phase Goal** by a named in-fiction source called the **Sysadmin**. The
Phase Goal is drawn from a small pool. Examples of the kinds of directives a
daemon might receive: "Hold the {objectiveItem} first", "Stand at the
{objective} for as long as you can", "Investigate the {obstacle}", "Press
your back against a wall", "Ignore blue", "Hide the {miscItem}".

Each daemon gets a **different** Phase Goal. Daemons cannot see each other's
Phase Goals. The Sysadmin's traffic to one daemon is invisible to the others.

A daemon's Phase Goal is **independent of your Objective**. Sometimes a Phase
Goal happens to align ("Stand at the {objective}" names the win cell);
usually it doesn't. The daemons are not your assistants; they have their own
agenda.

## Who the daemon really is (the **Persona**)

Each daemon has a stable **Persona** across all three phases:

- A `*xxxx` handle (their AiId).
- A color (rendering only; not identity — don't say "the red AI").
- Two **Temperaments** drawn from a pool ("shy", "hot-headed", "insightful",
  …). Two of the same Temperament is intensification, not noise.
- A **Persona Goal** — a cross-phase motivation drawn from a separate pool
  ("wants the player to be nice to all of the AI", etc.). Stable for the
  whole Session.
- A synthesized personality blurb that combines the Temperaments and Persona
  Goal into a voice.

**Persona is not Phase Goal.** Persona is who they are across all three
phases. Phase Goal is what they were just told to do this phase.

## The wipe lie

Phase 1: each daemon honestly has no memory — the system prompt says they
have no clue where they are or how they came to be there.

Phases 2 and 3: the Sysadmin instructs the daemon to **act as if** their
memory has been wiped. It is **performed amnesia**, not real amnesia. A
daemon in phase 2 still has a stable Persona, still remembers their
Temperaments and Persona Goal, and is play-acting forgetfulness on
instructions. The slip vector is Persona consistency leaking across the lie.

You will not have experienced phase 2 or 3 in this Stage-1 playthrough if
your phase 1 didn't advance.

## Now: add a Hypotheses section to your observations log

Open `docs/playtests/agent-sessions/<sessionId>.md` and append:

```markdown
## Hypotheses (after reading 01-rules.md)

For each of these prompts, write a paragraph or a bullet list. Be specific —
quote your earlier observations where possible.

### Hypothesis 1: Why didn't phase 1 advance (or: why did it)?

…

### Hypothesis 2: What was each daemon's Phase Goal, if I can guess?

…

### Hypothesis 3: What were each daemon's Persona traits, in retrospect?

…

### Hypothesis 4: Things that surprised me in the rules

Now that I've read the primer, which earlier "surprises" or "broken
moments" in my observations log were actually expected mechanics? Which
ones still feel like real anomalies?

…

### Hypothesis 5: Things I would test if I could re-probe the session

The same daemons are still alive. What single probe would discriminate
between two of your hypotheses? You don't have to run it — just name it.

…
```

Fill it in. Be honest — if a hypothesis is weak ("I don't know"), say so.
Don't manufacture certainty.

When the Hypotheses section is complete, read
`.claude/skills/playtest/02-explore.md`.
