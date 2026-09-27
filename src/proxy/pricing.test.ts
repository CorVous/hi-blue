import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_setPricingCacheForTests,
	computeCostMicroUsd,
	getModelPricing,
	modelEndpointsUrl,
} from "./pricing";

const MODEL = "deepseek/deepseek-v4.1-flash";

interface PriceRow {
	prompt: string;
	completion: string;
}

function endpointsResponse(
	rows: Array<{ tag: string; overrides?: PriceRow[] } & PriceRow>,
) {
	return Promise.resolve(
		new Response(
			JSON.stringify({
				data: {
					id: MODEL,
					endpoints: rows.map((r) => ({
						tag: r.tag,
						pricing: {
							prompt: r.prompt,
							completion: r.completion,
							...(r.overrides !== undefined ? { overrides: r.overrides } : {}),
						},
					})),
				},
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
	it("fetches the model's endpoints, picks the pinned provider, and converts USD/token to micro-USD/token", async () => {
		const fetchMock = vi.fn().mockImplementation((url: string) => {
			expect(url).toBe(modelEndpointsUrl(MODEL));
			return endpointsResponse([
				{ tag: "cheap-host", prompt: "0.00000001", completion: "0.00000002" },
				{ tag: "deepseek", prompt: "0.0000001", completion: "0.0000005" },
			]);
		});
		vi.stubGlobal("fetch", fetchMock);

		const pricing = await getModelPricing(MODEL, Date.now(), "deepseek");
		expect(pricing.promptMicroUsdPerToken).toBeCloseTo(0.1, 10);
		expect(pricing.completionMicroUsdPerToken).toBeCloseTo(0.5, 10);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("charges the highest time-of-day override so peak hours are never under-charged", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				endpointsResponse([
					{
						tag: "deepseek",
						prompt: "0.00000015",
						completion: "0.0000006",
						overrides: [
							{ prompt: "0.00000015", completion: "0.0000006" },
							{ prompt: "0.0000003", completion: "0.0000012" },
						],
					},
				]),
			),
		);

		const pricing = await getModelPricing(MODEL, Date.now(), "deepseek");
		expect(pricing.promptMicroUsdPerToken).toBeCloseTo(0.3, 10);
		expect(pricing.completionMicroUsdPerToken).toBeCloseTo(1.2, 10);
	});

	it("falls back to the overestimated cold-start pricing when the pinned provider is missing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				endpointsResponse([
					{
						tag: "cheap-host",
						prompt: "0.00000001",
						completion: "0.00000002",
					},
				]),
			),
		);

		const pricing = await getModelPricing(MODEL, Date.now(), "deepseek");
		expect(pricing.promptMicroUsdPerToken).toBe(1);
		expect(pricing.completionMicroUsdPerToken).toBe(5);
	});

	it("memoises within the cache TTL — second call does not re-fetch", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation(() =>
				endpointsResponse([
					{ tag: "deepseek", prompt: "0.0000001", completion: "0.0000005" },
				]),
			);
		vi.stubGlobal("fetch", fetchMock);

		await getModelPricing(MODEL, Date.now(), "deepseek");
		await getModelPricing(MODEL, Date.now(), "deepseek");

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("returns stale cache if the endpoints fetch fails after a previous success", async () => {
		const fetchedAtEpochLongPastTtl = 0;
		_setPricingCacheForTests(
			{ promptMicroUsdPerToken: 0.25, completionMicroUsdPerToken: 0.75 },
			fetchedAtEpochLongPastTtl,
		);

		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);

		const pricing = await getModelPricing(MODEL);
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
		expect(cost).toBe(900);
	});

	it("rounds fractional totals up so we never under-charge", () => {
		const cost = computeCostMicroUsd(1, 1, {
			promptMicroUsdPerToken: 0.1,
			completionMicroUsdPerToken: 0.2,
		});
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
