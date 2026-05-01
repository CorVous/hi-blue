/**
 * Rate-limit and daily-cap helpers for the proxy worker.
 *
 * Strategy: fixed-window counters stored in Workers KV.
 *
 * Per-IP rate limit:
 *   Key format: "ip:<ip>:<window-start-seconds>"
 *   Window duration is configurable (default 60 s).
 *   The KV entry is given a TTL equal to the window duration so it
 *   auto-expires — no manual cleanup required.
 *   A request is DENIED when the counter, *after* increment, exceeds the limit.
 *   So limit=5 means the 1st–5th requests are allowed; the 6th is denied.
 *
 * Global daily cap:
 *   Key format: "cap:<YYYY-MM-DD>"
 *   Each request increments by `costUnits` (default 1).
 *   A request is DENIED when the counter, after increment, exceeds capUnits.
 *   So cap=1000 means the 1000th unit is the last allowed.
 *
 * HTTP status on cap-hit: 200 with SSE-shaped cap-hit body (documented in
 * _smoke.ts). The browser SSE client already handles streaming 200 responses;
 * returning 200 keeps the client simple. The cap-hit payload contains a
 * sentinel event type so the client can render it in-character.
 */

export interface IpRateOptions {
	/** Maximum number of requests allowed per window. Default: 100. */
	limitPerWindow: number;
	/** Window duration in seconds. Default: 60. */
	windowSecs: number;
}

export interface RateLimitResult {
	allowed: boolean;
	/** Seconds until the window resets (only set when allowed=false for IP limit). */
	retryAfter?: number;
}

export interface DailyCapResult {
	allowed: boolean;
}

/**
 * Increment the per-IP fixed-window counter and check whether the request
 * is within the limit.
 *
 * @param kv          Workers KV namespace bound as RATE_LIMIT_KV.
 * @param ip          Client IP address string.
 * @param opts        Rate-limit options.
 * @returns           { allowed, retryAfter? }
 */
export async function incrementAndCheckIpRate(
	kv: KVNamespace,
	ip: string,
	opts: IpRateOptions = { limitPerWindow: 100, windowSecs: 60 },
): Promise<RateLimitResult> {
	const { limitPerWindow, windowSecs } = opts;
	const windowStart = Math.floor(Date.now() / 1000 / windowSecs) * windowSecs;
	const key = `ip:${ip}:${windowStart}`;

	const existing = await kv.get(key);
	const prev = existing !== null ? parseInt(existing, 10) : 0;
	const next = prev + 1;

	// Store with TTL so the entry auto-expires when the window rolls over.
	await kv.put(key, String(next), { expirationTtl: windowSecs });

	if (next > limitPerWindow) {
		const windowEnd = windowStart + windowSecs;
		const retryAfter = windowEnd - Math.floor(Date.now() / 1000);
		return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
	}

	return { allowed: true };
}

/**
 * Increment the global daily-cap counter and check whether the daily budget
 * has been exhausted.
 *
 * @param kv          Workers KV namespace bound as RATE_LIMIT_KV.
 * @param dateKey     Day key in YYYY-MM-DD format (e.g. "2026-04-30").
 * @param costUnits   Cost of this request in abstract units. Default: 1.
 * @param capUnits    Total daily budget in the same units. Default: 10000.
 * @returns           { allowed }
 */
export async function incrementAndCheckDailyCap(
	kv: KVNamespace,
	dateKey: string,
	costUnits = 1,
	capUnits = 10000,
): Promise<DailyCapResult> {
	const key = `cap:${dateKey}`;

	const existing = await kv.get(key);
	const prev = existing !== null ? parseInt(existing, 10) : 0;
	const next = prev + costUnits;

	// TTL of 25 hours ensures the key expires after the day rolls over.
	await kv.put(key, String(next), { expirationTtl: 90000 });

	return { allowed: next <= capUnits };
}
