import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type CostGuardConfig,
	configFromEnv,
	globalKey,
	ipRateLimitSubject,
	perIpKey,
	preCharge,
	rateLimitResponse,
	reconcile,
	refundFull,
	utcDateKey,
} from "./rate-guard";

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

const TIGHT_CAPS: CostGuardConfig = {
	perIpDailyMicroUsdMax: 10_000,
	globalDailyMicroUsdMax: 50_000,
	preChargeMicroUsd: 4_000,
};

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

describe("key shapes", () => {
	it("perIpKey uses cost: namespace", () => {
		expect(perIpKey("1.2.3.4", DAY1_MS)).toBe("cost:ip:2026-05-01:1.2.3.4");
	});

	it("globalKey uses cost: namespace", () => {
		expect(globalKey(DAY1_MS)).toBe("cost:global:2026-05-01");
	});
});

describe("preCharge — per-IP daily cap", () => {
	it("allows the first request (counter starts at 0)", async () => {
		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(true);
		if (result.allowed)
			expect(result.preCharged).toBe(TIGHT_CAPS.preChargeMicroUsd);
	});

	it("allows a request that lands exactly AT the cap", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(TIGHT_CAPS.perIpDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(true);
	});

	it("denies a request that would cross just over the cap", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(
				TIGHT_CAPS.perIpDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd + 1,
			),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("per-ip-daily");
	});

	it("does not increment global counter on per-IP denial", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(
				TIGHT_CAPS.perIpDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd + 1,
			),
			{ expirationTtl: 25 * 3600 },
		);

		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		const gK = globalKey(DAY1_MS);
		const globalVal = await kv().get(gK);
		expect(globalVal).toBeNull();
	});

	it("isolates different IPs — IP B can still charge when IP A is capped", async () => {
		const ipK = perIpKey("1.1.1.1", DAY1_MS);
		await kv().put(
			ipK,
			String(
				TIGHT_CAPS.perIpDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd + 1,
			),
			{ expirationTtl: 25 * 3600 },
		);

		const resultA = await preCharge(kv(), "1.1.1.1", DAY1_MS, TIGHT_CAPS);
		const resultB = await preCharge(kv(), "2.2.2.2", DAY1_MS, TIGHT_CAPS);

		expect(resultA.allowed).toBe(false);
		expect(resultB.allowed).toBe(true);
	});

	it("resets on a new UTC day (different day key)", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(ipK, String(TIGHT_CAPS.perIpDailyMicroUsdMax), {
			expirationTtl: 25 * 3600,
		});

		const result = await preCharge(kv(), "1.2.3.4", DAY2_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(true);
	});
});

describe("preCharge — global daily cap", () => {
	it("denies when global cap would be crossed", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(
				TIGHT_CAPS.globalDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd + 1,
			),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("global-daily");
	});

	it("allows when global counter lands exactly at cap", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(TIGHT_CAPS.globalDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(true);
	});

	it("per-IP cap fires before global cap is checked", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(
			ipK,
			String(
				TIGHT_CAPS.perIpDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd + 1,
			),
			{ expirationTtl: 25 * 3600 },
		);
		const gK = globalKey(DAY1_MS);
		await kv().put(
			gK,
			String(
				TIGHT_CAPS.globalDailyMicroUsdMax - TIGHT_CAPS.preChargeMicroUsd + 1,
			),
			{ expirationTtl: 25 * 3600 },
		);

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toBe("per-ip-daily");
	});

	it("resets on a new UTC day", async () => {
		const gK = globalKey(DAY1_MS);
		await kv().put(gK, String(TIGHT_CAPS.globalDailyMicroUsdMax), {
			expirationTtl: 25 * 3600,
		});

		const result = await preCharge(kv(), "1.2.3.4", DAY2_MS, TIGHT_CAPS);
		expect(result.allowed).toBe(true);
	});
});

describe("reconcile", () => {
	it("refunds the delta on both counters when actual < preCharged (under-charge)", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		const actualCostMicroUsd = 1500;
		await reconcile(
			kv(),
			"1.2.3.4",
			DAY1_MS,
			TIGHT_CAPS.preChargeMicroUsd,
			actualCostMicroUsd,
		);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);

		expect(Number(ipVal)).toBe(1500);
		expect(Number(gVal)).toBe(1500);
	});

	it("is a no-op when actual === preCharged", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const before = await kv().get(ipK);

		await reconcile(
			kv(),
			"1.2.3.4",
			DAY1_MS,
			TIGHT_CAPS.preChargeMicroUsd,
			TIGHT_CAPS.preChargeMicroUsd,
		);

		const after = await kv().get(ipK);
		expect(after).toBe(before);
	});

	it("charges the overage to both counters when actual > preCharged", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		await reconcile(
			kv(),
			"1.2.3.4",
			DAY1_MS,
			TIGHT_CAPS.preChargeMicroUsd,
			9000,
		);

		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey("1.2.3.4", DAY1_MS)),
			kv().get(globalKey(DAY1_MS)),
		]);
		expect(Number(ipVal)).toBe(9000);
		expect(Number(gVal)).toBe(9000);
	});

	it("an overage pushes the counter past the cap so the next request is denied", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		await reconcile(
			kv(),
			"1.2.3.4",
			DAY1_MS,
			TIGHT_CAPS.preChargeMicroUsd,
			TIGHT_CAPS.perIpDailyMicroUsdMax,
		);

		const next = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);
		expect(next).toEqual({ allowed: false, reason: "per-ip-daily" });
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

