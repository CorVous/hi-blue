import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type CostGuardConfig,
	globalKey,
	perIpKey,
	preCharge,
	rateLimitResponse,
	reconcile,
	refundFull,
	utcDateKey,
} from "./rate-guard";

/**
 * Tests for the cost-denominated rate-guard (units: micro-USD).
 *
 * The KV namespace used here is `RATE_GUARD_KV` — bound in wrangler.jsonc.
 * Tests run inside @cloudflare/vitest-pool-workers, so `env.RATE_GUARD_KV`
 * is a real (in-process) KV implementation — no mocks needed.
 */

function kv(): KVNamespace {
	return (env as Record<string, KVNamespace>).RATE_GUARD_KV as KVNamespace;
}

beforeEach(async () => {
	const ns = kv();
	const listed = await ns.list();
	await Promise.all(listed.keys.map((k) => ns.delete(k.name)));
});

const DAY1_MS = new Date("2026-05-01T12:00:00Z").getTime();
const DAY2_MS = new Date("2026-05-02T00:00:01Z").getTime();

// Tight caps for test speed. Values are in micro-USD; the math is the same
// shape as the previous token-denominated guard so the assertions still hold.
const CFG: CostGuardConfig = {
	perIpDailyMicroUsdMax: 10_000,
	globalDailyMicroUsdMax: 50_000,
	preChargeMicroUsd: 4_000,
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

// ── key shapes ────────────────────────────────────────────────────────────────

describe("key shapes", () => {
	it("perIpKey uses cost: namespace", () => {
		expect(perIpKey("1.2.3.4", DAY1_MS)).toBe("cost:ip:2026-05-01:1.2.3.4");
	});

	it("globalKey uses cost: namespace", () => {
		expect(globalKey(DAY1_MS)).toBe("cost:global:2026-05-01");
	});
});

// ── preCharge — per-IP ────────────────────────────────────────────────────────

describe("preCharge — per-IP daily cap", () => {
	it("allows the first request (counter starts at 0)", async () => {
		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(true);
		if (result.allowed) expect(result.preCharged).toBe(CFG.preChargeMicroUsd);
	});

	it("allows a request that lands exactly AT the cap", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyMicroUsdMax - CFG.preChargeMicroUsd),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(true);
	});

	it("denies a request that would cross just over the cap", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyMicroUsdMax - CFG.preChargeMicroUsd + 1),
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
			String(CFG.perIpDailyMicroUsdMax - CFG.preChargeMicroUsd + 1),
			{ expirationTtl: 25 * 3600 },
		);

		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		const gK = globalKey(DAY1_MS);
		const globalVal = await kv().get(gK);
		expect(globalVal).toBeNull();
	});

	it("isolates different IPs — IP B can still charge when IP A is capped", async () => {
		const ipK = perIpKey("1.1.1.1", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyMicroUsdMax - CFG.preChargeMicroUsd + 1),
			{ expirationTtl: 25 * 3600 },
		);

		const resultA = await preCharge(kv(), "1.1.1.1", DAY1_MS, CFG);
		const resultB = await preCharge(kv(), "2.2.2.2", DAY1_MS, CFG);

		expect(resultA.allowed).toBe(false);
		expect(resultB.allowed).toBe(true);
	});

	it("resets on a new UTC day (different day key)", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(ipK, String(CFG.perIpDailyMicroUsdMax), {
			expirationTtl: 25 * 3600,
		});

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
			String(CFG.globalDailyMicroUsdMax - CFG.preChargeMicroUsd + 1),
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
			String(CFG.globalDailyMicroUsdMax - CFG.preChargeMicroUsd),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(true);
	});

	it("per-IP cap fires before global cap is checked", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(CFG.perIpDailyMicroUsdMax - CFG.preChargeMicroUsd + 1),
			{ expirationTtl: 25 * 3600 },
		);
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(CFG.globalDailyMicroUsdMax - CFG.preChargeMicroUsd + 1),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("per-ip-daily");
	});

	it("resets on a new UTC day", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(gK, String(CFG.globalDailyMicroUsdMax), {
			expirationTtl: 25 * 3600,
		});

		const result = await preCharge(kv(), "1.2.3.4", DAY2_MS, CFG);
		expect(result.allowed).toBe(true);
	});
});

// ── reconcile ─────────────────────────────────────────────────────────────────

describe("reconcile", () => {
	it("refunds the delta on both counters when actual < preCharged (under-charge)", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		// Actual cost was 1500 micro-USD — under-charged by 2500
		await reconcile(kv(), "1.2.3.4", DAY1_MS, CFG.preChargeMicroUsd, 1500);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);

		expect(Number(ipVal)).toBe(1500);
		expect(Number(gVal)).toBe(1500);
	});

	it("is a no-op when actual === preCharged", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const before = await kv().get(ipK);

		await reconcile(
			kv(),
			"1.2.3.4",
			DAY1_MS,
			CFG.preChargeMicroUsd,
			CFG.preChargeMicroUsd,
		);

		const after = await kv().get(ipK);
		expect(after).toBe(before);
	});

	it("is a no-op when actual > preCharged (over-charge — accepted as defense cost)", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, CFG);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const before = await kv().get(ipK);

		await reconcile(kv(), "1.2.3.4", DAY1_MS, CFG.preChargeMicroUsd, 9000);

		const after = await kv().get(ipK);
		expect(after).toBe(before);
	});

	it("never refunds below zero even if actual < 0 (edge case)", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		await Promise.all([
			kv().put(ipK, "100", { expirationTtl: 25 * 3600 }),
			kv().put(gK, "100", { expirationTtl: 25 * 3600 }),
		]);

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

		await refundFull(kv(), "1.2.3.4", DAY1_MS, CFG.preChargeMicroUsd);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);

		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});

	it("only refunds the specific IP — other IPs are unaffected", async () => {
		await preCharge(kv(), "1.1.1.1", DAY1_MS, CFG);
		await preCharge(kv(), "2.2.2.2", DAY1_MS, CFG);

		await refundFull(kv(), "1.1.1.1", DAY1_MS, CFG.preChargeMicroUsd);

		const ipK_B = perIpKey("2.2.2.2", DAY1_MS);
		const ipVal_B = await kv().get(ipK_B);

		expect(Number(ipVal_B)).toBe(CFG.preChargeMicroUsd);
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
		expect(retryAfter).toBeLessThanOrEqual(86400);
	});
});
