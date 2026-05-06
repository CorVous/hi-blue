import { reset, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

// ALLOWED_ORIGINS is set in vitest.config.ts miniflare bindings:
// "https://app.example,http://localhost:5173"

afterEach(async () => {
	// Clear all KV state so rate-guard tests don't interfere with each other.
	await reset();
});

describe("proxy worker smoke", () => {
	it("returns 404 for unknown routes", async () => {
		const response = await SELF.fetch("https://example.com/unknown");
		expect(response.status).toBe(404);
	});
});

describe("OPTIONS /v1/chat/completions — CORS preflight (issue #66)", () => {
	it("returns 204 for allowed origin with Access-Control-Allow-Origin echoed", async () => {
		const response = await SELF.fetch(
			"https://example.com/v1/chat/completions",
			{
				method: "OPTIONS",
				headers: {
					Origin: "https://app.example",
					"Access-Control-Request-Method": "POST",
				},
			},
		);
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
	});

	it("returns 204 for disallowed origin with no Access-Control-Allow-Origin", async () => {
		const response = await SELF.fetch(
			"https://example.com/v1/chat/completions",
			{
				method: "OPTIONS",
				headers: {
					Origin: "https://evil.com",
					"Access-Control-Request-Method": "POST",
				},
			},
		);
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
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
