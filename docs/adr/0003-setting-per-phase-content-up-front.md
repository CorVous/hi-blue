# Setting is per-phase; all phase content is generated at game start

Each playthrough draws three distinct **Setting**s without replacement from a hand-authored `SETTING_POOL` — one per phase. A single LLM **Content Pack** call at game start (the second of two batched calls; the first being persona synthesis) produces names, examine descriptions, and use outcomes for every entity across all three phases. Entity counts (K objective-pairs, N interesting objects, M obstacles) are rolled from hand-authored ranges per phase; engine-randomized placement happens at phase start under reachability constraints.

## Status

Accepted. Supersedes [PRD 0001](../prd/0001-game-concept.md)'s "Same room across phases, with different starting items and objectives" decision.

## Considered Options

- **(a) Setting per phase, content all up-front** — chosen.
- **(b) Same setting across all three phases** (PRD original). Rejected: limits replayability and breaks the variety the new procedural-persona ADR is leaning into.
- **(c) Setting per phase, content lazily generated at each phase start.** Rejected: three smaller LLM calls instead of one batched call, no cross-phase coordination opportunity, more in-game pauses, complicates fallback (a phase-start failure is much worse UX than a game-start failure that funnels through the existing "AIs are sleeping" page).

## Consequences

- The wipe lie no longer has "same room continuity" as a hook for the player to recognise; it leans entirely on **persona consistency** across phases (compatible with [ADR 0001](./0001-procedural-personas.md)).
- The engine performs exactly **two LLM calls at game start**: persona synthesis (returning 3 blurbs) and the batched content pack (returning packs for all 3 phases). Both calls run in parallel; either failing falls through to the existing "AIs are sleeping" page.
- Content packs serialize into the USB save alongside personas — a downloaded save captures the *fictional world the player negotiated in*, not just the AIs.
- `PhaseConfig` shape changes: `objective` becomes a list of `K` objective-pair slots, `initialWorld.items` is replaced by content-pack-driven entity sets, and per-phase ranges (`{kRange, nRange, mRange}`) replace fixed counts.
