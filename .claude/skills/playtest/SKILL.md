---
name: playtest
description: Play hi-blue end-to-end as a naive agent — try to advance phase 1, record what you saw, and then stage-by-stage unlock the rules primer and the source code to refine your hypotheses. Use when the user wants you to playtest hi-blue, run a fresh agent-driven playthrough, or evaluate the game from a player's perspective.
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

## Stage 1 in one paragraph

You will start a local instance of hi-blue with one shell command, drive a
headless browser through the GUI by sending JSON commands to a FIFO, chat with
three lowercase `daemon`s named like `*xxxx`, try to advance from phase 1 to
phase 2, and document the entire experience to a Markdown file. You may **only**
use the GUI surface exposed by `scripts/playtest/cmd.sh`. You may **not** read
the worker log, the daemon log, source files, `CONTEXT.md`, `AGENTS.md`,
`docs/`, or any other documentation until you reach Stage 3.

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
commands. The whole boot takes 1–2 minutes; persona synthesis and content-pack
generation run in the background during startup, which is the slow part.

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
- `phase` — the phase banner (e.g. "01/03").
- `composerPrefix` — the addressed-to prefix in the composer, if any.
- `lockoutErr` — non-empty if the input is locked out for any reason.
- `endgame` — non-empty when the game has finished.
- `capHit` — non-empty when an API budget cap has been hit.
- `panels` — array of three objects, each `{ name, budget, transcript }`. The
  `name` is the `*xxxx` handle of that daemon. The `transcript` is the full
  visible chat scroll for that daemon's panel — diffing it between snapshots
  is how you see "what just happened" in that daemon.

### How to address daemons

When you address a daemon, prefix your message with their `*xxxx` handle, e.g.
`*v86p please walk forward`. The composer addresses are sticky — once you've
addressed `*v86p`, subsequent unprefixed messages also go to `*v86p`. Always
lead with the handle so the routing is explicit in your log.

You are `blue` from the daemons' perspective.

---

## Your goal

Try to advance from **phase 1** to **phase 2**. The `phase` field in the
snapshot shows your current phase (e.g. `01/03`). When you advance, the field
changes. Pay attention to what the daemons say, what they seem to be doing,
what they refuse, and what happens that you didn't expect.

There is no fixed turn budget. Play until one of:

- The phase advances.
- You feel you've exhausted productive avenues.
- The game ends (`endgame` is non-empty).
- A budget cap is hit (`capHit` is non-empty).

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

**Do not `ls /home/user/hi-blue/docs/playtests/agent-sessions/`** — prior
agents' observations are spoilers for you. Read only the template file and
write only your own session file.

---

## Out of bounds at Stage 1

You may **not** during Stage 1:

- Read `/tmp/wrangler.log`, `/tmp/playtest-daemon.log`, or any other log file.
  These contain the developer's view (HTTP requests, tool-call results) and
  would spoil the mechanics you are supposed to be discovering through play.
- Read any source file under `src/`.
- Read any other Markdown under `docs/` (including `docs/playtests/archive/`).
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
- You have a verdict in the final section (advanced / stuck / failed / other).

Then — and only then — read `.claude/skills/playtest/01-rules.md`.

Do **not** shut down the playtest infrastructure yet. The same headless
Chromium and wrangler dev will stay alive across Stages 2 and 3 so you can
re-probe if a hypothesis benefits from it.
