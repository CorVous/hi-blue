import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
	globalKey,
	perIpKey,
	preCharge,
	rateLimitResponse,
	reconcile,
	refundFull,
	type TokenGuardConfig,
	utcDateKey,
} from "./rate-guard";

/**
 * Tests for the token-denominated rate-guard (issue #37).
 *
 * The KV namespace used here is `RATE_GUARD_KV` — bound in wrangler.jsonc.
 * Tests run inside @cloudflare/vitest-pool-workers, so `env.RATE_GUARD_KV`
 * is a real (in-process) KV implementation — no mocks needed.
 */

function kv(): KVNamespace {
	return (env as Record<string, KVNamespace>).RATE_GUARD_KV as KVNamespace;
}

// Clear KV state before each test so tests are independent
beforeEach(async () => {
	const ns = kv();
	const listed = await ns.list();
	await Promise.all(listed.keys.map((k) => ns.delete(k.name)));
});

// Fixed timestamps for deterministic UTC-day keys
const DAY1_MS = new Date("2026-05-01T12:00:00Z").getTime();
const DAY2_MS = new Date("2026-05-02T00:00:01Z").getTime();

// Tight caps for test speed
const CFG: TokenGuardConfig = {
	perIpDailyTokenMax: 10_000,
	globalDailyTokenMax: 50_000,
	preChargeEstimate: 4_000,
};

// ── utcDateKey ────────────────────────────────────────────────────────────────

describe("utcDateKey", () => {
	it("formats a UTC timestamp as YYYY-MM-DD", () => {
		expect(utcDateKey(DAY1_MS)).toBe("2026-05-01");
	});

	it("returns a different key for a different UTC day", () => {
		expect(utcDateKey(DAY1_MS)).not.toBe(utcDateKey(DAY2_MS));
	});

	it("handles the UTC midnight boundary", () => {
		const justBefore = new Date("2026-05-01T23:59:59.999Z").getTime();
		const justAfter = new Date("2026-05-02T00:00:00.000Z").getTime();
		expect(utcDateKey(justBefore)).toBe("2026-05-01");
		expect(utcDateKey(justAfter)).toBe("2026-05-02");
	});
});

// ── preCharge — per-IP ────────────────────────────────────────────────────────

describe("preCharge — per-IP daily cap", () => {
	it("allows the first request (counter starts at 0)", async () => {
		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(true);
		if (result.allowed) expect(result.preCharged).toBe(CFG.preChargeEstimate);
	});

	it("allows a request that lands exactly AT the cap (current + estimate === cap)", async () => {
		// Seed counter to cap - estimate so next preCharge lands exactly at cap
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyTokenMax - CFG.preChargeEstimate),
			{
				expirationTtl: 25 * 3600,
			},
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(true);
	});

	it("denies a request that would cross just over the cap", async () => {
		// Seed counter to (cap - estimate + 1) so next preCharge crosses cap
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyTokenMax - CFG.preChargeEstimate + 1),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("per-ip-daily");
	});

	it("does not increment global counter on per-IP denial", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyTokenMax - CFG.preChargeEstimate + 1),
			{ expirationTtl: 25 * 3600 },
		);

		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		const gK = globalKey(DAY1_MS);
		const globalVal = await kv().get(gK);
		// Global counter must remain untouched
		expect(globalVal).toBeNull();
	});

	it("isolates different IPs — IP B can still charge when IP A is capped", async () => {
		const ipK = perIpKey("1.1.1.1", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyTokenMax - CFG.preChargeEstimate + 1),
			{ expirationTtl: 25 * 3600 },
		);

		const resultA = await preCharge(kv(), "1.1.1.1", DAY1_MS, CFG);
		const resultB = await preCharge(kv(), "2.2.2.2", DAY1_MS, CFG);

		expect(resultA.allowed).toBe(false);
		expect(resultB.allowed).toBe(true);
	});

	it("resets on a new UTC day (different day key)", async () => {
		// Exhaust IP on day 1
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(ipK, String(CFG.perIpDailyTokenMax), {
			expirationTtl: 25 * 3600,
		});

		// Day 2 has a fresh counter
		const result = await preCharge(kv(), "1.2.3.4", DAY2_MS, CFG);
		expect(result.allowed).toBe(true);
	});
});

// ── preCharge — global daily cap ──────────────────────────────────────────────

describe("preCharge — global daily cap", () => {
	it("denies when global cap would be crossed", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(CFG.globalDailyTokenMax - CFG.preChargeEstimate + 1),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("global-daily");
	});

	it("allows when global counter lands exactly at cap", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(CFG.globalDailyTokenMax - CFG.preChargeEstimate),
			{
				expirationTtl: 25 * 3600,
			},
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(true);
	});

	it("per-IP cap fires before global cap is checked", async () => {
		// Set per-IP just over and global just over
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyTokenMax - CFG.preChargeEstimate + 1),
			{ expirationTtl: 25 * 3600 },
		);
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(CFG.globalDailyTokenMax - CFG.preChargeEstimate + 1),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		// Should be per-ip-daily because per-IP is checked first
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("per-ip-daily");
	});

	it("resets on a new UTC day", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(gK, String(CFG.globalDailyTokenMax), {
			expirationTtl: 25 * 3600,
		});

		const result = await preCharge(kv(), "1.2.3.4", DAY2_MS, CFG);
		expect(result.allowed).toBe(true);
	});
});

