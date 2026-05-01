/**
 * Server-side wallet protection for the LLM proxy.
 *
 * Two independent guards, both backed by Workers KV:
 *
 * 1. Per-IP token-bucket rate-limit
 *    Key: `rl:<ip>`
 *    Value: JSON { tokens: number, lastRefill: number (unix-ms) }
 *    TTL: RATE_LIMIT_WINDOW_SEC seconds
 *
 *    On each request we refill tokens proportionally to elapsed time, then
 *    consume one token. If no tokens remain → rate-limited.
 *
 * 2. Global daily spend cap
 *    Key: `daily:<YYYY-MM-DD>` (UTC)
 *    Value: cumulative estimated cost as a string (integer microdollars)
 *    TTL: 25 hours (enough to survive the whole UTC day)
 *
 *    On each request we read the counter, check against the cap, and
 *    atomically increment it after the guard passes.
 */

export interface RateGuardConfig {
	/** Max tokens in the bucket (= max burst, = max requests per window). */
	rateLimitMax: number;
	/** Window size in seconds over which the bucket fully refills. */
	rateLimitWindowSec: number;
	/** Estimated cost per request, in the same unit as dailyCapMax. */
	estimatedCostPerRequest: number;
	/** Daily budget ceiling (same unit as estimatedCostPerRequest). */
	dailyCapMax: number;
}

export type GuardResult =
	| { allowed: true }
	| { allowed: false; reason: "rate-limit" | "daily-cap" };

/** Token-bucket state stored in KV. */
interface BucketState {
	tokens: number;
	lastRefillMs: number;
}

/**
 * Check both guards and, if allowed, increment the daily counter.
 *
 * @param kv      Workers KV namespace
 * @param ip      Client IP address (used as the rate-limit key)
 * @param nowMs   Current timestamp in milliseconds (injectable for tests)
 * @param cfg     Configurable knobs
 */
export async function checkAndCharge(
	kv: KVNamespace,
	ip: string,
	nowMs: number,
	cfg: RateGuardConfig,
): Promise<GuardResult> {
	// ── 1. Per-IP token bucket ──────────────────────────────────────────────
	const bucketKey = `rl:${ip}`;
	const rawBucket = await kv.get(bucketKey);
	let bucket: BucketState;

	if (rawBucket === null) {
		// First request from this IP: full bucket
		bucket = { tokens: cfg.rateLimitMax, lastRefillMs: nowMs };
	} else {
		bucket = JSON.parse(rawBucket) as BucketState;
		// Refill proportionally to elapsed time
		const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
		const refill = (elapsedSec / cfg.rateLimitWindowSec) * cfg.rateLimitMax;
		bucket.tokens = Math.min(cfg.rateLimitMax, bucket.tokens + refill);
		bucket.lastRefillMs = nowMs;
	}

	if (bucket.tokens < 1) {
		return { allowed: false, reason: "rate-limit" };
	}

	// Consume one token (write back)
	bucket.tokens -= 1;
	await kv.put(bucketKey, JSON.stringify(bucket), {
		expirationTtl: cfg.rateLimitWindowSec,
	});

	// ── 2. Global daily cap ─────────────────────────────────────────────────
	const dayKey = `daily:${utcDateKey(nowMs)}`;
	const rawSpend = await kv.get(dayKey);
	const currentSpend = rawSpend === null ? 0 : Number(rawSpend);

	if (currentSpend + cfg.estimatedCostPerRequest > cfg.dailyCapMax) {
		// Roll back the token consumption — we're not going to serve this request
		bucket.tokens += 1;
		await kv.put(bucketKey, JSON.stringify(bucket), {
			expirationTtl: cfg.rateLimitWindowSec,
		});
		return { allowed: false, reason: "daily-cap" };
	}

	// Increment daily counter (TTL: 25 h so it outlives the UTC day)
	await kv.put(dayKey, String(currentSpend + cfg.estimatedCostPerRequest), {
		expirationTtl: 25 * 60 * 60,
	});

	return { allowed: true };
}

/** Format a unix-ms timestamp as `YYYY-MM-DD` in UTC. */
function utcDateKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Build the in-character "AIs are sleeping" SSE stream.
 * The client reads `data: [CAP_HIT]` and renders the sleeping page.
 */
export function capHitStream(
	reason: "rate-limit" | "daily-cap",
): ReadableStream {
	const message =
		reason === "rate-limit"
			? "The AIs are resting. Please slow down and try again in a moment."
			: "The AIs have gone to sleep for the night. Come back tomorrow!";
	return new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			controller.enqueue(encoder.encode(`data: ${message}\n\n`));
			controller.enqueue(encoder.encode("data: [CAP_HIT]\n\n"));
			controller.close();
		},
	});
}

/** Default config loaded from Worker environment variables. */
export function configFromEnv(env: {
	RATE_LIMIT_MAX?: string;
	RATE_LIMIT_WINDOW_SEC?: string;
	ESTIMATED_COST_PER_REQUEST?: string;
	DAILY_CAP_MAX?: string;
}): RateGuardConfig {
	return {
		rateLimitMax: Number(env.RATE_LIMIT_MAX ?? "20"),
		rateLimitWindowSec: Number(env.RATE_LIMIT_WINDOW_SEC ?? "60"),
		estimatedCostPerRequest: Number(env.ESTIMATED_COST_PER_REQUEST ?? "1"),
		dailyCapMax: Number(env.DAILY_CAP_MAX ?? "1000"),
	};
}
