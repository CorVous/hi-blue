/**
 * Tests for the OpenRouter /models price fetcher.
 *
 * Module-level cache is reset between tests via _setPricingCacheForTests(null).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_setPricingCacheForTests,
	computeCostMicroUsd,
	getModelPricing,
	OPENROUTER_MODELS_URL,
} from "./pricing";

const MODEL = "z-ai/glm-4.7";

function modelsResponse(
	rows: Array<{ id: string; prompt: string; completion: string }>,
) {
	return Promise.resolve(
		new Response(
			JSON.stringify({
				data: rows.map((r) => ({
					id: r.id,
					pricing: { prompt: r.prompt, completion: r.completion },
				})),
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		),
	);
}

beforeEach(() => {
	_setPricingCacheForTests(null);
});

afterEach(() => {
	vi.unstubAllGlobals();
	_setPricingCacheForTests(null);
});

describe("getModelPricing", () => {
	it("fetches /models, finds the pinned model, and converts USD/token to micro-USD/token", async () => {
		const fetchMock = vi.fn().mockImplementation((url: string) => {
			expect(url).toBe(OPENROUTER_MODELS_URL);
			return modelsResponse([
				{ id: "other/model", prompt: "0.0000005", completion: "0.000002" },
				{ id: MODEL, prompt: "0.0000001", completion: "0.0000005" },
			]);
		});
		vi.stubGlobal("fetch", fetchMock);

		const pricing = await getModelPricing(MODEL);
		expect(pricing.promptMicroUsdPerToken).toBeCloseTo(0.1, 10);
		expect(pricing.completionMicroUsdPerToken).toBeCloseTo(0.5, 10);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("memoises within the cache TTL — second call does not re-fetch", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(() =>
				modelsResponse([
					{ id: MODEL, prompt: "0.0000001", completion: "0.0000005" },
				]),
			);
		vi.stubGlobal("fetch", fetchMock);

		await getModelPricing(MODEL);
		await getModelPricing(MODEL);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns stale cache if /models fetch fails after a previous success", async () => {
		// Seed cache as if a previous successful fetch happened a long time ago
		_setPricingCacheForTests(
			{ promptMicroUsdPerToken: 0.25, completionMicroUsdPerToken: 0.75 },
			0, // ancient — past the TTL window
		);

		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);

		const pricing = await getModelPricing(MODEL);
		// Stale cache preferred over fallback constants
		expect(pricing.promptMicroUsdPerToken).toBe(0.25);
		expect(pricing.completionMicroUsdPerToken).toBe(0.75);
	});
});

describe("computeCostMicroUsd", () => {
	it("multiplies tokens by per-token price and rounds up", () => {
		const cost = computeCostMicroUsd(1500, 1500, {
			promptMicroUsdPerToken: 0.1,
			completionMicroUsdPerToken: 0.5,
		});
		// 1500*0.1 + 1500*0.5 = 150 + 750 = 900
		expect(cost).toBe(900);
	});

	it("rounds fractional totals up so we never under-charge", () => {
		const cost = computeCostMicroUsd(1, 1, {
			promptMicroUsdPerToken: 0.1,
			completionMicroUsdPerToken: 0.2,
		});
		// 0.1 + 0.2 = 0.3 → ceil → 1
		expect(cost).toBe(1);
	});

	it("returns 0 for zero tokens", () => {
		const cost = computeCostMicroUsd(0, 0, {
			promptMicroUsdPerToken: 1,
			completionMicroUsdPerToken: 1,
		});
		expect(cost).toBe(0);
	});
});