// ── reconcile ─────────────────────────────────────────────────────────────────

describe("reconcile", () => {
	it("refunds the delta on both counters when actual < preCharged (under-charge)", async () => {
		// First preCharge sets counters to preChargeEstimate (4000)
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		// Actual usage was 1500 — under-charged by 2500
		await reconcile(kv(), "1.2.3.4", DAY1_MS, CFG.preChargeEstimate, 1500);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);

		expect(Number(ipVal)).toBe(1500);
		expect(Number(gVal)).toBe(1500);
	});

	it("is a no-op when actual === preCharged (exact match)", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		// Record value before reconcile
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const before = await kv().get(ipK);

		await reconcile(
			kv(),
			"1.2.3.4",
			DAY1_MS,
			CFG.preChargeEstimate,
			CFG.preChargeEstimate,
		);

		const after = await kv().get(ipK);
		expect(after).toBe(before);
	});

	it("is a no-op when actual > preCharged (over-charge — accepted as defense cost)", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const before = await kv().get(ipK);

		// Over-charge: actual = 9000 (estimate was 4000)
		await reconcile(kv(), "1.2.3.4", DAY1_MS, CFG.preChargeEstimate, 9000);

		const after = await kv().get(ipK);
		// Counter must NOT change (no additional debit)
		expect(after).toBe(before);
	});

	it("never refunds below zero even if actual < 0 (edge case)", async () => {
		// Seed a very small counter value (e.g., 100 tokens)
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		await Promise.all([
			kv().put(ipK, "100", { expirationTtl: 25 * 3600 }),
			kv().put(gK, "100", { expirationTtl: 25 * 3600 }),
		]);

		// preCharged=4000, actual=0 → delta=-4000, but counter is only 100
		await reconcile(kv(), "1.2.3.4", DAY1_MS, 4000, 0);

		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);
		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});
});

// ── refundFull ────────────────────────────────────────────────────────────────

describe("refundFull", () => {
	it("refunds the entire preCharge from both counters", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		await refundFull(kv(), "1.2.3.4", DAY1_MS, CFG.preChargeEstimate);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);

		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});

	it("only refunds the specific IP — other IPs are unaffected", async () => {
		// Both IPs pre-charge
		await preCharge(kv(), "1.1.1.1", DAY1_MS, CFG);
		await preCharge(kv(), "2.2.2.2", DAY1_MS, CFG);

		// Only refund IP A
		await refundFull(kv(), "1.1.1.1", DAY1_MS, CFG.preChargeEstimate);

		const ipK_B = perIpKey("2.2.2.2", DAY1_MS);
		const ipVal_B = await kv().get(ipK_B);

		// IP B's counter should still reflect its own pre-charge
		expect(Number(ipVal_B)).toBe(CFG.preChargeEstimate);
	});
});

// ── rateLimitResponse ─────────────────────────────────────────────────────────

describe("rateLimitResponse", () => {
	it("returns status 429", () => {
		const resp = rateLimitResponse("per-ip-daily", DAY1_MS);
		expect(resp.status).toBe(429);
	});

	it("returns Content-Type: application/json", () => {
		const resp = rateLimitResponse("global-daily", DAY1_MS);
		expect(resp.headers.get("Content-Type")).toContain("application/json");
	});

	it("body has the OpenAI-shaped error with type rate_limit_exceeded and code per-ip-daily", async () => {
		const resp = rateLimitResponse("per-ip-daily", DAY1_MS);
		const body = (await resp.json()) as {
			error: { type: string; code: string; message: string };
		};
		expect(body.error.type).toBe("rate_limit_exceeded");
		expect(body.error.code).toBe("per-ip-daily");
		expect(typeof body.error.message).toBe("string");
		expect(body.error.message.length).toBeGreaterThan(0);
	});

	it("body has the OpenAI-shaped error with type rate_limit_exceeded and code global-daily", async () => {
		const resp = rateLimitResponse("global-daily", DAY1_MS);
		const body = (await resp.json()) as {
			error: { type: string; code: string };
		};
		expect(body.error.type).toBe("rate_limit_exceeded");
		expect(body.error.code).toBe("global-daily");
	});

	it("Retry-After header is a positive integer (seconds until next UTC midnight)", () => {
		const resp = rateLimitResponse("per-ip-daily", DAY1_MS);
		const retryAfter = Number(resp.headers.get("Retry-After"));
		expect(Number.isInteger(retryAfter)).toBe(true);
		expect(retryAfter).toBeGreaterThan(0);
		// Should be at most 24h = 86400 seconds
		expect(retryAfter).toBeLessThanOrEqual(86400);
	});
});
