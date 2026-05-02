import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { checkAndCharge, type RateGuardConfig } from "./rate-guard";

/**
 * Tests for the rate-guard module.
 *
 * The KV namespace used here is `RATE_GUARD_KV` — bound in wrangler.jsonc.
 * Tests run inside @cloudflare/vitest-pool-workers, so `env.RATE_GUARD_KV`
 * is a real (in-process) KV implementation — no mocks needed.
 */

const BASE_CFG: RateGuardConfig = {
	rateLimitMax: 5,
	rateLimitWindowSec: 60,
	estimatedCostPerRequest: 1,
	dailyCapMax: 10,
};

const NOW = new Date("2026-05-01T12:00:00Z").getTime();

function kv(): KVNamespace {
	return (env as Record<string, KVNamespace>).RATE_GUARD_KV as KVNamespace;
}

// Clear KV state before each test so tests are independent
beforeEach(async () => {
	const ns = kv();
	// List and delete all keys — vitest-pool-workers KV is ephemeral per-run
	// but we share the same namespace across tests in a file, so wipe manually.
	const listed = await ns.list();
	await Promise.all(listed.keys.map((k) => ns.delete(k.name)));
});

describe("per-IP rate-limit", () => {
	it("allows up to rateLimitMax requests", async () => {
		for (let i = 0; i < BASE_CFG.rateLimitMax; i++) {
			const result = await checkAndCharge(kv(), "1.2.3.4", NOW, BASE_CFG);
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks the request at exactly rateLimitMax+1 (just over)", async () => {
		for (let i = 0; i < BASE_CFG.rateLimitMax; i++) {
			await checkAndCharge(kv(), "1.2.3.4", NOW, BASE_CFG);
		}
		const result = await checkAndCharge(kv(), "1.2.3.4", NOW, BASE_CFG);
		expect(result.allowed).toBe(false);
		expect(result.allowed === false && result.reason).toBe("rate-limit");
	});

	it("allows exactly rateLimitMax-1 then the Max-th (just under border)", async () => {
		for (let i = 0; i < BASE_CFG.rateLimitMax - 1; i++) {
			const result = await checkAndCharge(kv(), "1.2.3.4", NOW, BASE_CFG);
			expect(result.allowed).toBe(true);
		}
		// The max-th request should also be allowed
		const result = await checkAndCharge(kv(), "1.2.3.4", NOW, BASE_CFG);
		expect(result.allowed).toBe(true);
	});

	it("refills tokens after the window elapses", async () => {
		// Exhaust the bucket
		for (let i = 0; i < BASE_CFG.rateLimitMax; i++) {
			await checkAndCharge(kv(), "1.2.3.4", NOW, BASE_CFG);
		}
		// After a full window, bucket should be full again
		const future = NOW + BASE_CFG.rateLimitWindowSec * 1000;
		const result = await checkAndCharge(kv(), "1.2.3.4", future, BASE_CFG);
		expect(result.allowed).toBe(true);
	});

	it("rate-limits only the specific IP, not others", async () => {
		// Exhaust IP A
		for (let i = 0; i < BASE_CFG.rateLimitMax; i++) {
			await checkAndCharge(kv(), "1.1.1.1", NOW, BASE_CFG);
		}
		// IP B should still be allowed
		const result = await checkAndCharge(kv(), "2.2.2.2", NOW, BASE_CFG);
		expect(result.allowed).toBe(true);
	});

	it("confirms no daily-cap increment happens when rate-limited", async () => {
		const singleUnitCfg: RateGuardConfig = {
			...BASE_CFG,
			rateLimitMax: 1,
			dailyCapMax: 100,
		};
		// First request passes and increments daily spend by 1
		await checkAndCharge(kv(), "1.2.3.4", NOW, singleUnitCfg);
		// Second request is rate-limited
		await checkAndCharge(kv(), "1.2.3.4", NOW, singleUnitCfg);

		// Daily spend should be 1 (only the first request counted)
		const dayKey = `daily:2026-05-01`;
		const spend = await kv().get(dayKey);
		expect(Number(spend)).toBe(1);
	});
});

describe("global daily cap", () => {
	it("allows requests up to the daily cap", async () => {
		for (let i = 0; i < BASE_CFG.dailyCapMax; i++) {
			// Use different IPs to avoid rate-limit interference
			const result = await checkAndCharge(kv(), `10.0.0.${i % 255}`, NOW, {
				...BASE_CFG,
				rateLimitMax: 999,
			});
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks once the daily cap is reached", async () => {
		const cfg: RateGuardConfig = {
			...BASE_CFG,
			rateLimitMax: 999,
			dailyCapMax: 3,
			estimatedCostPerRequest: 1,
		};
		for (let i = 0; i < 3; i++) {
			await checkAndCharge(kv(), `10.0.0.${i}`, NOW, cfg);
		}
		const result = await checkAndCharge(kv(), "10.0.0.99", NOW, cfg);
		expect(result.allowed).toBe(false);
		expect(result.allowed === false && result.reason).toBe("daily-cap");
	});

	it("blocks exactly at cap (just over)", async () => {
		const cfg: RateGuardConfig = {
			...BASE_CFG,
			rateLimitMax: 999,
			dailyCapMax: 2,
			estimatedCostPerRequest: 1,
		};
		await checkAndCharge(kv(), "10.0.0.1", NOW, cfg);
		await checkAndCharge(kv(), "10.0.0.2", NOW, cfg);
		// cap exactly hit — next one is over
		const result = await checkAndCharge(kv(), "10.0.0.3", NOW, cfg);
		expect(result.allowed).toBe(false);
		expect(result.allowed === false && result.reason).toBe("daily-cap");
	});

	it("resets the counter on the next UTC day", async () => {
		const cfg: RateGuardConfig = {
			...BASE_CFG,
			rateLimitMax: 999,
			dailyCapMax: 1,
			estimatedCostPerRequest: 1,
		};
		// Exhaust today's cap
		await checkAndCharge(kv(), "10.0.0.1", NOW, cfg);

		// Tomorrow
		const tomorrow = new Date("2026-05-02T00:00:01Z").getTime();
		const result = await checkAndCharge(kv(), "10.0.0.1", tomorrow, cfg);
		expect(result.allowed).toBe(true);
	});

	it("confirms no provider call is made when daily-capped (guard short-circuits)", async () => {
		// This is the programmatic equivalent: checkAndCharge must return
		// allowed:false BEFORE any provider would be invoked.
		// We verify the daily cap key is at max and the result is denied.
		const cfg: RateGuardConfig = {
			...BASE_CFG,
			rateLimitMax: 999,
			dailyCapMax: 2,
			estimatedCostPerRequest: 1,
		};
		await checkAndCharge(kv(), "10.0.0.1", NOW, cfg);
		await checkAndCharge(kv(), "10.0.0.2", NOW, cfg);

		const result = await checkAndCharge(kv(), "10.0.0.3", NOW, cfg);
		// If the guard passes, the caller would have invoked the provider.
		// It must not pass.
		expect(result.allowed).toBe(false);
	});
});
