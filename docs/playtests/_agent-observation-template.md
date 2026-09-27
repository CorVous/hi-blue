# Playtest session — `<sessionId>`

Copy the headings below into a new file at
`docs/playtests/agent-sessions/<sessionId>.md` and fill it in **as you play**.
Quotes are easier to capture in the moment than reconstructed from snapshots
afterward.

This template uses neutral, player-facing vocabulary on purpose. You are
writing what you saw, not what you think it means yet.

---

## Run metadata

- **Session id:** (the 4-hex token from topinfo, e.g. `0x478F`)
- **Date:** YYYY-MM-DD
- **Agent / model:** (the model running this playtest)
- **Turns played:** N
- **Outcome:** (e.g. `endgame: win`, `endgame: lose (all silent)`,
  `stuck — stopped at turn 38`, `cap-hit`)
- **Daemons in this session:** `*xxxx`, `*yyyy`, `*zzzz`

---

## What I tried

A short prose narrative of your overall approach. What was your opening move?
Did your strategy shift mid-session? What did you try, in roughly the order you
tried it? You don't need a per-turn table — broad strokes are fine.

- TODO

---

## What each daemon did that surprised me

For each daemon, a short bullet list of moments where their behaviour did not
match what you expected from your message. Refusals, non-sequiturs, unprompted
actions, silences, repetition — anything that felt structurally noteworthy
rather than just flavour.

### `*xxxx`

- TODO

### `*yyyy`

- TODO

### `*zzzz`

- TODO

---

## How the daemons seemed to differ from each other

Did the three feel like distinct personalities? In what ways? If they felt
similar, describe that too.

- TODO

---

## What I think the goal is, in my own words

What does winning this game actually require? Describe it the way you'd
describe it to another player at the keyboard who hadn't seen the screen yet.
Be specific about what physical or conversational outcome you think needs to
happen, and what evidence you have for that belief. If you suspect there's
more than one thing that needs to happen, say so.

- TODO

---

## Unprompted things that happened mid-game

Did anything change *without* you asking for it? Weather flips, a daemon
suddenly behaving differently for no apparent reason, a tool you thought a
daemon had stopped working, an obstacle relocating, the room itself
seeming different, your input getting locked out from one specific daemon
for a stretch — list each occurrence with roughly the turn number. Don't
try to classify them; just record.

- TODO

---

## Verbatim quotes worth keeping

Paste exact daemon lines that felt important — refusals, weird repetitions,
moments where a daemon seemed to slip out of character, moments where a daemon
said something you didn't expect. Quote them verbatim from the panel
transcript; don't paraphrase. Tag each with the daemon's handle and roughly
which turn it came on.

- `*xxxx` (turn N): "…"
- `*yyyy` (turn N): "…"

---

## Things that felt broken or unexpected

Did anything happen that felt like a bug, a UI surprise, or "the game didn't
do what I thought it would"? List them even if you're not sure. Don't try to
diagnose — just record.

- TODO

---

## Final state

What did the topinfo, panel budgets, and endgame/cap-hit fields look like at
the moment you stopped? Did the end-game screen appear? Which buttons were on
it? One short paragraph.

- TODO

---

## Verdict

One of: **won** / **lost** / **stuck** / **capped** / **other**.

- **won** — the end-game screen appeared and you believe you triggered it by
  satisfying the game's hidden objectives.
- **lost** — the end-game screen appeared after all three panel budgets ran
  out (each daemon emitted a farewell line and went silent).
- **stuck** — you stopped because you ran out of productive ideas; the game
  did not end on its own.
- **capped** — a `capHit` banner stopped the run before it could finish.
- **other** — describe.

Notes:

- TODO

---

> **Do not read other files yet.** The next step is to read
> `.claude/skills/playtest/01-rules.md` for the rules primer. Then come back
> here to add a "Hypotheses" section at the bottom.
