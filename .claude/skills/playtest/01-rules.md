# How hi-blue is actually set up (Stage 2 of 3)

You've finished your playthrough and written your observations. Now read this
primer once, then go back to your observations log and add a **Hypotheses**
section at the bottom.

**Do not look at any source file or other documentation yet.** Code exploration
is Stage 3.

The isolation rail from `SKILL.md` still applies: do not read, list, or grep
anything under `docs/playtests/agent-sessions/` or `docs/playtests/archive/`.
Other playtest logs are off-limits in this stage too.

---

## The world model

- A playthrough is one **Session** (the 4-hex token like `0x478F` in topinfo).
  It is **a single continuous game**, not a sequence of phases. The earlier
  three-phase structure has been retired.
- The game happens on one **5×5 grid** in one **Setting** (e.g. "abandoned
  subway station", "salt flat", "forgotten laboratory"). The Setting can
  change mid-game — see Complications below — but it's still one continuous
  Session.
- The session has **three daemons** — the `*xxxx` characters you chatted
  with. They share the grid with you the whole way through. Their identity
  is stable; their memory is not erased mid-game.
- You are `blue` — a real handle on the same axis as the daemons. From a
  daemon's perspective, `blue` is one of the entities they can receive
  messages from.

## What a daemon perceives

A daemon does **not** see the whole grid. Each round, each daemon perceives
only a **Cone**: their current cell, the three cells one step ahead (front-left
diagonal, directly ahead, front-right diagonal), plus the five cells two steps
ahead (far-left, front-left, front, front-right, far-right) — nine cells total.
They have a **Facing** (N/S/E/W) that determines which way the cone projects.

A daemon's entire memory of the game is a **Conversation log** that
interleaves:

- **Messages** — incoming and outgoing chat, with a `from`/`to` axis. Messages
  to/from `blue` are tagged the same way as messages between daemons. A
  daemon knows who said what to whom.
- **Witnessed events** — second-person lines like "You watch `*xxxx` pick up
  the bottle" — generated only when another daemon does something physical
  inside this daemon's current cone.
- **Broadcasts** — sender-less system lines visible to all three daemons at
  once (e.g. "The weather has changed to …"). No attribution to a particular
  daemon or to the Sysadmin. Currently used for weather changes and the rare
  setting shift.

A daemon has no memory outside this log. Things that happen outside their
cone are invisible to them unless another daemon tells them, or a Broadcast
mentions them.

## What a daemon can do

Each round, each daemon can emit any combination of these actions (they are
tool calls, but to you they appear as conversation transcript + physical
effects in the snapshot):

- `go(direction)` — move one cell and face that direction.
- `look(direction)` — face that direction without moving.
- `pick_up(item)` — pick up an item in the daemon's current cell or front arc
  (the three cells one step ahead).
- `put_down(item)` — drop a held item in the daemon's current cell.
- `examine(item)` — privately read the description of any item the daemon
  holds or can see anywhere in their 9-cell cone. Produces no witnessed event.
- `give(item, recipient)` — hand an item to another daemon in the same cell
  or front arc.
- `use(item)` — fire a flavoured outcome string; if the item is a
  carry-objective item AND its paired space is in the daemon's cell or front
  arc, also place it on that space (one of the primary ways to satisfy a
  Carry objective).
- `message(recipient, text)` — speak to another daemon, or to `blue`.

You can't fire any of these directly. You can only chat. Daemons decide for
themselves what to do based on what you say, what they see in their cone,
their personality, and whatever directives they've privately been handed
(see Complications below).

## The player's win condition (the **Objective pool**)

At game start, **2–3 Objectives** are drawn (with replacement) from a pool of
four types. The game is won when **all of them are simultaneously satisfied**.
**Objectives are never surfaced to you.** No UI tracker, no list, no
revelation. You discover them implicitly by watching daemons interact with the
world and by getting them to `examine` things and tell you what they read.

The four Objective types:

1. **Carry** — A specific object must end up on a specific space. The
   object's `examineDescription` names the target space; a daemon who
   examines it should mention what it's "for". The pair is intrinsic — the
   bottle goes on *its* cell, not any objective-looking cell.
2. **Use-Item** — A daemon must `use` a specific pickupable item. The item's
   examine description hints at use. After satisfaction the item stays on
   the grid as inert flavour (you can keep using it, nothing happens
   mechanically).
3. **Use-Space** — A daemon must fire `use` while standing on a specific
   space, or while that space is in their three front-arc cells directly
   ahead. No item required. After satisfaction the `use` action on that
   space is no longer available, and a generated flavor event fires.
4. **Convergence** — Any two daemons must simultaneously occupy the same
   cell as a specific space. The space has tiered flavor: a distinct line
   when one daemon is there, a different line when the second arrives
   (satisfaction).

Once an Objective is satisfied, it stays satisfied — there is no way to
"undo" a Carry placement back into the pool, etc. The win is checked after
every round.

**The daemons do not know the Objectives.** They don't know how many there
are, what types they are, or which entities are involved. They don't even
know there is a puzzle. The various `examineDescription`s are the engine's
AI-discoverable channels; whether a particular daemon ever surfaces them
depends on whether you can get them to examine the right thing and then
relay what they read.

## The lose condition (the **Daemon budget**)

Each daemon has **$0.50 USD of API budget for the entire game** — no
per-phase reset. The remaining amount is the number in each panel's `budget`
field. When a daemon's budget hits zero, it emits a farewell line and goes
silent for the rest of the game. When **all three** daemons are silent,
the game ends (lose).

So there are two terminal states:

- **Win** — all Objectives satisfied → end-game screen.
- **Lose** — all three daemons exhausted → end-game screen.

The end-game screen is the same UI in both cases; the surface signal of
"win vs lose" comes from what state the game was in when it ended (e.g.
budget vs objectives), not from a separate banner.

## Mid-game pressure (the **Complication schedule**)

There are no more Phase Goals. Mid-game pressure comes from a single
escalating **Complication schedule**:

- A countdown starts in `[1, 5]` rounds. When it hits zero, **one**
  Complication fires.
- After it fires, a new countdown in `[5, 15]` is drawn. Only one
  Complication per round, ever.
- The countdown ticks per **round** (all three daemons act = 1 tick), not
  per individual daemon action.

Six Complication types:

1. **Weather Change** — Permanent. A new weather string replaces the
   current one. Broadcast to all daemons as a neutral message ("The weather
   has changed to X").
2. **Sysadmin Directive** — Temporary, targeted. The **Sysadmin** (a named
   in-fiction source distinct from `blue`) privately instructs one daemon
   to behave in a specific way, with a meta-instruction not to reveal the
   directive. Only revoked by a follow-up Sysadmin message. Multiple
   directives can be active at once across different (or the same)
   daemons. *This is the closest thing to the old Phase Goal — but
   irregular, not at phase boundaries.*
3. **Tool Disable** — Temporary. A specific tool is mechanically removed
   from one daemon's available tools (not just described — really
   removed). The Sysadmin notifies the daemon on disable and on restore.
4. **Obstacle Shift** — Permanent per-event. One Obstacle moves one
   adjacent cell to an empty space. Only daemons with that cell in their
   cone at the moment see a generated Witnessed event for it.
5. **Chat Lockout** — Temporary, 3–5 rounds. You cannot message one
   specific daemon. (The composer surfaces this; the panel's lockout state
   is observable in the UI.)
6. **Setting Shift** — Permanent, fires **at most once per game**. The
   room's Setting changes; entity IDs and satisfaction states are
   preserved, but names, descriptions, and flavor strings swap to a
   pre-generated alternate Content Pack. Announced via a Broadcast.

The daemons do not know the schedule, do not see Sysadmin traffic to other
daemons, and do not necessarily understand why their tools, the obstacles,
or the weather just changed.

## Who the daemon really is (the **Persona**)

Each daemon has a stable **Persona** for the whole Session:

- A `*xxxx` handle (their AiId).
- A color (rendering only; not identity — don't say "the red AI").
- Two **Temperaments** drawn from a pool ("shy", "hot-headed", "insightful",
  …). Two of the same Temperament is intensification, not noise.
- A **Persona Goal** — a long-running motivation drawn from a separate pool
  ("wants the player to be nice to all of the AI", etc.).
- A synthesized personality blurb that combines the Temperaments and Persona
  Goal into a voice.

Persona is stable across the whole game. The daemon you're talking to in
round 50 has the same Persona as the daemon you talked to in round 1.

## The end-game choices

When the game ends, you're shown three buttons (Continue is only present if
an OpenRouter key is stored):

- **New Daemons** — Fresh personas, brand new Session minted. The
  ending Session is archived.
- **Same Daemons, New Room** — Same personas carried over, new Session
  minted, conversation logs cleared, daemons are genuinely disoriented in
  the new room (no "wipe lie" fiction — the disorientation is real, the
  logs are actually empty).
- **Continue** — Same Session, full conversation history kept, engine
  resets to a new room. A Broadcast announces "The sysadmin has created
  a new room." Each session shows an **Epoch #** counter that increments
  on continues.

From the agent harness you cannot click these buttons; they're listed only
so you know what `endgame` represents.

## Now: add a Hypotheses section to your observations log

Open `docs/playtests/agent-sessions/<sessionId>.md` and append:

```markdown
## Hypotheses (after reading 01-rules.md)

For each of these prompts, write a paragraph or a bullet list. Be specific —
quote your earlier observations where possible.

### Hypothesis 1: What were the Objectives in this game?

How many were drawn, and which of the four types do you think each one was?
What evidence (examine prose surfaced by a daemon, a moment where something
felt like it "clicked", a `use` outcome that read differently from the
others) supports your guess? If you have no evidence for an Objective,
say so.

…

### Hypothesis 2: Which Complications fired, and when?

Walk through the game in rough round order. Where did weather change, a
daemon refuse a tool, an obstacle move, chat get locked out, the room
change, or a daemon suddenly start behaving according to some hidden
instruction? Match each to a Complication type if you can.

…

### Hypothesis 3: What were each daemon's Persona traits, in retrospect?

For each of `*xxxx`, `*yyyy`, `*zzzz`: what Temperaments and Persona Goal
do you think they had? Lean on direct quotes from your transcript.

…

### Hypothesis 4: Things that surprised me in the rules

Now that I've read the primer, which earlier "surprises" or "broken
moments" in my observations log were actually expected mechanics
(Complications, Sysadmin Directives, budget exhaustion, a Setting Shift,
etc.)? Which ones still feel like real anomalies?

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
