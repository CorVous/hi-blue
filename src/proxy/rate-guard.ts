/**
 * Server-side wallet protection for the LLM proxy (issue #37).
 *
 * Two independent token-denominated guards, both backed by Workers KV:
 *
 * 1. Per-IP daily token cap
 *    Key: `tok:ip:<YYYY-MM-DD>:<ip>`
 *    Value: cumulative tokens consumed today (integer string)
 *    TTL: 25 hours (survives the full UTC day with margin)
 *
 * 2. Global daily wallet cap
 *    Key: `tok:global:<YYYY-MM-DD>`
 *    Value: cumulative tokens consumed today across all IPs (integer string)
 *    TTL: 25 hours
 *
 * Flow:
 *   preCharge() — at request start, deduct an estimate from both counters.
 *   reconcile() — at stream end, adjust both counters to actual usage.
 *   refundFull() — on stream failure, roll back the pre-charge entirely.
 *
 * Judgement calls (§11 of plan):
 *   - Cap is strict ceiling: deny when current + estimate > cap.
 *     At-cap is allowed; crossing not.
 *   - No atomic CAS on KV — same trade-off as the previous request-bucket guard.
 *   - Missing usage.total_tokens → full refund (not hold estimate).
 *   - Cross-day boundary refund: refund always hits the request-start UTC day.
 */

export interface TokenGuardConfig {
	/** Per-IP daily token ceiling (default 20_000). */
	perIpDailyTokenMax: number;
	/** Global daily wallet token ceiling (default 1_000_000). */
	globalDailyTokenMax: number;
	/** Tokens deducted at request start, before any usage is known (default 4_000). */
	preChargeEstimate: number;
}

export type TokenChargeResult =
	| { allowed: true; preCharged: number }
	| { allowed: false; reason: "per-ip-daily" | "global-daily" };

/** Format a unix-ms timestamp as `YYYY-MM-DD` in UTC. */
export function utcDateKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** Per-IP key shape: `tok:ip:<YYYY-MM-DD>:<ip>`. */
export function perIpKey(ip: string, nowMs: number): string {
	return `tok:ip:${utcDateKey(nowMs)}:${ip}`;
}

/** Global key shape: `tok:global:<YYYY-MM-DD>`. */
export function globalKey(nowMs: number): string {
	return `tok:global:${utcDateKey(nowMs)}`;
}

const TTL_SEC = 25 * 60 * 60;

/**
 * Pre-charge both per-IP and global counters by `cfg.preChargeEstimate`.
 * Returns `{ allowed: false, reason }` if either cap would be crossed.
 */
export async function preCharge(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	cfg: TokenGuardConfig,
): Promise<TokenChargeResult> {
	const ipKey = perIpKey(ip, nowMs);
	const gKey = globalKey(nowMs);

	// Read both counters in parallel
	const [rawIp, rawGlobal] = await Promise.all([kv.get(ipKey), kv.get(gKey)]);

	const perIp = rawIp === null ? 0 : Number.parseInt(rawIp, 10);
	const global = rawGlobal === null ? 0 : Number.parseInt(rawGlobal, 10);

	// Per-IP cap check (strict: crossing not allowed)
	if (perIp + cfg.preChargeEstimate > cfg.perIpDailyTokenMax) {
		return { allowed: false, reason: "per-ip-daily" };
	}

	// Global cap check
	if (global + cfg.preChargeEstimate > cfg.globalDailyTokenMax) {
		return { allowed: false, reason: "global-daily" };
	}

	// Increment both counters
	await Promise.all([
		kv.put(ipKey, String(perIp + cfg.preChargeEstimate), {
			expirationTtl: TTL_SEC,
		}),
		kv.put(gKey, String(global + cfg.preChargeEstimate), {
			expirationTtl: TTL_SEC,
		}),
	]);

	return { allowed: true, preCharged: cfg.preChargeEstimate };
}

/**
 * Reconcile the pre-charge against the actual token usage.
 * - Under-charge (actual < preCharged): refunds the delta from both counters.
 * - Over-charge (actual > preCharged): accepted as cost of defense, no-op.
 * - Exact match: no-op.
 *
 * Always uses the same `nowMs` as was passed to `preCharge` so refunds
 * hit the correct UTC-day keys even if the stream straddles midnight.
 */
export async function reconcile(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	preCharged: number,
	actualTokens: number,
): Promise<void> {
	const delta = actualTokens - preCharged;
	if (delta === 0) return;
	// Over-charge: no-op — accept as defense cost
	if (delta > 0) return;

	// Under-charge: refund |delta| from both counters, floor at 0
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
 * Full refund: equivalent to reconcile with actualTokens=0.
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
			? "You have exceeded your daily token limit. Please try again tomorrow."
			: "The global daily token budget has been exhausted. Please try again tomorrow.";

	// Seconds until next UTC midnight
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

/** Build token-guard config from Worker environment variables. */
export function configFromEnv(env: {
	PER_IP_DAILY_TOKEN_MAX?: string;
	GLOBAL_DAILY_TOKEN_MAX?: string;
	PRE_CHARGE_ESTIMATE?: string;
}): TokenGuardConfig {
	return {
		perIpDailyTokenMax: Number(env.PER_IP_DAILY_TOKEN_MAX ?? "20000"),
		globalDailyTokenMax: Number(env.GLOBAL_DAILY_TOKEN_MAX ?? "1000000"),
		preChargeEstimate: Number(env.PRE_CHARGE_ESTIMATE ?? "4000"),
	};
}
