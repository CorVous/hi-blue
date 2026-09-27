import { PINNED_MODEL, PINNED_PROVIDER } from "../model.js";

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export function modelEndpointsUrl(model: string): string {
	return `${OPENROUTER_MODELS_URL}/${model}/endpoints`;
}

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

interface EndpointPriceRow {
	prompt?: string;
	completion?: string;
}

interface EndpointRow {
	tag?: string;
	pricing?: EndpointPriceRow & { overrides?: EndpointPriceRow[] };
}

let isolatePricingCache: PricingCacheEntry | null = null;

function usdPerToken(value: string | undefined): number {
	const parsed = Number(value);
	return value !== undefined && value !== "" && Number.isFinite(parsed)
		? parsed
		: Number.NaN;
}

function peakPricing(endpoint: EndpointRow): ModelPricing {
	const rows = [endpoint.pricing ?? {}, ...(endpoint.pricing?.overrides ?? [])];
	const promptUsd = Math.max(...rows.map((r) => usdPerToken(r.prompt)));
	const completionUsd = Math.max(...rows.map((r) => usdPerToken(r.completion)));
	if (!Number.isFinite(promptUsd) || !Number.isFinite(completionUsd)) {
		throw new Error("pricing parse failed");
	}
	return {
		promptMicroUsdPerToken: promptUsd * USD_TO_MICRO_USD,
		completionMicroUsdPerToken: completionUsd * USD_TO_MICRO_USD,
	};
}

export async function getModelPricing(
	model: string = PINNED_MODEL,
	nowMs: number = Date.now(),
	provider: string = PINNED_PROVIDER,
): Promise<ModelPricing> {
	if (
		isolatePricingCache &&
		nowMs - isolatePricingCache.fetchedAtMs < PRICING_CACHE_TTL_MS
	) {
		return isolatePricingCache.pricing;
	}

	try {
		const resp = await fetch(modelEndpointsUrl(model), {
			signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
		});
		if (!resp.ok) {
			throw new Error(`/endpoints returned ${resp.status}`);
		}
		const data = (await resp.json()) as {
			data?: { endpoints?: EndpointRow[] };
		};
		const endpoint = data.data?.endpoints?.find((e) => e.tag === provider);
		if (endpoint === undefined) {
			throw new Error(`no ${provider} endpoint for model ${model}`);
		}
		const pricing = peakPricing(endpoint);
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
