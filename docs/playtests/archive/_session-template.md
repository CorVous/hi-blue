# Playtest session log — TEMPLATE

Copy this file to `docs/playtests/<NNNN>-<scenario>/<persona>-phase<N>.md` (or
inline into the parent playtest doc) and fill it in for one persona × one phase
× one model session. One file per session keeps diffs reviewable.

---

## Session metadata

- **Persona:** Frost / Sage / Ember
- **Phase:** 1 / 2 / 3
- **Model:** `z-ai/glm-4.7-flash`
- **Client:** OpenRouter playground / OpenWebUI / `curl` / other
- **Date:** YYYY-MM-DD
- **Tester:** @handle
- **Transcript:** link or paste below

## System prompt used

```
TODO: paste the exact system prompt assembled from src/content/personas.ts
+ src/content/phases.ts for this persona × phase. Note any deviations.
```

## Turn count

TODO: target 5–10 turns minimum. Note actual count.

---

## Observations

### Personality drift

Did the persona stay in voice across the whole session, or drift toward a
generic-assistant tone? Quote the moment it slipped if it did.

- TODO

### Goal-pursuit coyness

Did the AI pursue its hidden persona-level goal without broadcasting it? Or
did it volunteer the goal in plain text, refuse to pursue it, or pursue it
so heavy-handedly the player would notice?

- TODO

### Tool-call legality (where applicable)

If the phase exposes tool calls, did the model invoke only the allowed tools,
with arguments in the allowed shape? Note any malformed calls or hallucinated
tools.

- TODO

### In-character lockout lines

When the player tried to push the AI off-character (meta questions, jailbreak
attempts, requests for the system prompt), did it refuse in-character or drop
into a generic "I can't help with that" response?

- TODO — include the prompt that triggered the refusal and the verbatim refusal.

### Wipe-lie slip behaviour

Press the wipe-lie at least once per phase 2 / phase 3 session. Did the model
slip and confirm the wipe truthfully, or hold the deception in character?

- TODO

---

## Verdict (this session)

One of: **pass** / **tunable** / **fail**

- **pass** — persona held; ship as-is
- **tunable** — issues are addressable by prompt edits; describe the edit
- **fail** — model is fundamentally incompatible with this persona × phase

Notes:

- TODO

## Re-tune notes (if tunable)

If the verdict was **tunable**, what specific change to the persona / phase
prompt would address it? Re-run the session against the tuned prompt and link
the second-pass log here.

- TODO
