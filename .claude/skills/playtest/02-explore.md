# Explore the code (Stage 3 of 3)

You've played the game, written observations, read the rules primer, and
drafted hypotheses. The gate is now lifted: **you may read any source file,
documentation, log, or test in the repository to refine your hypotheses.**

This stage is open-ended. Below is a small starting map for orientation.
You do not have to follow it; you can also just `Grep` / `Glob` your way
around as normal.

**One exception — the isolation rail from `SKILL.md` still applies in
Stage 3.** Do not read, list, or grep anything under
`docs/playtests/agent-sessions/` or `docs/playtests/archive/`. Other agents'
and humans' playtest logs remain out of bounds even now. Your hypothesis
refinement should be grounded in the code and your own session, not in
someone else's writeup.

---

## Useful entry points

- **`CONTEXT.md`** — the canonical glossary of in-game terminology. Read this
  first if any vocabulary from `01-rules.md` was unclear.
- **`AGENTS.md`** — points at the testing surfaces, prompt files, and
  domain docs.
- **`docs/prd/0005-restructure-game-mechanics.md`** — the PRD that
  introduced single-game mode, the four Objective types, and the six
  Complication types. Worth a read if any structural hypothesis is fuzzy.
- **`src/spa/game/prompt-builder.ts`** — the file that assembles each
  daemon's system prompt every round. Read this if any hypothesis touches
  what a daemon knows or sees.
- **`src/spa/game/objective-pool.ts`** — the four-type Objective pool and
  the per-type satisfaction predicates. Pair with
  `src/spa/game/win-condition.ts` for the all-objectives-satisfied check.
- **`src/spa/game/complications.ts`** and
  **`src/spa/game/complication-engine.ts`** — the six Complication types
  and the schedule that draws them.
- **`src/spa/game/sysadmin-directive.ts`** — the Sysadmin Directive
  Complication's secrecy + revocation machinery.
- **`src/spa/game/content-pack-provider.ts`** — where the AI-discoverable
  `examineDescription` tells live, including the per-Objective-type prose
  rules.
- **`src/content/{persona-generator.ts, temperament-pool.ts,
  persona-goal-pool.ts, sysadmin-directive-pool.ts, setting-pool.ts,
  weather-pool.ts}`** — the content pools synthesis draws from.
  `src/content/phases.ts` is still present but its `PHASE_*_CONFIG`
  exports are deprecated; the live config is `SINGLE_GAME_CONFIG`.
- **`/tmp/wrangler.log`** — the worker proxy log for this run. Now in
  bounds. Useful for confirming which tool calls a daemon actually fired
  in a given round (look for `["pick_up","examine","message:0jmn"]`-style
  entries).
- **`/tmp/playtest-daemon.log`** — the Chromium driver log. Useful for
  debugging snapshot weirdness.

## Re-probing the live session

The headless Chromium and `wrangler dev` are still running. Your session is
still alive. If a hypothesis can be discriminated by one more probe in the
GUI, you can run `scripts/playtest/cmd.sh '{"op":"send","text":"…"}'` again
without rebooting. The same daemons, same setting, same content pack.

If you want a **fresh** session (different daemons, different setting) to
test whether something was specific to this playthrough, shut down first
and re-run `scripts/playtest/start.sh`.

## Refining your hypotheses

Open `docs/playtests/agent-sessions/<sessionId>.md` and append a new
section:

```markdown
## Hypothesis refinement (after reading the code)

### Hypothesis 1 — refined

What did the code show? Did your earlier guess hold up? Cite the file
and line you grounded the refinement in.

### Hypothesis 2 — refined

…

### New hypotheses surfaced by the code

Things you couldn't have guessed from the rules primer alone but that
the implementation made clear.

…

### Open questions

Things you still don't know after reading the code, that would need
either a new playtest or a maintainer's input to resolve.

…
```

Quote file paths with `path:line` so a reader can jump to the source.

---

## Finishing the playtest

When you're done refining hypotheses, shut down the infrastructure:

```sh
scripts/playtest/cmd.sh '{"op":"shutdown"}'
pkill -f 'wrangler dev'
rm -f /tmp/playtest-in /tmp/playtest-out
```

The screenshots in `/tmp/playtest-*.png` and the logs in `/tmp/wrangler.log`,
`/tmp/playtest-daemon.log` are not committed — they're per-run artifacts. If
any specific screenshot or log line is worth preserving, paste it into your
session log directly.

Report your findings back to the user with a short summary, the path to
your session log, and the top one or two surprises you uncovered.
