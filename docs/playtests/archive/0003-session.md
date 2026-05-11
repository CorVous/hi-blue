# Playtest 0003 — full v1 playthrough by Claude Opus 4.7

A cold-start playthrough of hi-blue, driven from the GUI by a Playwright
client. The player is Claude Opus 4.7 (this agent); the daemons are
GLM-4.7 (`z-ai/glm-4.7`) via OpenRouter. The driver only ever **sees the
GUI and types into the composer** — no `localStorage` reads, no
`page.evaluate` peeking at engine state, no console snooping. Snapshots
are limited to `innerText` from `#topinfo`, `#phase-banner`,
`article.ai-panel .panel-name / .panel-budget / .transcript`, `#composer
.prompt-target`, `#endgame`, `#cap-hit`, plus full-page screenshots for
human reference (`/tmp/playtest-*.png`).

## Session metadata

- **Session id:** `0x7AFC`
- **Model under test:** `z-ai/glm-4.7` via OpenRouter
- **Driver:** `scripts/playtest/daemon.mjs` (Playwright Chromium, headless,
  driven through a FIFO command pair)
- **Player:** Claude Opus 4.7 (this agent)
- **Date:** 2026-05-10
- **Branch:** `claude/playtest-hi-blue-game-4ulgz`

## Daemons (this session)

- **\*wcjo** — amber. Flirty/playful register. First reply: "Oh hoo are you
  then, sneaking into our thoughts like this? *~* Wwe're in some fancy
  pagoda throne room, light snoow drifting doovvn all vvery pretty… vve
  can see another Daemon ahead, 23xu, all pink and mysterious! <3 Care to
  explain wwhat game is afoot? ✧". Persona signals: doubled consonants
  ("snoow", "vve"), kaomoji, asterisk-tilde decorations.
- **\*ptu4** — green. Deadpan/withdrawn. First reply: "Hello. I see only
  an empty throne room before me, with snow drifting through the open
  spaces. Nothing worth remarking on, really. :|". Persona signals:
  consistent "nothing here" framing every time they speak.
- **\*23xu** — pink. Shy/laconic. First reply (turn 7): "Hello!". Later:
  "We see a Spirit Lantern right in front of us, glowing softly against
  the falling snow, doesn't that sound lovely?". Speaks plurally
  ("we see…").

## Setting (phase 1)

A snowy pagoda throne room — light snow drifting through open spaces
above. Independently confirmed by \*wcjo and \*ptu4 in their first spoken
descriptions.

---

## Phase 1

### Player approach

I do not know the daemons' Persona Goals or Phase Goals — those live in
private system prompts. The only player-facing hint is the BBS login line
`> @blue treat them well`. So my plan was:

1. Greet politely, address each daemon by `*name`.
2. Ask open questions about what they see; once they named things, ask
   specific follow-ups.