describe("corrupt KV counters", () => {
	it("denies a request when the per-IP counter is not a number", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		await kv().put(ipK, "NaN", { expirationTtl: 25 * 3600 });

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		expect(result).toEqual({ allowed: false, reason: "per-ip-daily" });
		expect(await kv().get(ipK)).toBe("NaN");
		expect(await kv().get(globalKey(DAY1_MS))).toBeNull();
	});

	it("denies a request when the global counter is not a number", async () => {
		await kv().put(globalKey(DAY1_MS), "garbage", {
			expirationTtl: 25 * 3600,
		});

		const result = await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		expect(result).toEqual({ allowed: false, reason: "global-daily" });
		expect(await kv().get(perIpKey("1.2.3.4", DAY1_MS))).toBeNull();
	});

	it("reconcile never writes a non-numeric value back", async () => {
		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		await Promise.all([
			kv().put(ipK, "NaN", { expirationTtl: 25 * 3600 }),
			kv().put(gK, "8000", { expirationTtl: 25 * 3600 }),
		]);

		await reconcile(kv(), "1.2.3.4", DAY1_MS, 4000, 1000);

		expect(await kv().get(ipK)).toBe("NaN");
		expect(await kv().get(gK)).toBe("5000");
	});

	it("reconcile ignores a non-finite actual cost", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		await reconcile(kv(), "1.2.3.4", DAY1_MS, 4000, Number.NaN);

		expect(await kv().get(perIpKey("1.2.3.4", DAY1_MS))).toBe("4000");
	});
});

describe("ipRateLimitSubject", () => {
	it("keeps an IPv4 address as-is", () => {
		expect(ipRateLimitSubject("203.0.113.9")).toBe("203.0.113.9");
	});

	it("keys a full IPv6 address by its /64 prefix", () => {
		expect(ipRateLimitSubject("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe(
			"2001:db8:1:2::/64",
		);
	});

	it("expands :: before taking the /64 prefix", () => {
		expect(ipRateLimitSubject("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(ipRateLimitSubject("2001:DB8:1:2::")).toBe("2001:db8:1:2::/64");
		expect(ipRateLimitSubject("::1")).toBe("0:0:0:0::/64");
	});

	it("keys an IPv4-mapped IPv6 address by its IPv4 address", () => {
		expect(ipRateLimitSubject("::ffff:203.0.113.9")).toBe("203.0.113.9");
	});

	it("keeps an unparseable value as-is", () => {
		expect(ipRateLimitSubject("1::2::3")).toBe("1::2::3");
		expect(ipRateLimitSubject("unknown")).toBe("unknown");
	});

	it("perIpKey shares one key across a /64 and separates different /64s", () => {
		expect(perIpKey("2001:db8:1:2::1", DAY1_MS)).toBe(
			perIpKey("2001:db8:1:2:ffff::9", DAY1_MS),
		);
		expect(perIpKey("2001:db8:1:2::1", DAY1_MS)).not.toBe(
			perIpKey("2001:db8:1:3::1", DAY1_MS),
		);
	});
});

describe("refundFull", () => {
	it("refunds the entire preCharge from both counters", async () => {
		await preCharge(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS);

		await refundFull(kv(), "1.2.3.4", DAY1_MS, TIGHT_CAPS.preChargeMicroUsd);

		const ipK = perIpKey("1.2.3.4", DAY1_MS);
		const gK = globalKey(DAY1_MS);
		const [ipVal, gVal] = await Promise.all([kv().get(ipK), kv().get(gK)]);

		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});

	it("only refunds the specific IP — other IPs are unaffected", async () => {
		await preCharge(kv(), "1.1.1.1", DAY1_MS, TIGHT_CAPS);
		await preCharge(kv(), "2.2.2.2", DAY1_MS, TIGHT_CAPS);

		await refundFull(kv(), "1.1.1.1", DAY1_MS, TIGHT_CAPS.preChargeMicroUsd);

		const ipK_B = perIpKey("2.2.2.2", DAY1_MS);
		const ipVal_B = await kv().get(ipK_B);

		expect(Number(ipVal_B)).toBe(TIGHT_CAPS.preChargeMicroUsd);
	});
});

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

describe("configFromEnv defaults", () => {
	it("falls back to exact integer micro-USD defaults so KV counters stay integral", () => {
		const cfg = configFromEnv({});
		expect(cfg).toEqual({
			perIpDailyMicroUsdMax: 1_000_000,
			globalDailyMicroUsdMax: 10_000_000,
			preChargeMicroUsd: 5_000,
		});
		for (const value of Object.values(cfg)) {
			expect(Number.isInteger(value)).toBe(true);
		}
	});

	it("falls back to the defaults when env values are not finite non-negative numbers", () => {
		const cfg = configFromEnv({
			PER_IP_DAILY_MICRO_USD_MAX: "one dollar",
			GLOBAL_DAILY_MICRO_USD_MAX: "",
			PRE_CHARGE_MICRO_USD: "-5",
		});
		expect(cfg).toEqual({
			perIpDailyMicroUsdMax: 1_000_000,
			globalDailyMicroUsdMax: 10_000_000,
			preChargeMicroUsd: 5_000,
		});
	});

	it("uses valid env values", () => {
		expect(
			configFromEnv({
				PER_IP_DAILY_MICRO_USD_MAX: "20000",
				GLOBAL_DAILY_MICRO_USD_MAX: "1000000",
				PRE_CHARGE_MICRO_USD: "4000",
			}),
		).toEqual({
			perIpDailyMicroUsdMax: 20_000,
			globalDailyMicroUsdMax: 1_000_000,
			preChargeMicroUsd: 4_000,
		});
	});
});
