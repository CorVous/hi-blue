import {
	createExecutionContext,
	env,
	reset,
	SELF,
	waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

afterEach(async () => {
	vi.restoreAllMocks();
	await reset();
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

	it("logs at most 2000 characters of an oversized summary", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded: true, summary: "x".repeat(50_000) }),
		});

		expect(response.status).toBe(200);
		const diagnosticsLine = logSpy.mock.calls
			.map(([line]) => String(line))
			.find((line) => line.startsWith("[diagnostics]"));
		expect(diagnosticsLine).toBe(
			`[diagnostics] downloaded=true summary=${"x".repeat(2_000)}`,
		);
	});

	it("returns 405 for non-POST methods on /diagnostics", async () => {
		const response = await SELF.fetch("https://example.com/diagnostics", {
			method: "GET",
		});

		expect(response.status).toBe(405);
	});
});

describe("POST /v1/chat/completions — a handler that throws", () => {
	it("answers a CORS-wrapped 502 instead of an uncaught error", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const brokenKv = {
			get: () => Promise.reject(new Error("KV unavailable")),
			put: () => Promise.reject(new Error("KV unavailable")),
		} as unknown as KVNamespace;
		const ctx = createExecutionContext();

		const response = await worker.fetch(
			new Request("https://example.com/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: "https://app.example",
				},
				body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
			}),
			{ ...env, RATE_GUARD_KV: brokenKv } as Parameters<typeof worker.fetch>[1],
			ctx,
		);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(502);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
		const body = (await response.json()) as { error?: { type?: string } };
		expect(body.error?.type).toBe("upstream_error");
	});
});
