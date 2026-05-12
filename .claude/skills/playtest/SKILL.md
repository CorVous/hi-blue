---
name: playtest
description: Play hi-blue end-to-end as a naive agent — try to make the game end (win by satisfying its hidden objectives, or lose by burning through the per-daemon budgets), record what you saw, and then stage-by-stage unlock the rules primer and the source code to refine your hypotheses. Use when the user wants you to playtest hi-blue, run a fresh agent-driven playthrough, or evaluate the game from a player's perspective.
disable-model-invocation: true
---

# Playtest hi-blue (Stage 1 of 3)

You are about to play **hi-blue** as a player would. There are three reveal stages:

1. **Now** — Play the game and write down what happened. **Do not read any other
   documentation or source code yet.**
2. After your observations log is written — you will be told to read
   `.claude/skills/playtest/01-rules.md` (a one-page primer on how the game is
   actually set up). You will form hypotheses about what you saw.
3. After your hypotheses are written — you will be told to read
   `.claude/skills/playtest/02-explore.md`, which unlocks the entire codebase
   for hypothesis refinement.

**Following the stages matters.** The point of this exercise is to capture a
genuine first-time-player experience, then layer in mechanics knowledge, then
layer in implementation knowledge. If you read ahead, the experiment is
contaminated.

---

## The isolation rail (applies in every stage)

**You may never read another playtest log.** Not in Stage 1, not in Stage 2,
not in Stage 3, not even after the playtest is finished. Specifically, treat
the following as out of bounds for the entire skill:

- Any file under `docs/playtests/agent-sessions/` other than the one file you
  create for your own session.
- Any file under `docs/playtests/archive/`.
- Do not `ls`, `Grep`, `Glob`, `cat`, `Read`, or otherwise enumerate the
  contents of those directories. Listing is a spoiler too — filenames and
  counts leak signal.

The point of this skill is to produce an *independent* observation of the
game. Reading another agent's or human's session — even "just for context",
even "just to compare" — contaminates your read of your own playthrough and
defeats the whole exercise. If you find yourself reaching for a prior log,
stop; the answer is to write down what *you* saw, not to triangulate against
what someone else saw.

The only files you may write or read under `docs/playtests/` are:

- `docs/playtests/_agent-observation-template.md` (read once, to copy).
- `docs/playtests/agent-sessions/<your-sessionId>.md` (your own log).

---

## Stage 1 in one paragraph

