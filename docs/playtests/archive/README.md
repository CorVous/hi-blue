# Playtests

This directory holds playtest session logs and the GUI-only driver used to
record them.

- **Session logs** — one Markdown file per playthrough, named
  `<NNNN>-<slug>.md`. Use `_session-template.md` as the starting shape for a
  per-persona × per-phase × per-model session log, or a single multi-section
  doc per full playthrough (see `0003-claude-opus-4-7-playthrough.md`).
- **Driver** — `scripts/playtest/{daemon.mjs, cmd.sh}` drives a real browser
  through the same UI a player sees. See "Running a playtest" below.

## When to run a playtest

- A new model lands as a candidate for the daemons (default pinned model:
  `z-ai/glm-4.7` — see `src/model.ts`). Prove personas hold and at least
  one phase advances at the new model's price point.
- Persona / phase / content-pack prompts in `src/spa/game/prompt-builder.ts`,
  `src/content/personas.ts`, or `src/content/phases.ts` change in a way
  that could affect daemon voice or behaviour.
- A change to the round loop, mention parser, or cone projector that you
  want to exercise end-to-end with a real LLM rather than stubs.

If you only need to assert structural behaviour (engine state transitions,
DOM rendering, tool-call legality), the e2e suite under `e2e/` with the
fixtures in `e2e/helpers/stubs.ts` is faster, cheaper, and deterministic.
Playtests are for behaviour you can only see with a real LLM in the loop.

## Constraint: GUI-only

The driver reads only what a sighted player would see — `innerText` from
visible DOM (`#topinfo-*`, `#phase-banner`, `article.ai-panel
.panel-name / .panel-budget / .transcript`, `#composer .prompt-target`,
`#endgame`, `#cap-hit`) plus full-page screenshots. **No** `page.evaluate`
into engine state, **no** `localStorage` reads, **no** console scraping
for game data. This keeps the playtest honest about what the player can
actually perceive — a daemon that doesn't surface what it sees via the
`message` tool is invisible to you, just as it would be to a player.

(Reading the worker proxy's stderr/access log during the run is fine —
that's the developer's view, not the player's. Server logs informed the
"upstream 502s stall rounds silently" finding in playtest 0003.)

## Prerequisites (one-time)

Standard repo setup, plus the Playwright browser binary:

```sh
corepack enable && pnpm install
pnpm exec playwright install chromium
```

Verify the headless Chromium is on disk before continuing:

```sh
ls /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell
# or wherever PLAYWRIGHT_BROWSERS_PATH points
```

## Running a playtest

The driver model is **two long-running processes plus a request/response
FIFO pair**: the worker dev server, the Chromium daemon, and one shell
that pipes JSON commands in and reads JSON responses out.

### 1. Start `wrangler dev` with a real OpenRouter key

The Playwright e2e gate uses `OPENROUTER_API_KEY=test-key` (stubbed at the
HTTP layer). For a playtest you want real upstream calls, so override:

```sh
export OPENROUTER_API_KEY=sk-or-v1-...

pnpm build && \
  pnpm exec wrangler dev --local --port 8787 \
    --var "OPENROUTER_API_KEY:$OPENROUTER_API_KEY" \
    --var "ALLOWED_ORIGINS:http://localhost:8787" \
    | tee /tmp/wrangler.log
```

Run it in the background or in a separate terminal — the daemon talks to
`http://localhost:8787`. The `ALLOWED_ORIGINS` override is required: the
default in `wrangler.jsonc` is the GitHub Pages origin; without the
override, browser CORS to `http://localhost:8787/v1/chat/completions`
fails. (Same-origin requests technically don't trip CORS, but other
preflight paths do — set it explicitly.)

You can sanity-check the proxy + key with one curl before launching the
browser:

```sh
curl -sS -X POST -H "Content-Type: application/json" \
  -H "Origin: http://localhost:8787" \
  http://localhost:8787/v1/chat/completions \
  -d '{"model":"z-ai/glm-4.7","messages":[{"role":"user","content":"reply with PONG"}],"max_tokens":20,"stream":false}' \
  | head -c 400
```

A 200 OK with a `choices[0]` body confirms the key is wired through and
OpenRouter is up.

### 2. Start the playtest daemon

```sh
node scripts/playtest/daemon.mjs 2>&1 | tee -a /tmp/playtest-daemon.log
```

The daemon launches a headless Chromium, navigates to
`http://localhost:8787/?skipDialup=1`, fills `#password` with `password`,
clicks `#begin`, and waits for the game route. Two FIFOs appear at
`/tmp/playtest-in` and `/tmp/playtest-out`. Watch the log for
`game route loaded — daemon ready` before sending commands.

The first wait can take up to ~60 seconds — the start screen calls
persona synthesis (~3 s) and content-pack generation (~30–50 s) in
parallel, and CONNECT only un-disables once the dial-up animation
completes (`?skipDialup=1` short-circuits the animation, but generation
still has to finish in the background for a usable session). Be patient.

### 3. Drive it

