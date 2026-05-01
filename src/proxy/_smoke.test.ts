import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("proxy worker smoke", () => {
	it("returns ok for unknown routes", async () => {
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

// ---------------------------------------------------------------------------
// POST /diagnostics endpoint
// ---------------------------------------------------------------------------

// Each diagnostics test uses a unique IP to avoid shared rate-limit state
// (IP_RATE_LIMIT=2 in test config — two requests per IP per window).
describe("POST /diagnostics", () => {
	it("returns 200 and {ok:true} for a valid payload", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.1",
			},
			body: JSON.stringify({ downloaded: true, summary: "interesting" }),
		});
		expect(response.status).toBe(200);
		const json = (await response.json()) as { ok: boolean };
		expect(json.ok).toBe(true);
	});

	it("accepts downloaded:false with a valid summary", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.2",
			},
			body: JSON.stringify({ downloaded: false, summary: "curious" }),
		});
		expect(response.status).toBe(200);
	});

	it("writes the payload to KV under a diag: prefixed key", async () => {
		// List KV keys before request
		const before = await (
			env as { RATE_LIMIT_KV: KVNamespace }
		).RATE_LIMIT_KV.list({ prefix: "diag:" });
		const countBefore = before.keys.length;

		await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.3",
			},
			body: JSON.stringify({ downloaded: true, summary: "saved" }),
		});

		const after = await (
			env as { RATE_LIMIT_KV: KVNamespace }
		).RATE_LIMIT_KV.list({ prefix: "diag:" });
		expect(after.keys.length).toBe(countBefore + 1);
	});

	it("returns 400 when summary is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.4",
			},
			body: JSON.stringify({ downloaded: true }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary is not a string", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.5",
			},
			body: JSON.stringify({ downloaded: true, summary: 42 }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary contains whitespace (multi-word)", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.6",
			},
			body: JSON.stringify({ downloaded: false, summary: "two words" }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary is empty string", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.7",
			},
			body: JSON.stringify({ downloaded: false, summary: "" }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when summary exceeds 32 characters", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.8",
			},
			body: JSON.stringify({
				downloaded: false,
				summary: "a".repeat(33),
			}),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when body is invalid JSON", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.9",
			},
			body: "not-json",
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when downloaded field is missing", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.10",
			},
			body: JSON.stringify({ summary: "fine" }),
		});
		expect(response.status).toBe(400);
	});

	it("returns 400 when downloaded is not a boolean", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "10.1.0.11",
			},
			body: JSON.stringify({ downloaded: "yes", summary: "fine" }),
		});
		expect(response.status).toBe(400);
	});

	it("is subject to the per-IP rate limit", async () => {
		// IP_RATE_LIMIT is set to "2" in vitest.config.ts; 3rd request should be denied
		// Use a distinct IP header to isolate this test from other tests
		const ip = "10.0.99.1";
		const makeReq = () =>
			SELF.fetch("https://example.com/diagnostics", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ip,
				},
				body: JSON.stringify({ downloaded: false, summary: "ratelimit" }),
			});

		const r1 = await makeReq();
		const r2 = await makeReq();
		const r3 = await makeReq();

		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
		// Third request exceeds the per-IP limit (limit=2)
		expect(r3.status).toBe(429);
	});
});
