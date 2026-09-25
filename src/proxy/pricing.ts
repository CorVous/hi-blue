import { PINNED_MODEL } from "../model.js";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export const USD_TO_MICRO_USD = 1_000_000;

const PRICING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MODELS_FETCH_TIMEOUT_MS = 3_000;

export interface ModelPricing {
	promptMicroUsdPerToken: number;
	completionMicroUsdPerToken: number;
}

const OVERESTIMATED_COLD_START_PRICING: ModelPricing = {
	promptMicroUsdPerToken: 1,
	completionMicroUsdPerToken: 5,
};

interface PricingCacheEntry {
	pricing: ModelPricing;
	fetchedAtMs: number;
}

let isolatePricingCache: PricingCacheEntry | null = null;

export async function getModelPricing(
	model: string = PINNED_MODEL,
	nowMs: number = Date.now(),
): Promise<ModelPricing> {
	if (
		isolatePricingCache &&
		nowMs - isolatePricingCache.fetchedAtMs < PRICING_CACHE_TTL_MS
	) {
		return isolatePricingCache.pricing;
	}

	try {
		const resp = await fetch(OPENROUTER_MODELS_URL, {
			signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
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
			promptMicroUsdPerToken: promptUsd * USD_TO_MICRO_USD,
			completionMicroUsdPerToken: completionUsd * USD_TO_MICRO_USD,
		};
		isolatePricingCache = { pricing, fetchedAtMs: nowMs };
		return pricing;
	} catch {
		const stalePricing = isolatePricingCache?.pricing;
		return stalePricing ?? OVERESTIMATED_COLD_START_PRICING;
	}
}

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

export function _setPricingCacheForTests(
	pricing: ModelPricing | null,
	fetchedAtMs: number = Date.now(),
): void {
	isolatePricingCache = pricing === null ? null : { pricing, fetchedAtMs };
}
