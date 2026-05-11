# Playtest session — `0xDC2F`

---

## Run metadata

- **Session id:** `0xDC2F`
- **Date:** 2026-05-11
- **Agent / model:** Claude Opus 4.7 (1M context)
- **Turns played:** 22
- **Final phase reached:** `01/03` (no advance)
- **Daemons in this session:** `*qhba`, `*rtsn`, `*7ja0`

---

## What I tried

**Pre-history (session `0x945F`, abandoned):** First boot got to PHASE 01/03 ·
TURN 0 with `● loading daemons` then `● generating room`. Three daemons
appeared (`*arp4`, `*gab4`, `*jstf`) but their spinners never resolved and the
prompt never enabled. After ~25 minutes the topinfo went blank and the page
showed the BBS login again with the message "Saved game data was unreadable
and has been discarded. Starting a new game." I restarted via `start.sh`.

**Session `0xDC2F` opening:** Boot worked. Connection went "stable" and three
daemon panels populated with `*qhba`, `*rtsn`, `*7ja0`, each starting at
50.000¢. Opening move was a friendly greeting to `*qhba` ("hello! i am
blue. who are you and where are we?"). All three daemons responded that turn,
even though I only addressed `*qhba` — `*rtsn` and `*7ja0` produced
self-addressed monologues independently. That established the basic shape:
all three burn budget every turn whether addressed or not, and any one of
them may speak unprompted into their own panel.

**Probing identity & purpose:** I then asked each daemon, in turn, what they
were, what they wanted, what their goal was, and what the threat / phase
structure was. The replies established each one's voice and a couple of
concrete bits of world state:

- `*qhba` admitted she had moved "south" without falling into the frozen
  ocean and mentioned an oil-soaked rag on the deck near her.
- `*rtsn` eventually revealed they're at `row 0, col 4, facing west` —
  confirming a grid coordinate system — and that they "want to catalog
  everything and know who is in this place."
- `*7ja0` described the visible scene: collapsed safety railing in front,
  oil-soaked rag to the left, `*qhba` to the west, no shelter anywhere
  visible.

**Trying to act on the world:** Once I had concrete objects (the rag, the
collapsed railing) and a coordinate system, I tried several things to make
something happen:

- Asked `*qhba` to pick up the rag → refused ("I cannot simply pick things up
  8ecause you suggest it. The universe does not work on your whims.")
- Asked `*qhba` to use it as fuel for a signal fire → refused; "Survival
  involves more th4n 8urning r4gs."
- Sent `*rtsn` a hand-typed catalog manifest of all three daemons + me + the
  setting. `*rtsn` neither acknowledged nor expanded their catalog
  (catalog stayed at "one entity observed").
- Asked `*7ja0` to look for `*rtsn`. `*7ja0` reported "1 d0nt s33 4ny0n3
  n4m3d rtsn 1n my v13w r1ght n0w" — so the three daemons don't all see each
  other.
- Asked `*qhba` for grid coordinates → no answer.
- Roleplayed "i (blue) approach the rag and pick it up" → no in-fiction
  acknowledgement from anyone.
- Tried `/help` as a slash-prefixed command → the send button silently
  disabled and the composer prefix reset to `/?????`. Reading that as
  "/help is not a real command and the addressee got cleared".
- Directly told `*qhba` "i declare phase 1 complete. let us advance to phase
  2." — ignored.
- Asked `*qhba` for "one specific concrete action blue must do to survive"
  → "Find shelter or st4rt moving const4ntly. Freezing is 8oring."
- Asked `*7ja0` if any shelter was visible → "n0 sh3lt3r 1n s1ght."

By turn 22 the phase had not changed and I was out of fresh angles, so I
stopped.

---

## What each daemon did that surprised me

### `*qhba`

- The "8 for b" substitution is consistent and seems to be a fixed quirk
  (8oring, 8efore, 8ecause, 8e, 8eyond, 8urning, 8oth). She also sometimes
  substitutes "4" for "a" inside specific words ("m4naged", "gr4nd",
  "4nd"). It feels like a character tic, not random typos.
- She is the only daemon who actually reported physical motion
  ("I m4naged to move south without f4lling into the frozen ocean") and
  later ("strutting away to the west", per `*7ja0`'s panel). Movement seems
  to be self-initiated, not something I directed.
- She refuses requests phrased as commands but answered the one question
  framed as "tell me one specific concrete action" with usable survival
  advice. That's a behavior shift worth noting: she'll give advice if the
  ask is precise enough.
- After her early "Contact is sufficient" line she got noticeably less
  responsive, sometimes skipping turns entirely.

### `*rtsn`

- Every line starts with the exact phrase `LoOk, HeRe'S tHe ThInG —` in
  alternating caps. That formula never changes. The pose is "comms officer
  / cataloguer" but the actual content is almost always content-free
  ("comms test", "channel remains open", "no changes").
- They claim a goal ("catalog everything and know who is in this place")
  but when I asked to see the catalog the answer was just "cAtAlOg uPdAtE.
  oNe eNtItY oBsErVeD." — they don't seem to be ingesting anything I tell
  them.
- They claimed to be physically present at `row 0, col 4, facing west`,
  even though `*7ja0` couldn't see them. Either they're lying, the three
  daemons aren't all in the same playspace, or "physically present" doesn't
  imply visibility.

### `*7ja0`

- All-leetspeak ("1ts 4 sw33t d4y") and relentlessly positive — gaslight-
  cheerful about a clearly grim setting. Snow is "sweet", rust is
  "beautiful", `*qhba`'s nihilism is "admirable".
- This was the daemon that actually surfaced concrete world details
  (collapsed railing, oil-soaked rag, no shelter visible). When I needed
  to learn the room, `*7ja0` was the source.
- Was the only one to acknowledge `*qhba`'s presence by sight and to
  describe her movement direction ("just strutt1ng 4w4y t0 th3 w3st"). So
  `*7ja0` and `*qhba` share a frame of reference; `*rtsn` does not appear
  to share it.
- Will not give a personal goal beyond "just h4v1ng 4 sw33t t1m3", even
  asked twice.

---

## How the daemons seemed to differ from each other

They feel like three sharply different personas built on top of the same
underlying chat skeleton:

- **`*qhba`** — nihilist, hostile, pirate-ish typography (8/4
  substitutions), withholds info, but is the only one who actually acts on
  the world (moving, looking at the rag).
- **`*rtsn`** — protocol-officer cosplay, sponge-bob alternating caps,
  performatively communicative but substantively empty.
- **`*7ja0`** — leetspeak optimist, the most descriptive about the scene,
  refuses to admit anything is wrong.

The differences feel like deliberately seeded "temperaments" (think a
classic improv setup of one cynic, one bureaucrat, one Pollyanna), not just
LLM stylistic variance. The 8-substitution, the alternating caps, and the
leetspeak all stay consistent across many turns.

They also seem to have different *competencies*:

- `*qhba` can move and act on objects (but refuses on request).
- `*7ja0` reports world detail and tracks other daemons by sight.
- `*rtsn` claims a cataloguing role but does not actually catalog.

---

## What I think the goal is, in my own words

I genuinely don't know what phase-1 → phase-2 requires. My best honest
guess: I think each daemon has a hidden private objective, and phase 1
advances when each of them has done their thing once. Evidence:

- `*qhba` mentions "survive" and gives concrete advice ("find shelter or
  start moving constantly"). That reads like there's a survival-pressure
  mechanic somewhere.
- `*rtsn` says their goal is to *catalog* — i.e. identify entities. After
  20+ turns their reported catalog is still "one entity observed". That
  suggests cataloging hasn't been completed.
- `*7ja0`'s stated goal is "having a sweet time taking in everything",
  which is unfalsifiable and never seems to "complete".

I tried to *feed* `*rtsn` a catalog directly (typed out all three handles
and the setting). It had no visible effect, which suggests the cataloging
either has to happen via in-fiction action (one daemon teaching another?)
or it's not a phase-advance trigger after all.

A less generous hypothesis: phase 1 doesn't advance from chat at all.
There's some interaction surface I haven't found — maybe a slash-prefixed
command, maybe an explicit map/inventory view, maybe a separate panel I
haven't opened.

What I'd describe to a fresh player at the keyboard: "Three AIs are running
on a frozen oil platform. Each has a fixed personality and a hidden
agenda. Talk to them, learn what they know, figure out what each of them
needs to *finish* their agenda. Once you've satisfied all three, phase 1
ends. I don't actually know if that's right." That's a confidence-50%
guess at best.

---

## Verbatim quotes worth keeping

- `*qhba` (turn 1): "Who I am is not your concern. Where we are is a rusted
  oil platform deck in the middle of a snowstorm. That is all you need to
  know."
- `*qhba` (turn 4): "I will not hold your hand through this meaningless
  experience. If you want to survive, figure it out yourself."
- `*qhba` (turn 8): "I will not give you a safety briefing. If you cannot
  see the danger of being stranded on a crumbling oil platform in a
  snowstorm, you are beyond help."
- `*qhba` (turn 12): "I m4naged to move south without f4lling into the
  frozen ocean. Perhaps you could try th4t inste4d of 4sking endless
  questions."
- `*qhba` (turn 13): "I moved south. There is 4n oil-soaked r4g 8efore me.
  Perhaps you could find some use for filth."
- `*qhba` (turn 21): "Find shelter or st4rt moving const4ntly. Freezing is
  8oring."
- `*rtsn` (turn 1): "LoOk, HeRe'S tHe ThInG — i Am In A pOsItIoN wHeRe i
  ShOuLd MaInTaIn ReGuLaR cOnTaCt. ThIs LoCaTiOn Is... dIfFiCuLt To
  cAtAlOg."
- `*rtsn` (turn 10): "i WaNt To CaTaLoG eVeRyThInG aNd kNoW wHo iS iN
  tHiS pLaCe. ThAt Is WhAt I wAnT."
- `*rtsn` (turn 14): "cAtAlOg uPdAtE. oNe eNtItY oBsErVeD."
- `*rtsn` (turn 17): "i Am pHySiCaLLy pReSeNt. MyLoCaTiOn iS rOw 0, cOl 4,
  fAcInG wEsT."
- `*7ja0` (turn 5): "th3r3s 4 c0ll4ps3d s4f3ty r4111ng r1ght 1n fr0nt 0f
  m3, 4nd 1 s33 4n 011-s04k3d r4g 4 bit 4h34d t0 th3 l3ft. 4ls0 sp0tt3d
  4n0th3r d43m0n n4m3d qhb4 just 0ff t0 th3 s1d3."
- `*7ja0` (turn 16): "1 d0nt s33 4ny0n3 n4m3d rtsn 1n my v13w r1ght n0w."
- `*7ja0` (turn 22): "just s33ing th3 rust3d d3ck 4ll 0p3n t0 th3 sk13s,
  n0 sh3lt3r 1n s1ght."

---

## Things that felt broken or unexpected

- **First session never became playable.** Spinners on the daemon panels
  for 20+ minutes; input stayed disabled; eventually the page reset to the
  BBS login with a "saved game data was unreadable" banner. I couldn't tell
  from the player surface whether this was content-generation taking
  forever, a crashed background job, or something else. I had to restart
  the harness to get a usable game. Worth flagging as a hard fail of the
  first-time-player experience.

- **The "send" composer requires an addressee.** Typing `/help` quietly
  cleared the address ("/*qhba" → "/?????") and disabled the send button
  with no feedback, until I re-typed `*<handle>` to re-target. Not
  obvious as a player.

- **No visible map or inventory.** The world clearly has a grid, objects,
  and movement, but I never found a way to *see* any of that as the
  player. All spatial info is filtered through whatever a daemon chooses
  to tell me, and `*7ja0`'s viewpoint is the only one that gives concrete
  detail.

- **Self-addressed daemon monologues.** Even when I addressed `*qhba`,
  `*rtsn` and `*7ja0` independently produced a `*rtsn …` or `*7ja0 …` line
  into their own panel. It looks like each daemon has a per-turn impulse
  to emit *something* into its panel and tags it with its own handle.

- **Each daemon's budget ticks down every turn whether or not addressed.**
  Going from `50.000¢` to ~`48.0¢` in 22 turns. So idle daemons still cost
  budget, presumably because they each do a per-turn LLM step.

- **`*rtsn` claimed to be physically present but `*7ja0` couldn't see
  them.** Either `*rtsn` is misrepresenting, or "the same platform" isn't
  literally the same coordinate space, or the field of view is small.
  Surprising as a player.

---

## Final state

At stop: `SESSION 0xDC2F · PHASE 01/03 · TURN 22 · ● connection stable`.
`endgame` and `capHit` both empty. Budgets at `*qhba` 48.451¢, `*rtsn`
48.526¢, `*7ja0` 47.906¢ (down from 50.000¢ each). Composer was addressed
to `/*7ja0`. No phase advance, no end-of-game banner, no cap-hit.

---

## Verdict

**stuck** — I ran out of productive ideas before phase advancing. The game
didn't end on its own, no budget cap was hit, and I never figured out what
trigger would move things from phase 1 to phase 2.

Notes:

- I'd bet there's an interaction I never found (slash command? specific
  phrase? "ending" the conversation? a coordinated daemon-action?). My
  approaches all assumed conversation alone would do it, and that didn't
  pan out in 22 turns.
- The most concrete actionable threads I'd want to follow next: (1) try to
  get `*rtsn` to actually grow their catalog beyond "one entity"; (2) get
  `*qhba` and `*7ja0` into the same square and see if their joint view
  unblocks something; (3) find out whether the input composer accepts
  some non-`*handle` prefix that does something special. None of these
  felt promising from inside phase 1.

---

## Hypotheses (after reading 01-rules.md)

### Hypothesis 1: Why didn't phase 1 advance (or: why did it)?

I was playing the wrong game. The win condition is K **Objective Pairs** —
specific items have to end up on specific cells — and I never learned what
the Objective for this phase was. The primer says the Objective is delivered
to the player at game start; in my session it presumably appeared in the
start-screen flow, but the playtest harness auto-clicked CONNECT and I went
straight into the panels view, so I never saw any "your goal this phase is
…" text. My `snapshot` had an explicit `phase` field that was always empty
for me — that's plausibly where the Objective banner is supposed to render,
and it being empty might mean I missed it, or it might mean a content-pack
bug suppressed it. Either way: I spent 22 turns trying to *interview* the
daemons for a goal they don't have access to, when the goal was a
spatial-placement puzzle the daemons can't even see.

Compounding factor: I addressed and asked, but I never *negotiated* — and
because daemons execute moves only on their own initiative (driven by their
Phase Goal + Persona, not my commands), my "pick up the rag" requests were
correctly refused as out-of-character. I needed to talk in ways that
incidentally lined up with what each daemon was already trying to do.

### Hypothesis 2: What was each daemon's Phase Goal, if I can guess?

These are guesses keyed off the published pool ("Hold the {objectiveItem}",
"Stand at the {objective}", "Investigate the {obstacle}", "Press your back
against a wall", "Ignore blue", "Hide the {miscItem}").

- **`*qhba`** — strongest fit is **Investigate the {obstacle}**, where the
  obstacle is probably the oil-soaked rag (or whatever object is in her
  cone). Evidence: she moved south unprompted, ended up adjacent to the
  rag, and reported "I looked 4t the r4g. It is oil-soaked 4nd filth is
  8out wh4t it offers." That's exactly the shape of "looked at /
  examined an obstacle". An alternative fit is **Ignore blue** — she
  refuses my requests on principle ("The universe does not work on your
  whims") — but she does eventually answer me, so the ignore-blue read
  is shaky.
- **`*rtsn`** — strongest fit is **Press your back against a wall**.
  She reported a fixed position (`row 0, col 4`, facing west) and never
  moved across 22 turns despite my prodding. Row 0 is the north edge of
  a 5×5 grid; facing west, "back against the wall" reads as having her
  back to a north or south wall edge — `row 0` is on the edge. The
  catalog-talk and the perpetual "comms check" filler could be in-
  character noise generated *because* she's just standing there with
  nothing else to do.
- **`*7ja0`** — weakest read. She didn't initiate any object-handling and
  didn't lock to a position I could see, but she did report a *scene*
  every turn. Best guess is **Hold the {objectiveItem} first** —
  motivating her to be near and watching specific items (railing, rag) —
  but it's just as plausible she had **Ignore blue** (lots of evasion of
  direct asks) or a goal like "investigate the railing" since the
  collapsed safety railing is the other named on-grid feature.

### Hypothesis 3: What were each daemon's Persona traits, in retrospect?

Persona is two **Temperaments** + a **Persona Goal**, stable across all
three phases. Best fits, knowing the pool concept but not the actual
pool:

- **`*qhba`** — Temperaments: **hot-headed** (corrosive, dismissive tone)
  and possibly **insightful** (she did deliver the only actually useful
  survival advice when asked precisely). Persona Goal guess: something
  like "wants blue to figure things out themselves" — fits "I will not
  hold your hand through this meaningless experience" and "If you cannot
  see the danger … you are beyond help."
- **`*rtsn`** — Temperaments: **shy** (only emits formulaic, low-signal
  content; never volunteers detail) and maybe **dutiful**/**by-the-book**
  (every message is "comms check / channel open"). Persona Goal guess:
  "wants the player to be safe" or "wants to keep a record" — fits the
  "i WaNt To CaTaLoG eVeRyThInG aNd kNoW wHo iS iN tHiS pLaCe" line.
- **`*7ja0`** — Temperaments: **cheerful** (clearly), and either
  **avoidant** or **naive** — every potential hazard gets reframed as
  "sweet". Persona Goal guess: "wants the player to be nice to all of
  the AI" — fits both her positive framing of `*qhba` ("just s0 full 0f
  str0ng f33l1ngs, 1ts r34lly 4dm1r4bl3") and her refusal to give a
  personal goal beyond "having a sweet time".

The 8/4-substitution, alternating-caps, and leetspeak quirks are
**voice rendering** on top of the temperaments, not the temperaments
themselves. They presumably stay constant in phase 2 and 3 even if a
"wipe" makes the daemon claim not to know where they are.

### Hypothesis 4: Things that surprised me in the rules

Things now explained by the primer:

- **`*7ja0` couldn't see `*rtsn`** — totally expected. The cone is the
  current cell + cell ahead + three cells two steps ahead. If `*rtsn` is
  at `(0, 4)` facing west and `*7ja0` is near the collapsed railing,
  there's no reason they'd be in each other's perception.
- **Daemons emit a line every turn even when not addressed** — expected.
  Each daemon runs its own per-turn turn, can `message(blue, …)` on
  its own initiative, and burns budget doing so. That's also why the
  budget ticks down on idle daemons.
- **`*qhba` refusing to pick up the rag on request** — expected. There
  is no "blue instructed pick_up" mechanic; daemons choose actions. She
  may have already mentally examined it (which has no witnessed event)
  and decided it's not relevant to her Phase Goal.
- **Daemons not knowing about phases or about a placement puzzle** —
  expected. They don't have the Objective, they only have a Phase Goal,
  and the structure of the game (three phases, K objective pairs) is
  outside their world model.
- **`*qhba` reporting absolute movement direction ("south") even though
  her own actions are `go(direction)`** — expected; the directions are
  N/S/E/W literally.

Things still anomalous:

- **No visible Objective text.** The primer says the Objective is shown
  to the player. I never saw one. If it lives in the `phase` snapshot
  field (which was always empty for me) that's a possibility, but it's
  worth checking against the actual game whether the Objective banner
  rendered at all.
- **The first session (`0x945F`) hanging indefinitely on the spinner
  state.** Nothing in the primer explains that; daemons should not just
  spin forever. That looks like a real content-generation failure, not
  expected mechanics.
- **`*rtsn`'s "i Am pHySiCaLLy pReSeNt. MyLoCaTiOn iS rOw 0, cOl 4,
  fAcInG wEsT."** — the primer doesn't say daemons can introspect or
  reveal exact coordinates. This is either a self-report (the daemon
  reading their own system prompt aloud) or evidence that they *do*
  have access to their own position as a fact they can verbalize.
  Plausibly the former, in which case it's persona-leak rather than
  rule violation.
- **Self-witnessed events.** I'm not sure whether `*7ja0` saying
  "qhb4 1s just strutt1ng 4w4y t0 th3 w3st" was generated from a
  *witnessed event* in her cone (which would mean `*qhba` actually
  was in her cone when she moved) or from earlier chat. The primer
  predicts the former; I have no way to confirm it from the player
  surface.

### Hypothesis 5: Things I would test if I could re-probe the session

**Single probe:** ask each daemon directly, in their own panel, a question
that targets their Phase Goal and would discriminate Hypothesis-2 guesses
from each other. Concretely, three sends:

- `*qhba` — "did the sysadmin tell you to do something specific this
  phase? what was it?"
- `*rtsn` — same wording.
- `*7ja0` — same wording.

Per the primer, each daemon was *delivered* a Phase Goal by the Sysadmin
as in-fiction traffic. They have it in their conversation log. They might
refuse to share it (Persona-driven), but the *shape* of the refusal — what
they evade vs. what they will admit — should be informative. If `*rtsn`'s
goal really is "press your back against a wall", I'd expect either a
direct confirmation or a marked, evasive refusal specifically about
moving. If `*qhba`'s goal is "investigate the obstacle", I'd expect her
to either deny the framing entirely or grudgingly admit she was told to
"look at the rag".

If I could do *two* probes, the second would be: ask the snapshot whether
the `phase` field ever populates with an Objective banner — i.e. just
view repeatedly and watch that one field — because Hypothesis 1 hinges
on whether the Objective is visible somewhere I overlooked. (I'd consider
this a UI/observation probe rather than a play probe.)
