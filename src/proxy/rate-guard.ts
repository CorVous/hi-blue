/**
 * Server-side wallet protection for the LLM proxy.
 *
 * Two independent cost-denominated guards (units: micro-USD; 1 USD = 1e6
 * micro-USD), both backed by Workers KV:
 *
 * 1. Per-IP daily cost cap
 *    Key: `cost:ip:<YYYY-MM-DD>:<ip>`
 *    Value: cumulative micro-USD consumed today (integer string)
 *    TTL: 25 hours (survives the full UTC day with margin)
 *
 * 2. Global daily wallet cap
 *    Key: `cost:global:<YYYY-MM-DD>`
 *    Value: cumulative micro-USD consumed today across all IPs
 *    TTL: 25 hours
 *
 * Flow:
 *   preCharge() — at request start, deduct an estimate from both counters.
 *   reconcile() — at stream end, adjust both counters to the request's
 *                 actual cost (prompt_tokens × prompt_price +
 *                 completion_tokens × completion_price, rounded up).
 *   refundFull() — on stream failure, roll back the pre-charge entirely.
 *
 * Judgement calls:
 *   - Cap is a strict ceiling: deny when current + estimate > cap. At-cap
 *     allowed; crossing not.
 *   - No atomic CAS on KV — same trade-off as the previous request-bucket
 *     guard. Brief over/under-counting at high concurrency is acceptable.
 *   - Missing usage in upstream response → full refund (don't hold estimate).
 *   - Refunds always hit the request-start UTC day even if a stream straddles
 *     midnight.
 */

export interface CostGuardConfig {
	/** Per-IP daily ceiling in integer micro-USD (default 1_000_000 = $1.00). */
	perIpDailyMicroUsdMax: number;
	/** Global daily ceiling in integer micro-USD (default 10_000_000 = $10.00). */
	globalDailyMicroUsdMax: number;
	/** Micro-USD deducted at request start, before actual cost is known
	 *  (default 5_000 = $0.005). */
	preChargeMicroUsd: number;
}

export type CostChargeResult =
	| { allowed: true; preCharged: number }
	| { allowed: false; reason: "per-ip-daily" | "global-daily" };

/** Format a unix-ms timestamp as `YYYY-MM-DD` in UTC. */
export function utcDateKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** Per-IP key shape: `cost:ip:<YYYY-MM-DD>:<ip>`. */
export function perIpKey(ip: string, nowMs: number): string {
	return `cost:ip:${utcDateKey(nowMs)}:${ip}`;
}

/** Global key shape: `cost:global:<YYYY-MM-DD>`. */
export function globalKey(nowMs: number): string {
	return `cost:global:${utcDateKey(nowMs)}`;
}

const TTL_SEC = 25 * 60 * 60;

/**
 * Pre-charge both per-IP and global counters by `cfg.preChargeMicroUsd`.
 * Returns `{ allowed: false, reason }` if either cap would be crossed.
 */
export async function preCharge(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	cfg: CostGuardConfig,
): Promise<CostChargeResult> {
	const ipKey = perIpKey(ip, nowMs);
	const gKey = globalKey(nowMs);

	const [rawIp, rawGlobal] = await Promise.all([kv.get(ipKey), kv.get(gKey)]);

	const perIp = rawIp === null ? 0 : Number.parseInt(rawIp, 10);
	const global = rawGlobal === null ? 0 : Number.parseInt(rawGlobal, 10);

	if (perIp + cfg.preChargeMicroUsd > cfg.perIpDailyMicroUsdMax) {
		return { allowed: false, reason: "per-ip-daily" };
	}

	if (global + cfg.preChargeMicroUsd > cfg.globalDailyMicroUsdMax) {
		return { allowed: false, reason: "global-daily" };
	}

	await Promise.all([
		kv.put(ipKey, String(perIp + cfg.preChargeMicroUsd), {
			expirationTtl: TTL_SEC,
		}),
		kv.put(gKey, String(global + cfg.preChargeMicroUsd), {
			expirationTtl: TTL_SEC,
		}),
	]);

	return { allowed: true, preCharged: cfg.preChargeMicroUsd };
}

/**
 * Reconcile the pre-charge against the actual cost (in integer micro-USD).
 * - Under-charge (actual < preCharged): refunds the delta from both counters.
 * - Over-charge (actual > preCharged): accepted as cost of defense, no-op.
 * - Exact match: no-op.
 */
export async function reconcile(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
	actualMicroUsd: number,
): Promise<void> {
	const delta = actualMicroUsd - preCharged;
	if (delta === 0) return;
	if (delta > 0) return;

	const ipKey = perIpKey(ip, nowMs);
	const gKey = globalKey(nowMs);

	const [rawIp, rawGlobal] = await Promise.all([kv.get(ipKey), kv.get(gKey)]);

	const perIp = rawIp === null ? 0 : Number.parseInt(rawIp, 10);
	const global = rawGlobal === null ? 0 : Number.parseInt(rawGlobal, 10);

	await Promise.all([
		kv.put(ipKey, String(Math.max(0, perIp + delta)), {
			expirationTtl: TTL_SEC,
		}),
		kv.put(gKey, String(Math.max(0, global + delta)), {
			expirationTtl: TTL_SEC,
		}),
	]);
}

/**
 * Full refund: equivalent to reconcile with actualMicroUsd=0.
 * Used on stream failure or missing usage data.
 */
export async function refundFull(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
): Promise<void> {
	return reconcile(kv, ip, nowMs, preCharged, 0);
}

/**
 * Returns a 429 response with an OpenAI-shaped error body and a
 * `Retry-After` header (seconds until next UTC midnight).
 */
export function rateLimitResponse(
	reason: "per-ip-daily" | "global-daily",
	nowMs: number,
): Response {
	const message =
		reason === "per-ip-daily"
			? "You have exceeded your daily spend limit. Please try again tomorrow."
			: "The global daily budget has been exhausted. Please try again tomorrow.";

	const nowDate = new Date(nowMs);
	const nextMidnight = new Date(
		Date.UTC(
			nowDate.getUTCFullYear(),
			nowDate.getUTCMonth(),
			nowDate.getUTCDate() + 1,
		),
	);
	const retryAfterSec = Math.ceil((nextMidnight.getTime() - nowMs) / 1000);

	return new Response(
		JSON.stringify({
			error: {
				message,
				type: "rate_limit_exceeded",
				code: reason,
			},
		}),
		{
			status: 429,
			headers: {
				"Content-Type": "application/json",
				"Retry-After": String(retryAfterSec),
			},
		},
	);
}

/** Build cost-guard config from Worker environment variables. */
export function configFromEnv(env: {
	PER_IP_DAILY_MICRO_USD_MAX?: string;
	GLOBAL_DAILY_MICRO_USD_MAX?: string;
	PRE_CHARGE_MICRO_USD?: string;
}): CostGuardConfig {
	return {
		perIpDailyMicroUsdMax: Number(env.PER_IP_DAILY_MICRO_USD_MAX ?? "1000000"),
		globalDailyMicroUsdMax: Number(
			env.GLOBAL_DAILY_MICRO_USD_MAX ?? "10000000",
		),
		preChargeMicroUsd: Number(env.PRE_CHARGE_MICRO_USD ?? "5000"),
	};
}
