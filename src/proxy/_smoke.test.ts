import { env, reset, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

afterEach(async () => {
	// Clear all KV state so rate-guard tests don't interfere with each other.
	await reset();
});

describe("proxy worker smoke", () => {
	it("returns 404 for unknown routes", async () => {
		const response = await SELF.fetch("https://example.com/unknown");
		expect(response.status).toBe(404);
	});

	it("POST /chat streams SSE tokens", async () => {
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");

		const text = await response.text();
		// SSE format: each event is "data: <token>\n\n"
		expect(text).toContain("data:");
		// Should end with a [DONE] sentinel
		expect(text).toContain("data: [DONE]");
	});

	it("POST /chat rejects missing message body", async () => {
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(response.status).toBe(400);
	});

	it("GET / serves HTML with a chat form", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");

		const html = await response.text();
		expect(html).toContain("<form");
		expect(html).toContain("<textarea");
		expect(html).toContain("<output");
	});
});

describe("rate-guard integration via /chat", () => {
	/**
	 * The worker reads rate-limit config from env vars (RATE_LIMIT_MAX etc).
	 * In tests, wrangler.jsonc provides defaults (RATE_LIMIT_MAX=20, DAILY_CAP_MAX=1000).
	 * We seed the KV directly to simulate an already-exhausted bucket/cap.
	 */

	it("returns [CAP_HIT] SSE event when IP is rate-limited", async () => {
		// Seed a fully-exhausted token bucket for our test IP (10.0.0.1).
		// RATE_LIMIT_MAX default is 20; put 0 tokens so the next request fails.
		const kv = (env as Record<string, KVNamespace>)
			.RATE_GUARD_KV as KVNamespace;
		await kv.put(
			"rl:10.0.0.1",
			JSON.stringify({ tokens: 0, lastRefillMs: Date.now() }),
			{ expirationTtl: 60 },
		);

		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.0.0.1",
			},
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/event-stream");
		expect(response.headers.get("X-Cap-Hit")).toBe("rate-limit");

		const text = await response.text();
		// Must include the in-character sleeping message and [CAP_HIT] sentinel
		expect(text).toContain("[CAP_HIT]");
		// Must NOT include [DONE] (no provider was called)
		expect(text).not.toContain("[DONE]");
	});

	it("returns [CAP_HIT] SSE event when daily cap is exceeded", async () => {
		// Seed the daily counter at the cap (DAILY_CAP_MAX=1000, cost=1 per request).
		const today = new Date().toISOString().slice(0, 10);
		const kv = (env as Record<string, KVNamespace>)
			.RATE_GUARD_KV as KVNamespace;
		await kv.put(`daily:${today}`, "1000", { expirationTtl: 25 * 60 * 60 });

		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.0.0.2",
			},
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.headers.get("X-Cap-Hit")).toBe("daily-cap");

		const text = await response.text();
		expect(text).toContain("[CAP_HIT]");
		expect(text).not.toContain("[DONE]");
	});

	it("allows the request and returns [DONE] when neither limit is hit", async () => {
		// Fresh KV state (reset() runs between tests) — all limits are untouched.
		const response = await SELF.fetch("https://example.com/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.0.0.3",
			},
			body: JSON.stringify({ message: "hello" }),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Cap-Hit")).toBeNull();

		const text = await response.text();
		expect(text).toContain("[DONE]");
		expect(text).not.toContain("[CAP_HIT]");
	});
});

describe("POST /diagnostics endpoint (issue #19)", () => {
	it("accepts a valid diagnostics payload and returns 200", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: "curious" }),
		});

		expect(response.status).toBe(200);
	});

	it("accepts downloaded=false and a different summary word", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: false, summary: "confused" }),
		});

		expect(response.status).toBe(200);
	});

	it("returns 400 when the body is not valid JSON", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when 'downloaded' field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ summary: "curious" }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when 'summary' field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 400 when 'summary' is not a string", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: 42 }),
		});

		expect(response.status).toBe(400);
	});

	it("returns 405 for non-POST methods on /diagnostics", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "GET",
		});

		expect(response.status).toBe(405);
	});
});
