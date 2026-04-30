/**
 * Rate-limiter tests for per-IP and global daily-cap limits.
 *
 * Strategy: sliding-window token-bucket backed by Workers KV.
 *
 * Per-IP: up to RATE_LIMIT_PER_IP requests in a 60-second window.
 * Daily cap: a global counter keyed by UTC date (YYYY-MM-DD), incremented
 * by an estimated cost per request. When either trips, the proxy returns
 * HTTP 429 with an in-character "the AIs are sleeping" SSE event; no
 * real provider call is made.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLLMProvider } from "./mock-provider";
import type { RateLimiter } from "./rate-limiter";
import {
	createRateLimiter,
	DAILY_CAP_COST_PER_REQUEST,
	DAILY_CAP_KEY,
	RATE_LIMIT_PER_IP,
	RATE_LIMIT_WINDOW_SECONDS,
} from "./rate-limiter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKv(): KVNamespace {
	return env.RATE_LIMIT_KV as KVNamespace;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("rate-limiter constants", () => {
	it("exposes RATE_LIMIT_PER_IP as a positive integer", () => {
		expect(Number.isInteger(RATE_LIMIT_PER_IP)).toBe(true);
		expect(RATE_LIMIT_PER_IP).toBeGreaterThan(0);
	});

	it("exposes RATE_LIMIT_WINDOW_SECONDS as a positive integer", () => {
		expect(Number.isInteger(RATE_LIMIT_WINDOW_SECONDS)).toBe(true);
		expect(RATE_LIMIT_WINDOW_SECONDS).toBeGreaterThan(0);
	});

	it("exposes DAILY_CAP_COST_PER_REQUEST as a positive number", () => {
		expect(DAILY_CAP_COST_PER_REQUEST).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Per-IP rate limit
// ---------------------------------------------------------------------------

describe("per-IP rate limit", () => {
	let limiter: RateLimiter;
	let kv: KVNamespace;

	beforeEach(() => {
		kv = makeKv();
		// Use a deterministic fixed time so sliding-window TTLs are reproducible.
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
		limiter = createRateLimiter({
			kv,
			dailyCapLimit: Number.POSITIVE_INFINITY,
		});
	});

	afterEach(async () => {
		vi.useRealTimers();
		// Clear KV between tests
		const list = await kv.list();
		for (const key of list.keys) {
			await kv.delete(key.name);
		}
	});

	it("allows first request for a new IP", async () => {
		const result = await limiter.check("1.2.3.4");
		expect(result.allowed).toBe(true);
	});

	it("allows requests up to the limit", async () => {
		for (let i = 0; i < RATE_LIMIT_PER_IP; i++) {
			const result = await limiter.check("10.0.0.1");
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks the request immediately at the limit (at-limit edge)", async () => {
		// Exhaust the bucket
		for (let i = 0; i < RATE_LIMIT_PER_IP; i++) {
			await limiter.check("10.0.0.2");
		}
		// The next request (at-limit) is blocked
		const result = await limiter.check("10.0.0.2");
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/rate.?limit/i);
	});

	it("blocks requests just over the limit", async () => {
		// Exhaust + 1 extra
		for (let i = 0; i < RATE_LIMIT_PER_IP + 1; i++) {
			await limiter.check("10.0.0.3");
		}
		const result = await limiter.check("10.0.0.3");
		expect(result.allowed).toBe(false);
	});

	it("does not affect a different IP", async () => {
		// Exhaust one IP
		for (let i = 0; i <= RATE_LIMIT_PER_IP; i++) {
			await limiter.check("10.0.0.4");
		}
		// A different IP should still be allowed
		const result = await limiter.check("10.0.0.5");
		expect(result.allowed).toBe(true);
	});

	it("resets after the window expires", async () => {
		// Exhaust
		for (let i = 0; i < RATE_LIMIT_PER_IP; i++) {
			await limiter.check("10.0.0.6");
		}
		expect((await limiter.check("10.0.0.6")).allowed).toBe(false);

		// Advance time past the window — KV TTL would expire; in Miniflare
		// we simulate by re-writing the counter below the limit manually.
		// For the sliding-window implementation the TTL is set on the KV entry.
		// We test expiry by advancing system time and verifying the counter
		// resets when the key no longer exists (delete it to simulate expiry).
		const ipKey = `ip:10.0.0.6`;
		await kv.delete(ipKey);

		const result = await limiter.check("10.0.0.6");
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Global daily cap
// ---------------------------------------------------------------------------

describe("global daily cap", () => {
	let limiter: RateLimiter;
	let kv: KVNamespace;
	const DAILY_CAP = 5 * DAILY_CAP_COST_PER_REQUEST; // allow exactly 5 requests

	beforeEach(() => {
		kv = makeKv();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
		limiter = createRateLimiter({ kv, dailyCapLimit: DAILY_CAP });
	});

	afterEach(async () => {
		vi.useRealTimers();
		const list = await kv.list();
		for (const key of list.keys) {
			await kv.delete(key.name);
		}
	});

	it("allows requests just under the daily cap", async () => {
		// 4 requests — just under 5
		for (let i = 0; i < 4; i++) {
			const result = await limiter.check("5.5.5.5");
			expect(result.allowed).toBe(true);
		}
	});

	it("allows the request at exactly the cap (last allowed)", async () => {
		// Requests 1–5 should all succeed (5 == DAILY_CAP / COST_PER_REQUEST)
		for (let i = 0; i < 5; i++) {
			const result = await limiter.check(`6.6.6.${i}`);
			// different IPs to avoid per-IP limit; still increments global counter
			expect(result.allowed).toBe(true);
		}
	});

	it("blocks the request over the daily cap", async () => {
		// Exhaust global cap (using unique IPs to avoid per-IP limit)
		for (let i = 0; i < 5; i++) {
			await limiter.check(`7.7.7.${i}`);
		}
		const result = await limiter.check("7.7.7.99");
		expect(result.allowed).toBe(false);
		expect(result.reason).toMatch(/daily.?cap|sleeping/i);
	});

	it("resets on a new UTC day", async () => {
		// Fill the cap
		for (let i = 0; i < 5; i++) {
			await limiter.check(`8.8.8.${i}`);
		}
		expect((await limiter.check("8.8.8.99")).allowed).toBe(false);

		// Advance to next day — the day-keyed counter is naturally absent.
		vi.setSystemTime(new Date("2026-01-02T00:00:01.000Z"));

		// Create a fresh limiter (so the day key is re-derived)
		const nextDayLimiter = createRateLimiter({
			kv,
			dailyCapLimit: DAILY_CAP,
		});
		const result = await nextDayLimiter.check("8.8.8.100");
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Cap-hit integration: proxy short-circuits without calling provider
// ---------------------------------------------------------------------------

describe("cap-hit integration via SELF", () => {
	// These tests import the proxy worker through SELF so they verify that the
	// worker returns 429 and the in-character SSE payload without invoking the
	// real LLM provider.  The KV is pre-seeded to the over-limit state.
	let kv: KVNamespace;

	beforeEach(async () => {
		kv = env.RATE_LIMIT_KV as KVNamespace;
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
	});

	afterEach(async () => {
		vi.useRealTimers();
		const list = await kv.list();
		for (const key of list.keys) {
			await kv.delete(key.name);
		}
	});

	it("returns in-character SSE payload when rate-limited, no provider call", async () => {
		// Spy on MockLLMProvider to ensure it is never called.
		const spy = vi.spyOn(MockLLMProvider.prototype, "streamCompletion");

		// Seed KV so IP is over limit
		const ipKey = "ip:9.9.9.9";
		await kv.put(ipKey, String(RATE_LIMIT_PER_IP + 1), {
			expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
		});

		const { SELF } = await import("cloudflare:test");
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "9.9.9.9",
			},
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(429);
		const text = await response.text();
		// Must contain the in-character sleeping message
		expect(text.toLowerCase()).toMatch(/sleeping|resting|unavailable/);
		// Provider must not have been called
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("returns in-character SSE payload when daily cap hit, no provider call", async () => {
		const spy = vi.spyOn(MockLLMProvider.prototype, "streamCompletion");

		// Seed KV with an over-cap daily spend
		const dayKey = DAILY_CAP_KEY(new Date("2026-01-01T12:00:00.000Z"));
		// Write a value exceeding any reasonable cap
		await kv.put(dayKey, String(Number.MAX_SAFE_INTEGER));

		const { SELF } = await import("cloudflare:test");
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "4.4.4.4",
			},
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(429);
		const text = await response.text();
		expect(text.toLowerCase()).toMatch(/sleeping|resting|unavailable/);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
