/**
 * Rate-limiting backed by Workers KV.
 *
 * Strategy: fixed-window counters.
 * - Per-IP: KV key "ip:<address>" stores a request count. The key is written
 *   with an expirationTtl equal to RATE_LIMIT_WINDOW_SECONDS on the *first*
 *   write, creating a fixed window. Subsequent increments within the window
 *   re-use the existing TTL (KV does not reset TTL on put without explicit
 *   expirationTtl). This is a pragmatic approximation: at window boundary the
 *   counter resets naturally when the key expires.
 * - Daily cap: KV key "daily:<YYYY-MM-DD>" stores cumulative estimated spend
 *   (in abstract cost units). Each request increments it by
 *   DAILY_CAP_COST_PER_REQUEST. The key is written with a TTL of 49 hours so
 *   it auto-expires after the day rolls over (with margin).
 */

export const RATE_LIMIT_PER_IP = 20; // requests per window
export const RATE_LIMIT_WINDOW_SECONDS = 60; // 1-minute window
export const DAILY_CAP_COST_PER_REQUEST = 1; // cost units per request
export const DAILY_CAP_TTL_SECONDS = 49 * 60 * 60; // 49 hours

/** Derive the KV key for the current UTC day. */
export function DAILY_CAP_KEY(now: Date): string {
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(now.getUTCDate()).padStart(2, "0");
	return `daily:${yyyy}-${mm}-${dd}`;
}

export interface CheckResult {
	allowed: boolean;
	reason?: string;
}

export interface RateLimiter {
	/**
	 * Check (and, if allowed, record) a request from the given IP.
	 * Returns { allowed: true } when under all limits,
	 * or { allowed: false, reason } when any limit is tripped.
	 */
	check(ip: string): Promise<CheckResult>;
}

export interface RateLimiterOptions {
	kv: KVNamespace;
	/** Maximum cumulative daily-cap cost before blocking (use Infinity to disable). */
	dailyCapLimit: number;
	/** Override the current time (for tests). Defaults to Date.now(). */
	now?: () => Date;
}

/**
 * Factory that returns a RateLimiter wired to the given KV namespace.
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
	const { kv, dailyCapLimit } = opts;
	const currentTime = opts.now ?? (() => new Date());

	return {
		async check(ip: string): Promise<CheckResult> {
			const now = currentTime();

			// ---- 1. Check & increment per-IP counter ----
			const ipKey = `ip:${ip}`;
			const rawIp = await kv.get(ipKey);
			const ipCount = rawIp !== null ? parseInt(rawIp, 10) : 0;

			if (ipCount >= RATE_LIMIT_PER_IP) {
				return {
					allowed: false,
					reason:
						"rate-limit exceeded — please wait before sending more messages",
				};
			}

			// ---- 2. Check & increment global daily cap ----
			const dayKey = DAILY_CAP_KEY(now);
			const rawDay = await kv.get(dayKey);
			const daySpend = rawDay !== null ? parseFloat(rawDay) : 0;

			if (daySpend + DAILY_CAP_COST_PER_REQUEST > dailyCapLimit) {
				return {
					allowed: false,
					reason:
						"daily-cap reached — the AIs are sleeping, come back tomorrow",
				};
			}

			// ---- 3. Allowed — commit both counters ----

			// Per-IP: set TTL only on first write so the window is fixed.
			if (rawIp === null) {
				await kv.put(ipKey, String(ipCount + 1), {
					expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
				});
			} else {
				// Overwrite without TTL arg — existing TTL is preserved by KV.
				await kv.put(ipKey, String(ipCount + 1));
			}

			// Daily cap: always write with 49h TTL to ensure expiry.
			await kv.put(dayKey, String(daySpend + DAILY_CAP_COST_PER_REQUEST), {
				expirationTtl: DAILY_CAP_TTL_SECONDS,
			});

			return { allowed: true };
		},
	};
}