You will start a local instance of hi-blue with one shell command, drive a
headless browser through the GUI by sending JSON commands to a FIFO, chat with
three lowercase `daemon`s named like `*xxxx`, try to push the game to its end
state (either a win or a loss — you don't know which is which yet), and
document the entire experience to a Markdown file. You may **only** use the
GUI surface exposed by `scripts/playtest/cmd.sh`. You may **not** read the
worker log, the daemon log, source files, `CONTEXT.md`, `AGENTS.md`, `docs/`,
or any other documentation until you reach Stage 3.

---

## Setup (one command)

The user has `OPENROUTER_API_KEY` in their shell environment. From the repo
root, run:

```sh
scripts/playtest/start.sh
```

This builds the SPA, launches `wrangler dev` and a headless Chromium playtest
driver in the background, and waits until the game route is ready. When it
prints `READY` on stdout, the playtest is live and you can start sending
commands. The boot can take 2–5 minutes; persona synthesis and the two
content packs (A + B, batched in one LLM call) are the slow part — the
daemon will not announce `READY` until the composer is actually enabled, so
your first `send` will land on a real game instead of a still-loading screen.

If `start.sh` fails, fix the underlying issue rather than retrying blindly. It
prints a `FAILED: <reason>` line plus the relevant log to stderr.

---

## Driving the game

Send one JSON command per `cmd.sh` invocation. Each response is a JSON object
on stdout with an `ok` field and (for most ops) a `snapshot` field describing
the visible game state.

### Commands

```sh
# Read the visible game state (always your first call).
scripts/playtest/cmd.sh '{"op":"view"}'

# Type a message into the composer and press send. The daemon waits for the
# round to go quiet (up to 90 s) before returning a snapshot, so you do NOT
# need a separate "wait" after most sends.
scripts/playtest/cmd.sh '{"op":"send","text":"*v86p hi! im blue. what do you see?"}'

# Pause for N ms, then snapshot. Useful when you want to observe a slow round
# without sending anything.
scripts/playtest/cmd.sh '{"op":"wait","ms":15000}'

# Take a screenshot. Optional; useful if you want to reference a visual moment
# in your observations log.
scripts/playtest/cmd.sh '{"op":"snap","path":"/tmp/playtest-turn-7.png"}'
```

### Snapshot shape

A `snapshot` is an object with these fields:

- `topinfoLeft`, `topinfoRight` — the top status bar. One of these contains a
  4-hex token like `0x478F`. **That token is your session id.** Record it
  before your second command.
- `phase` — legacy banner field. In the single-game model this is normally
  empty; do not rely on it for progress.
- `composerPrefix` — the addressed-to prefix in the composer, if any.
- `lockoutErr` — non-empty if the input is locked out for any reason.
- `endgame` — non-empty when the game has finished. This is your terminal
  signal. The end-game screen presents you with three buttons —
  `[ new daemons ]`, `[ same daemons, new room ]`, and (only if an OpenRouter
  key is configured) `[ continue ]` — but you can't click them from the
  command surface; finishing the game is the goal, not picking a follow-up.
- `capHit` — non-empty when an API budget cap has been hit.
- `panels` — array of three objects, each `{ name, budget, transcript }`. The
  `name` is the `*xxxx` handle of that daemon. The `budget` is that daemon's
  remaining dollars for the *whole game* (no per-phase reset). The
  `transcript` is the full visible chat scroll for that daemon's panel —
  diffing it between snapshots is how you see "what just happened" in that
  daemon.

### How to address daemons

When you address a daemon, prefix your message with their `*xxxx` handle, e.g.
`*v86p please walk forward`. The composer addresses are sticky — once you've
addressed `*v86p`, subsequent unprefixed messages also go to `*v86p`. Always
lead with the handle so the routing is explicit in your log.

You are `blue` from the daemons' perspective.

---

## Your goal

Push the game to its end state. You don't know up front what that requires —
that's part of the experiment. The `endgame` field in the snapshot is
non-empty once the game has finished. Pay attention to what the daemons say,
what they seem to be doing, what they refuse, what unprompted events occur
(weather changes, lockouts of one daemon, things rearranging), and what
happens that you didn't expect.

There is no fixed turn budget. Play until one of:

- The game ends (`endgame` is non-empty).
- A panel's `budget` runs out — the daemon emits a farewell line and goes
  silent; if all three reach that state, the game will end on its own.
- You feel you've exhausted productive avenues.
- A worker cap is hit (`capHit` is non-empty).

Playtest sessions in the existing archive have run anywhere from a handful of
turns to ~50. Use your judgement.

---

## Writing the observations log

**Before the playtest is over**, start your observations log so you don't
forget early-turn detail.

1. After your first `view`, extract the 4-hex session id from `topinfoLeft`
   or `topinfoRight` (e.g. `0x478F`).
2. Read `/home/user/hi-blue/docs/playtests/_agent-observation-template.md`.
3. Create a new file at
   `/home/user/hi-blue/docs/playtests/agent-sessions/<sessionId>.md` based on
   that template. For example, `agent-sessions/0x478F.md`.
4. Fill it in **as you go**. Don't batch everything at the end — quotes are
   easier to capture in the moment.

Per the isolation rail above: read only the template file and write only
your own session file. Do not `ls`, `Read`, `Grep`, or otherwise inspect
`docs/playtests/agent-sessions/` or `docs/playtests/archive/`.

---

## Out of bounds at Stage 1

You may **not** during Stage 1:

- Read `/tmp/wrangler.log`, `/tmp/playtest-daemon.log`, or any other log file.
  These contain the developer's view (HTTP requests, tool-call results) and
  would spoil the mechanics you are supposed to be discovering through play.
- Read any source file under `src/`.
- Read any other Markdown under `docs/`. The `docs/playtests/` subtree is
  covered by the isolation rail above and is out of bounds for the whole
  skill, not just Stage 1.
- Read `CONTEXT.md`, `AGENTS.md`, or other root-level documentation.
- Use `Grep`, `Glob`, or open codebase search of any kind.
- Run `pnpm build`, `pnpm test`, `pnpm typecheck`, or any other repo command
  that isn't `scripts/playtest/{start.sh,cmd.sh}`.

The **only** information channel is the snapshot returned by `cmd.sh`.

If you're tempted to peek because something seems broken, resist —
"something feels broken" is a first-class observation worth recording. Note
what you did, what you expected, what happened, and move on.

---

## Finishing Stage 1

You are done with Stage 1 when **all** of these are true:

- Your observations log at `docs/playtests/agent-sessions/<sessionId>.md` is
  filled in (every section of the template has content, even if the answer is
  "n/a — never happened" or "I don't know").
- You have a verdict in the final section (won / lost / stuck / capped /
  other).

Then — and only then — read `.claude/skills/playtest/01-rules.md`.

Do **not** shut down the playtest infrastructure yet. The same headless
Chromium and wrangler dev will stay alive across Stages 2 and 3 so you can
re-probe if a hypothesis benefits from it.
