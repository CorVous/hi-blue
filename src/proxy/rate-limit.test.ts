/**
 * Rate-limit and daily-cap integration tests.
 *
 * All tests run inside @cloudflare/vitest-pool-workers so SELF.fetch hits the
 * real worker with real KV (Miniflare in-memory).  We use the CF-Connecting-IP
 * header to set IP addresses and small limits (configured via env vars in the
 * worker) to exercise edges quickly.
 *
 * KV state is reset before each test with `reset()` from cloudflare:test so
 * tests are fully isolated from each other and from smoke tests in other files.
 *
 * Limit semantics:
 *   - IP rate limit of N means requests 1..N are allowed; the (N+1)th is denied.
 *   - Daily cap of N units means cumulative cost 1..N is allowed; the (N+1)th
 *     request unit is denied.
 *
 * Cap-hit HTTP status: 200 (SSE-shaped body) so the browser client doesn't
 * crash — it just renders the cap-hit message in the chat output.
 */

import { reset, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

// Reset all KV data before each test for full isolation.
beforeEach(async () => {
	await reset();
});

// Helper: POST /chat with a specific IP and return { status, text }.
async function postChat(ip: string, message = "hello") {
	const res = await SELF.fetch("https://example.com/chat", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
		},
		body: JSON.stringify({ message }),
	});
	return { status: res.status, text: await res.text() };
}

// Helper: collect SSE data values from a raw SSE response body string.
function sseDataLines(text: string): string[] {
	return text
		.split("\n")
		.filter((l) => l.startsWith("data: "))
		.map((l) => l.slice(6));
}

// ────────────────────────────────────────────────────────────────────────────
// Per-IP rate-limit tests
// The test env sets IP_RATE_LIMIT=2, so requests 1 and 2 are allowed;
// request 3 is denied.
// ────────────────────────────────────────────────────────────────────────────

describe("per-IP rate limit", () => {
	it("allows the first request (well under limit)", async () => {
		const { status, text } = await postChat("10.0.1.1");
		expect(status).toBe(200);
		expect(text).toContain("data: [DONE]");
	});

	it("allows exactly N requests when limit is N (limit=2, send 2)", async () => {
		const ip = "10.0.2.1";
		const r1 = await postChat(ip);
		const r2 = await postChat(ip);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		expect(r1.text).toContain("data: [DONE]");
		expect(r2.text).toContain("data: [DONE]");
	});

	it("blocks the (N+1)th request and returns a cap-hit SSE response", async () => {
		const ip = "10.0.3.1";
		// Consume the limit (2 requests).
		await postChat(ip);
		await postChat(ip);
		// Third request exceeds limit.
		const { status, text } = await postChat(ip);
		// HTTP 200 — SSE-shaped so the browser client doesn't crash.
		expect(status).toBe(200);
		const lines = sseDataLines(text);
		expect(lines.some((l) => l.includes("[CAP_HIT]"))).toBe(true);
		expect(text).toContain("sleeping");
	});

	it("does NOT stream real tokens when rate-limited (provider not called)", async () => {
		const ip = "10.0.4.1";
		await postChat(ip);
		await postChat(ip);
		// Third request is over limit.
		const { text } = await postChat(ip);
		const lines = sseDataLines(text);
		// Normal stream ends with [DONE]; cap-hit stream ends with [CAP_HIT].
		expect(lines.some((l) => l === "[DONE]")).toBe(false);
		expect(lines.some((l) => l.includes("[CAP_HIT]"))).toBe(true);
	});

	it("different IPs are rate-limited independently", async () => {
		// Fill ip A to its limit.
		await postChat("10.0.5.1");
		await postChat("10.0.5.1");
		// ip B should still be allowed (fresh counter).
		const { status, text } = await postChat("10.0.5.2");
		expect(status).toBe(200);
		expect(text).toContain("data: [DONE]");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Global daily-cap tests
// The test env sets DAILY_CAP=4, so cumulative cost 1-4 is allowed;
// the 5th request unit is denied.
// ────────────────────────────────────────────────────────────────────────────

describe("global daily cap", () => {
	it("allows requests while under the daily cap", async () => {
		// Two requests from unique IPs — well under cap (4).
		const r1 = await postChat("10.1.1.1");
		const r2 = await postChat("10.1.1.2");
		expect(r1.status).toBe(200);
		expect(r1.text).toContain("data: [DONE]");
		expect(r2.status).toBe(200);
		expect(r2.text).toContain("data: [DONE]");
	});

	it("allows exactly N cost-units when cap is N (cap=4, send 4 unique-IP requests)", async () => {
		// Four unique IPs each consume 1 unit — exactly at cap.
		const results = await Promise.all([
			postChat("10.1.2.1"),
			postChat("10.1.2.2"),
			postChat("10.1.2.3"),
			postChat("10.1.2.4"),
		]);
		for (const r of results) {
			expect(r.status).toBe(200);
			expect(r.text).toContain("data: [DONE]");
		}
	});

	it("blocks once the daily cap is exhausted and returns SSE cap-hit", async () => {
		// Exhaust cap with 4 unique-IP requests (1 unit each = 4 total).
		await postChat("10.1.3.1");
		await postChat("10.1.3.2");
		await postChat("10.1.3.3");
		await postChat("10.1.3.4");
		// Cap is now 4 — next request (any IP) should be denied.
		const { status, text } = await postChat("10.1.3.5");
		expect(status).toBe(200);
		const lines = sseDataLines(text);
		expect(lines.some((l) => l.includes("[CAP_HIT]"))).toBe(true);
		expect(text).toContain("sleeping");
	});

	it("does NOT stream real tokens when daily cap is exhausted", async () => {
		// Exhaust cap with 4 unique-IP requests.
		await postChat("10.1.4.1");
		await postChat("10.1.4.2");
		await postChat("10.1.4.3");
		await postChat("10.1.4.4");
		// 5th is denied — no real provider tokens.
		const { text } = await postChat("10.1.4.5");
		const lines = sseDataLines(text);
		expect(lines.some((l) => l === "[DONE]")).toBe(false);
		expect(lines.some((l) => l.includes("[CAP_HIT]"))).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Cap-hit response format tests
// ────────────────────────────────────────────────────────────────────────────

describe("cap-hit response format", () => {
	it("cap-hit response has text/event-stream content type", async () => {
		const ip = "10.2.1.1";
		// Exhaust IP rate limit.
		await postChat(ip);
		await postChat(ip);
		const res = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({ message: "hello" }),
		});
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");
	});

	it("cap-hit response ends with [CAP_HIT] sentinel as the last SSE data line", async () => {
		const ip = "10.2.2.1";
		// Exhaust IP rate limit.
		await postChat(ip);
		await postChat(ip);
		const { text } = await postChat(ip);
		const lines = sseDataLines(text);
		const lastLine = lines[lines.length - 1];
		expect(lastLine).toBe("[CAP_HIT]");
	});

	it("cap-hit response contains in-character 'sleeping' copy", async () => {
		const ip = "10.2.3.1";
		await postChat(ip);
		await postChat(ip);
		const { text } = await postChat(ip);
		expect(text).toContain("sleeping");
	});
});
