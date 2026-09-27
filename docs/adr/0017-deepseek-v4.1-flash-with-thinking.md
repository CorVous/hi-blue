# ADR 0017 — DeepSeek V4.1 Flash, thinking on, pinned to DeepSeek's endpoint

**Status:** Accepted

The pinned model moves from `z-ai/glm-4.7` to `deepseek/deepseek-v4.1-flash`. Daemon turns now think before they answer, and every request is routed to DeepSeek's own endpoint on OpenRouter with fallbacks off.

## Evidence

Measured on 2026-09-27 with the repo's eval harnesses. The drift eval has 30 rounds, the action-variation eval 72 turns (3 scenarios × 3 personas × 8 repetitions), and the content-pack eval 10 packs. The samples are small, so read the numbers as direction, not precision.

| | GLM-4.7, thinking off (old daemon setup) | DeepSeek, thinking off | DeepSeek, thinking on |
|---|---|---|---|
| Drift: turns with no `message` call | 73% | 10–23% | 3–10% across 5 runs |
| Drift: turns with ignored free text | 8 of 30 | 0–2 of 30 | 0 of 30 |
| Objective scenario: chose `use` | 14 of 24 | 11 of 24 | 113 of 120 (94%) |
| Cost per daemon turn | $0.00083 | $0.0001–0.0002 | $0.0003–0.0005 |
| Median time per daemon turn | slower (Z.AI's endpoint: about 8.7 s to first token) | 1.5 s | 2.5 s |

| Content packs | GLM-4.7, thinking on (old setup) | DeepSeek, thinking on | DeepSeek, thinking off |
|---|---|---|---|
| Passed validation on the first attempt | 8 of 10 | 10 and 9 of 10 (two runs) | 6 of 10 |
| Time per pack | 25–420 s | 20–34 s | 8–19 s |
| Cost for 10 packs | $0.136 | $0.038 | $0.020 |

DeepSeek also keeps personas apart: it follows `<typing_quirks>` closely, so a lowercase, clipped Daemon stays lowercase and clipped. GLM-4.7 tended to open every Daemon's reply with the same scene description.

## Decision

- **Model.** `PINNED_MODEL` is `deepseek/deepseek-v4.1-flash`.
- **Thinking on everywhere.** `BrowserLLMProvider` defaults to `disableReasoning: false`, like the two JSON-mode providers already did. The extra second per turn buys reliable tool calls and objective play. The dev-host-only `?think=0` turns thinking off for comparison.
- **Pinned provider.** `PINNED_PROVIDER_ROUTING` (`src/model.ts`) is sent on every request: by the browser on the BYOK path, and by the proxy, which overwrites whatever `provider` a caller sends. OpenRouter serves this model from about 27 hosts whose prices differ by 10× and whose speeds range from about 14 to about 300 tokens a second, some at fp4 quantisation. Pinning keeps what players get equal to what the evals measured.
- **Pricing fallback follows the pin.** When OpenRouter omits `usage.cost`, the proxy prices a request from the pinned endpoint's price list, not the model's headline (cheapest-host) price. DeepSeek's endpoint charges double during weekday peak hours, so the fallback charges the highest of its time-of-day prices and never under-charges.
- **Reasoning stays private.** A Daemon's `assistantText` is built from visible content only. The reasoning trace can no longer be replayed to the model by the drift-to-silence retry (ADR 0016) as if the Daemon had said it.

## Considered options

**Stay on GLM-4.7.** It has vendor-endorsed roleplay tuning and nine months of use in this codebase. Rejected: it costs about 7× more per daemon turn, it is several times slower, and with thinking off, which its latency forced, it answers in ignored free text on most turns.

**DeepSeek without thinking.** Cheapest and fastest (about 1.5 s a turn). Rejected: it skips `message` calls on up to a quarter of turns, often walks away from an item it could `use`, and fails content-pack validation more often.

**Call DeepSeek's API directly.** Avoids OpenRouter's fee and exposes DeepSeek-only options such as numeric reasoning effort. Rejected for now: BYOK players bring OpenRouter keys, and the proxy's cost guard depends on OpenRouter's `usage.cost`. Pinning the provider on OpenRouter gets the same model and host with none of that rework.

**A rule against grid words in speech.** With thinking on, Daemons sometimes describe the world as "squares" and "cells" ("the mount is in the same square as the light"), echoing how `<what_you_see>` is laid out. A `<rules>` line forbidding those words removed them completely. But in the objective scenario, Daemons with the rule chose `use` on 80% of turns (229 of 288, across two wordings) against 94% without it (113 of 120). Instead they stepped toward an item they could already reach. Rejected: the grid words are cosmetic, and using items is the game.

**Leave routing to OpenRouter.** Rejected: the cheapest hosts are too slow for a live game, and quality may differ between quantisations.

## Consequences

- A daemon turn takes about one second longer before its first visible token.
- If DeepSeek's endpoint is down, requests fail rather than fall back to another host. Its OpenRouter uptime was 99.98% over the day measured.
- `docs/prompting/deepseek-v4.1-flash-guide.md` replaces the GLM-4.7 guide as the reference for prompt changes. The GLM guide stays because it explains why parts of the prompt look the way they do.
- Eval runners now match the game's request shape (`evals/request-options.ts`), so reports from before this ADR are not directly comparable with later ones.