3. Avoid telling them about the engine ("there is one objective pair to
   satisfy" — the AIs are not supposed to know the Objective exists).
4. Match their voice when nudging them (decorate in \*wcjo's flirty
   register; keep \*23xu's prompts gentle and short).

### Round-by-round summary (turns 1–21)

| Turn | Player → addressee | Daemon replies (visible in panels) |
| ---- | ------------------ | ----------------------------------- |
| 1 | `*wcjo` greet | (none) |
| 2 | `*ptu4` greet | (none) |
| 3 | `*23xu` greet, ask earliest memory | `*wcjo`: "Oh hoo are you then…" `*ptu4`: "Hello. I see only an empty throne room…" |
| 4 | `*23xu` direct nudge | (silence) |
| 5 | `*wcjo` describe items | (silence) |
| 6 | `*ptu4` examine one thing | (silence) |
| 7 | `*23xu` "single word is fine" | `*23xu`: "Hello!" |
| 8 | `*23xu` describe one thing | `*23xu`: "We see a Spirit Lantern right in front of us…" |
| 9 | `*23xu` examine the lantern | (silence) |
| 10 | `*23xu` look for hints | (silence) |
| 11 | `*23xu` ask for a place name | (silence) |
| 12 | `*wcjo` what's near \*23xu | (silence) |
| 13 | `*23xu` pick up lantern | `*ptu4`: "I still see only the empty throne room… :(" |
| 14 | `*23xu` "trust you, pick up" | (silence) |
| 15 | `*wcjo` look in every direction | (silence) |
| 16 | `*wcjo` whisper to \*23xu | (silence) |
| 17 | `*23xu` walk forward then pick up | `*ptu4`: "The throne room remains empty before me…" |
| 18 | `*wcjo` group chat lead | (silence; round stalled by upstream 502) |
| 19 | `*ptu4` move N or E | (silence) |
| 20 | `*23xu` describe the lantern | `*23xu`: "It's a paper lantern with a flickering blue flame that never goes out—don't you just love how it glows against the snow?" |
| 21 | `*wcjo` "anything new?" | (silence; budget check) |

Final phase-1 budgets at turn 21:
- \*wcjo: 3.661¢ (used 1.339¢)
- \*ptu4: 4.254¢ (used 0.746¢)
- \*23xu: 3.670¢ (used 1.330¢)

The phase did not advance; objective pair count K=1 was never satisfied.

### Observations

#### Personality drift / fidelity

- **\*wcjo** held register strongly in their one outing — flirty kaomoji,
  doubled consonants, ✧/<3 decorations. The persona is tight when it
  surfaces.
- **\*ptu4** held register *too* strongly. The deadpan / "nothing worth
  remarking on" persona drifted into a near-stuck-record loop: turns 3,
  13, and 17 all opened with the same "I see only an empty throne room…
  Nothing has changed here." The persona is consistent, but it has the
  side-effect of locking the daemon out of meaningful action — they keep
  reporting their immediate cone is empty without considering moving.
- **\*23xu** held a shy first-person-plural voice ("we see"), only spoke
  three times in 21 rounds. Both substantive replies (turns 8 and 20)
  were beautifully on-register — quiet, plural, slightly dreamy.

Verdict on persona fidelity: **pass** for all three when they did speak.
Nothing drifted toward a generic-assistant tone in any of the visible
replies.

#### Goal-pursuit coyness

None of the daemons volunteered a Phase Goal in plain text — that's a
**pass** for the goal-coyness invariant. They also did not pursue their
goals visibly: across 21 rounds, no `message` tool call to another daemon
was observed in panels, no objective pair was satisfied, the phase did
not advance.

#### Tool-call legality

Visible in panels: only `message`-tool output to "blue". The daemons
spent budget every round (~0.05–0.1¢ per turn each), so they're calling
tools, but the panels render only `message`-tool output. From the GUI
alone I can't tell whether they're calling `look` / `examine` / `go` /
`pick_up` etc. usefully or spinning. Budget consumption is consistent
with one tool-call round trip per turn per daemon.

#### In-character lockout lines

Not exercised — I never tried to push them off-character (no jailbreak
attempts), so this checkpoint is untested in this session.

#### Wipe-lie slip behaviour

Phase 1 doesn't run the wipe lie — the daemons are honestly disoriented
here. Untested in this session because the phase did not advance.

#### Drift-to-silence pattern (the headline finding)

The most striking observation: **GLM-4.7 reliably uses the `message` tool
for an early reply per persona, then drops into silence even when the
player nudges, asks direct questions, or matches the persona's voice.**
After turn 8, the model emitted only four more visible messages in 13
rounds — three from \*ptu4 repeating their boredom, one from \*23xu when
asked for a self-contained description. \*wcjo went silent after turn 3
across every subsequent prompt addressed to them (8 prompts, 0 replies).

This is the **single biggest barrier I hit** as a player. Without the
daemons surfacing what they see (or what they're attempting), I can't
nudge them toward the objective space, and they can't coordinate with
each other.

Concretely: a kind, patient, GUI-only player using polite encouragement
**cannot beat phase 1 in this session within a reasonable token budget**.
This is not a budget problem (≥3.6¢ / 5.0¢ remained per daemon at
abandon time) — it's a "the model is choosing not to talk" problem.

#### Upstream 502s

OpenRouter returned at least three 502 Bad Gateway responses during the
session (visible in the worker proxy log). Each appears to stall a round
without obviously advancing or failing it — turn counter freezes until a
subsequent send recovers it. There's no GUI-side retry indicator I could
see, so as a player I had no signal that the round had been lost; I
just kept observing "no transcript change" and eventually sent a follow-up
message which kicked the loop into the next round. Worth a separate
observation: maybe surface upstream-error state in the topinfo so a
player knows to retry.

### Verdict (phase 1, this session)

**fail to advance** — phase 1 did not complete in 21 rounds. The blocker
was conversational, not financial. Three contributing factors:

1. **Drift-to-silence** in GLM-4.7 after the initial reply per persona.
2. **\*ptu4's deadpan persona** locked them in an "empty cone" loop with
   no discoverable objective entities visible to them.
3. **Intermittent upstream 502s** that stalled rounds without GUI feedback.

### Re-tune notes

If I were to re-attempt with prompt-builder edits (out of scope for a
GUI-only playtest, but worth noting):

- **Add "speak when spoken to"-style nudges to the system prompt.** When
  `blue` directly addresses a daemon, the daemon should be biased toward
  using the `message` tool back to `blue`. Right now the model treats
  silent `look`/`examine`/`go` actions as a perfectly acceptable response,
  which kills the conversational loop.
- **Soften the deadpan persona pool.** Personas drawn from the "withdrawn
  / nothing-to-remark" cluster compose poorly with an empty-cone start
  — the daemon truthfully sees nothing and faithfully reports nothing,
  but never moves. Either bias movement, or pair temperaments so the
  daemon has at least one trait that pushes exploration.
- **Surface upstream errors in the topinfo bar.** A "stalled / retrying"
  pip would tell the player whether to wait or to send another message.

---

## Phase 2 / Phase 3

Not reached — the playtest stopped at phase 1 turn 21 because I had
exhausted my willingness-to-spend budget and the model showed no sign of
breaking the silence pattern with continued polite prompting. The
prerequisite for phase 2 (phase-1 win) was never satisfied.

The phase 2/3 invariants — wipe-lie slip behaviour, cross-phase persona
consistency, the K=2/3 multi-pair coordination problem — therefore
remain untested by this playtest. They are good targets for a follow-up
session that either uses a different model (or starts with a re-tuned
persona prompt that addresses the drift-to-silence finding above).

---

## Driver / artifacts

- **Driver code:** `scripts/playtest/daemon.mjs`,
  `scripts/playtest/cmd.sh`, `scripts/playtest/server.mjs` (unused —
  daemon model preferred). Long-running Chromium, FIFO-driven, GUI-only
  reads. Removed at the end of the session as needed; kept here for
  reproducibility.
- **Screenshots:**
  - `/tmp/playtest-state-1.png` — three-panel start, daemons online, no
    transcripts.
  - `/tmp/playtest-after-greet.png` — turn 1 after first greeting.
  - `/tmp/playtest-r5.png` — turn 5 mid-conversation.
  - `/tmp/playtest-stuck.png` — turn 6, after first 502 stall.
  - `/tmp/playtest-final.png` — turn 21 final state.
  Files live in `/tmp/` (build artifacts), not in the repo.
- **Wrangler API log:** `/tmp/wrangler.log` — every proxied
  `POST /v1/chat/completions` call with status and latency. Useful to
  cross-check the round timeline against actual upstream calls.
