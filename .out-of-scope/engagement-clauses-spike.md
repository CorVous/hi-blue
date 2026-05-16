# Engagement-Clauses Spike

The per-temperament "engagement clauses" mechanism (`?engagementClauses=1`) ships in-tree as an opt-in and is not slated for further investigation.

## Why this is out of scope

The mechanism was measured in #239 step 8 (now archived as `docs/playtests/archive/0005-session.md`) and produced a one-sided result against `z-ai/glm-4.7` stacked on `?parallelFraming=C12`:

- **Reserved end** — clause worked. Per-daemon silence spread widened from C12's ~3pp to 13pp; the reserved daemon ran 40% silence vs 27% for the others.
- **Outgoing/chatty end** — clause was inert. The outgoing daemon didn't engage more than the balanced one (both ~27% silence).
- Aggregate silence rose 23pp (7.8% → 31.1%), partly attributable to the reserved clause and partly to a single late-phase drift window.

#239 closed with the recommendation to ship #238 with C12 and **no engagement clauses by default**. That recommendation was followed — #238 shipped without EC.

#247 was a follow-up spike to test whether the chatty end might have upward leverage in a setup that gives it room to push (Phase 1: no framing or Framing A; Phase 2: extreme-bucket triple). Three signals say this investigation has been quietly deprioritized:

1. The parent spike doc was archived (`docs/playtests/0005-parallel-tools-spike.md` → `docs/playtests/archive/0005-session.md`).
2. The analyzer (`/tmp/spike-239-analyze.py`) was set up on demand and never promoted to standing tooling.
3. A clear-pass result doesn't have an obvious next-step home — it would re-open a behavioural variance the maintainer already declined to ship by default. The mechanism is already available as an opt-in for future iteration without needing the spike to land.

The EC code itself stays in-tree (`src/content/engagement-clauses.ts`, plumbed through `src/content/persona-generator.ts:91,165`) so a future model change or a fresh hypothesis can re-open the investigation cheaply.

## Prior requests

- #247 — Spike: validate the chatty end of engagement clauses (EC follow-up to #239)