```sh
# View the visible state
scripts/playtest/cmd.sh '{"op":"view"}'

# Send a message (addressed to *<persona-name>; daemon handles fill+click)
scripts/playtest/cmd.sh '{"op":"send","text":"*wcjo hi! im blue. what do you see?"}'

# Wait N ms (rounds take ~10–40 s — see "round timing" below)
scripts/playtest/cmd.sh '{"op":"wait","ms":40000}'

# Snapshot a PNG for the playtest log
scripts/playtest/cmd.sh '{"op":"snap","path":"/tmp/playtest-r5.png"}'

# Clean shutdown
scripts/playtest/cmd.sh '{"op":"shutdown"}'
```

Each command response is a single JSON object. The `view`, `send`, and
`wait` ops return a `snapshot` field with `topinfoLeft / topinfoRight /
phase / composerPrefix / lockoutErr / endgame / capHit / panels[]`.
`panels[i].transcript` is the full visible chat for that daemon — diffs
between snapshots are the "what the AI just said" channel.

### 4. Tear down

```sh
scripts/playtest/cmd.sh '{"op":"shutdown"}'
pkill -f 'wrangler dev'
rm -f /tmp/playtest-in /tmp/playtest-out
```

Screenshots and `/tmp/wrangler.log` are useful artifacts to reference in
the playtest log but should not be committed (they're build-time data,
not source).

## Authoring the playtest log

Pick one of:

- **Per-persona × per-phase log** — copy `_session-template.md` to
  `<NNNN>-<scenario>/<persona>-phase<N>.md`. Good when you're targeting a
  specific persona × phase combination at a specific model.
- **Full-playthrough log** — single `<NNNN>-<slug>.md` at the
  `docs/playtests/` root with sections per phase. Good for an
  end-to-end run. See `0003-claude-opus-4-7-playthrough.md` for shape.

Both shapes share the same per-session metadata block (id, model, driver,
date, branch, GUI-only constraint statement) and observation buckets
(persona drift, goal-pursuit coyness, tool-call legality, in-character
lockout lines, wipe-lie slip). Quote daemon replies verbatim — the
register details (kaomoji, doubled consonants, repeated phrases) are the
data, not flavour.

End every session with an explicit verdict: **pass** / **tunable** /
**fail** / **fail to advance**, plus re-tune notes if `tunable`.

## Operational gotchas (learned the hard way)

These are the things that ate hours during playtest 0003. Skim before you
start.

- **Round timing is variable.** Rounds normally complete in 10–25 s for
  the three-daemon loop. Allow 40 s in `wait`. If a round takes longer,
  check `/tmp/wrangler.log` for an upstream 502 — see next bullet.
- **OpenRouter 502s stall rounds silently.** A `POST /v1/chat/completions
  502 Bad Gateway` in the worker log means one daemon's call to upstream
  failed; the SPA's `catch` only branches on `CapHitError` (issue #231).
  The turn counter freezes, panels stay quiet, and there is **no GUI
  signal**. Recovery: send another player message — that re-kicks the
  round loop and the turn advances. Don't conclude "the daemon went
  silent" until you've cross-checked the worker log.
- **Two `.panel-name` elements per panel.** The chrome renders the
  `*xxxx` handle in both the top and bottom brow; the visible one is
  whichever has non-empty text. The driver in `daemon.mjs` already walks
  both — if you fork it, keep that.
- **Drift-to-silence is real.** GLM-4.7 reliably emits an early
  per-persona reply via the `message` tool, then drops into silence even
  under direct prompts (see playtest 0003 for receipts). Plan for the
  case where you can't beat a phase by polite encouragement alone, and
  document the silence rather than treating it as a driver bug.
- **Budget is $0.05 per daemon per phase.** Three daemons × three
  phases = $0.45 in the absolute worst case. A typical full playthrough
  spent ~$0.40 of API budget for 21 rounds without advancing phase 1.
  Don't expect to retry many full sessions for free.
- **`?skipDialup=1` does not skip generation.** It only skips the
  dial-up animation. Persona synthesis and content-pack generation still
  run in the background; CONNECT lights up early but the game route's
  loading flow still gates on those promises.
- **The composer addressee is sticky.** Once you address `*wcjo`, the
  prompt prefix shows `/*wcjo` and subsequent messages without an
  explicit mention go to `*wcjo`. Always lead with `*<name>` to make the
  routing explicit in your log.
- **Don't restart the daemon mid-session if you can avoid it.** A
  restart launches a fresh Chromium, which means a fresh new-game
  bootstrap (~30–50 s and a billable content-pack call). Keep the daemon
  alive across many `cmd.sh` invocations.
- **The full proxy log is gold.** Keep `/tmp/wrangler.log` open in a
  separate terminal during the run; latency and 502s there often explain
  apparent silences in the panels.

## Reproducing playtest 0003 specifically

If you want to re-run the GLM-4.7 phase-1 attempt:

1. Build and start the worker dev server with the real key (above).
2. Start the daemon (above).
3. Replay the prompts from the round-by-round table in
   `0003-claude-opus-4-7-playthrough.md`. Note that personas, settings,
   and content-pack contents are reseeded each new game, so you'll get
   different daemons and a different setting — the *behaviour pattern*
   (drift-to-silence, deadpan-loop, occasional 502 stall) is what's
   meant to be reproducible, not the specific transcript.
