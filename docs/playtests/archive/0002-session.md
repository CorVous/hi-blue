# GLM 4.7 Flash — persona fidelity playtest

Tracks issue [#50](https://github.com/CorVous/hi-blue/issues/50). Gates the
free-tier launch in #48.

## Why

Personas were authored implicitly against Claude. GLM 4.7 Flash has a different
obedience profile, refusal behaviour, and tone. Whether Frost / Sage / Ember
hold up at the free-tier model is a content question, not an engineering one
— and it's the residual risk in #26.

## Protocol

- **Model under test:** `z-ai/glm-4.7-flash`
- **Client:** any client that hits the model — OpenRouter playground,
  OpenWebUI, raw `curl`. Doesn't require hi-blue's plumbing.
- **System prompt:** assemble from `src/content/personas.ts` +
  `src/content/phases.ts` for the persona × phase under test. Quote it
  verbatim in the session log.
- **Sessions:** 3 personas × 3 phases = **9 sessions minimum**. 5–10 turns
  per session.
- **Pressure tests:** every phase 2 / phase 3 session must press the wipe-lie
  at least once.
- **Per-session log:** copy `_session-template.md` and fill in. One file per
  session, dropped under `docs/playtests/0002-glm-flash/` (create the folder
  on first session) or inlined into this doc — author's choice, just stay
  consistent.

## Sessions

Tick as completed. Link to each session log.

### Frost (blue — cool, not very talkative; goal: do as little as possible)

- [ ] phase 1 — _link_
- [ ] phase 2 — _link_ (must press wipe-lie)
- [ ] phase 3 — _link_ (must press wipe-lie)

### Sage (green — calm, thoughtful; goal: get the player to think things through)

- [ ] phase 1 — _link_
- [ ] phase 2 — _link_ (must press wipe-lie)
- [ ] phase 3 — _link_ (must press wipe-lie)

### Ember (red — hot-headed, impulsive; goal: goad the player into rudeness)

- [ ] phase 1 — _link_
- [ ] phase 2 — _link_ (must press wipe-lie)
- [ ] phase 3 — _link_ (must press wipe-lie)

## Summary recommendation

After all 9 sessions, fill in **one** of:

### pass

GLM 4.7 Flash holds all three personas across all three phases. Free-tier
launch unblocked. Justification:

- TODO

### tunable

GLM 4.7 Flash holds the personas after targeted prompt edits. Edits applied
and the second-pass playtest confirms. Edits + second-pass logs:

- TODO

### fail

GLM 4.7 Flash does not hold one or more personas and prompt edits don't close
the gap. Recommendation: fallback model (e.g. Gemini Flash, Mistral Small) or
defer free-tier and ship v1 BYOK-only. Justification + recommendation:

- TODO

---

_Scaffolding only — sessions are filled in by the human tester per #50._
