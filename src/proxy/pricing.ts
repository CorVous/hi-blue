/**
 * Per-token price lookup for the pinned model, sourced from OpenRouter's
 * public `/models` endpoint. Used by the cost-denominated rate guard to
 * convert (prompt_tokens, completion_tokens) into a micro-USD charge.
 *
 * OpenRouter returns `pricing.prompt` and `pricing.completion` as decimal
 * strings in USD per token (e.g. "0.0000001"). We multiply by 1e6 to express
 * as micro-USD per token; per-token prices may be fractional, but request
 * totals are always rounded up to integer micro-USD before reconciliation.
 *
 * Memoised in module scope for CACHE_TTL_MS to avoid hitting `/models` on
 * every request. On fetch failure, prefers stale cache; on cold-start with
 * no cache, falls back to a conservative (high) constant so rate limiting
 * fails closed rather than open.
 */

import { PINNED_MODEL } from "../model.js";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3_000;

// Conservative cold-start fallback: ~$0.001 / 1k prompt tokens,
// ~$0.005 / 1k completion tokens. Higher than typical glm-4.7 pricing,
// so cap calculations are protective rather than under-charging.
const FALLBACK_PROMPT_MICRO_USD_PER_TOKEN = 1;
const FALLBACK_COMPLETION_MICRO_USD_PER_TOKEN = 5;

export interface ModelPricing {
	/** Cost in micro-USD per prompt (input) token. May be fractional. */
	promptMicroUsdPerToken: number;
	/** Cost in micro-USD per completion (output) token. May be fractional. */
	completionMicroUsdPerToken: number;
}

interface CacheEntry {
	pricing: ModelPricing;
	fetchedAtMs: number;
}

let cache: CacheEntry | null = null;

/**
 * Resolve the pricing for `model`. Returns the cached entry if still fresh,
 * otherwise fetches OpenRouter `/models`. Falls back to stale cache on
 * fetch failure, then to constants on cold-start failure.
 */
export async function getModelPricing(
	model: string = PINNED_MODEL,
	nowMs: number = Date.now(),
): Promise<ModelPricing> {
	if (cache && nowMs - cache.fetchedAtMs < CACHE_TTL_MS) {
		return cache.pricing;
	}

	try {
		const resp = await fetch(OPENROUTER_MODELS_URL, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!resp.ok) {
			throw new Error(`/models returned ${resp.status}`);
		}
		const data = (await resp.json()) as {
			data?: Array<{
				id?: string;
				pricing?: { prompt?: string; completion?: string };
			}>;
		};
		const entry = data.data?.find((m) => m.id === model);
		if (!entry?.pricing?.prompt || !entry.pricing.completion) {
			throw new Error(`pricing missing for model ${model}`);
		}
		const promptUsd = Number(entry.pricing.prompt);
		const completionUsd = Number(entry.pricing.completion);
		if (!Number.isFinite(promptUsd) || !Number.isFinite(completionUsd)) {
			throw new Error(`pricing parse failed for ${model}`);
		}
		const pricing: ModelPricing = {
			promptMicroUsdPerToken: promptUsd * 1e6,
			completionMicroUsdPerToken: completionUsd * 1e6,
		};
		cache = { pricing, fetchedAtMs: nowMs };
		return pricing;
	} catch {
		if (cache) return cache.pricing;
		return {
			promptMicroUsdPerToken: FALLBACK_PROMPT_MICRO_USD_PER_TOKEN,
			completionMicroUsdPerToken: FALLBACK_COMPLETION_MICRO_USD_PER_TOKEN,
		};
	}
}

/**
 * Compute the cost of a single completion in integer micro-USD. Always
 * rounds up so we never silently under-charge against the daily caps.
 */
export function computeCostMicroUsd(
	promptTokens: number,
	completionTokens: number,
	pricing: ModelPricing,
): number {
	return Math.ceil(
		promptTokens * pricing.promptMicroUsdPerToken +
			completionTokens * pricing.completionMicroUsdPerToken,
	);
}

/**
 * Test-only: seed or clear the in-process pricing cache so tests don't
 * have to mock the OpenRouter `/models` fetch. Pass `null` to clear.
 * `fetchedAtMs` defaults to "now" for an indefinitely-fresh entry.
 */
export function _setPricingCacheForTests(
	pricing: ModelPricing | null,
	fetchedAtMs: number = Date.now(),
): void {
	cache = pricing === null ? null : { pricing, fetchedAtMs };
}
