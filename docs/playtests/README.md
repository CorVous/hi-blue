# Playtests

Playtest session logs live here. Each subdirectory has a different audience.

## `agent-sessions/`

Logs from agent-driven playtests, one Markdown file per Session, named by the
in-game 4-hex session id (e.g. `0x478F.md`). These are produced by the
`/playtest` skill in `.claude/skills/playtest/`, which drives a real headless
Chromium against a local `wrangler dev` worker and walks the agent through a
three-stage knowledge reveal (play → rules primer → code).

Run a new agent-driven playtest:

```sh
# Make sure OPENROUTER_API_KEY is exported, then invoke the skill:
#   /playtest
# The skill reads .claude/skills/playtest/SKILL.md and bootstraps the rest.
```

**Don't browse `agent-sessions/` while a playtest is in progress** — prior
agent logs are spoilers for an agent who hasn't reached Stage 3 yet.

## `archive/`

Historical playtest logs from before the current agent-driven flow. Seven
human / agent sessions plus the original README and `_session-template.md`.
The filenames are intentionally opaque (`NNNN-session.md`) so that a casual
`ls` doesn't leak content; open them individually for the original headings
and analysis.

These remain a valuable corpus — `archive/0003-session.md`,
`archive/0006-session.md`, and `archive/0007-session.md` document repeated
attempts to advance phase 1 against `z-ai/glm-4.7` and surface mechanics
(drift-to-silence, content-pack prose-tell gaps, tool-call legality) that
later changes have or haven't addressed.

## `_agent-observation-template.md`

The spoiler-free template a Stage-1 agent copies into
`agent-sessions/<sessionId>.md`. Uses player-facing vocabulary only. Do not
edit it to add domain terminology — the whole point is that a naive agent
fills it in before they've been told what those terms are.
