/**
 * Tests for POST /v1/chat/completions — OpenRouter proxy (issue #36).
 *
 * Uses SELF.fetch (cloudflare:test) so the full worker route-table is
 * exercised. The outbound fetch to OpenRouter is intercepted via
 * vi.stubGlobal('fetch', ...) — the worker isolate shares globalThis with
 * the test runner in vitest-pool-workers, so the stub is observable inside
 * the worker.
 */
import { reset, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPENROUTER_URL, PINNED_MODEL } from "./openai-proxy";

const ENDPOINT = "https://example.com/v1/chat/completions";

const VALID_BODY = JSON.stringify({
	model: "gpt-4o",
	messages: [{ role: "user", content: "Hello" }],
});

function makeUpstreamMock(
	body: BodyInit,
	status = 200,
	headers: Record<string, string> = { "Content-Type": "text/event-stream" },
): typeof fetch {
	// Use mockImplementation (not mockResolvedValue) so the Response is
	// created lazily inside the worker's fetch call — avoids the Cloudflare
	// Workers cross-request I/O isolation error that fires when a Response
	// body (ReadableStreamSource) is constructed in the test context and then
	// consumed in a different request handler context.
	return vi
		.fn()
		.mockImplementation(() =>
			Promise.resolve(new Response(body, { status, headers })),
		);
}

afterEach(async () => {
	vi.unstubAllGlobals();
	await reset();
});

// ── 1. 200 streaming pass-through ────────────────────────────────────────────

describe("POST /v1/chat/completions — streaming pass-through", () => {
	it("returns 200 with text/event-stream when upstream does", async () => {
		const stream = "data: {}\n\ndata: [DONE]\n\n";
		vi.stubGlobal("fetch", makeUpstreamMock(stream));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		expect(resp.status).toBe(200);
		expect(resp.headers.get("Content-Type")).toContain("text/event-stream");
		const text = await resp.text();
		expect(text).toBe(stream);
	});
});

// ── 2. Model pinning — caller sends different model ───────────────────────────

describe("POST /v1/chat/completions — model pinning", () => {
	it("pins model to PINNED_MODEL even when caller sends gpt-4o", async () => {
		let capturedBody: Record<string, unknown> | undefined;
		const mockFetch = vi
			.fn()
			.mockImplementation(async (_url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string) as Record<
					string,
					unknown
				>;
				return new Response("{}", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			});
		vi.stubGlobal("fetch", mockFetch);

		await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "gpt-4o",
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		expect(capturedBody?.model).toBe(PINNED_MODEL);
	});

	it("pins model to PINNED_MODEL when caller omits model", async () => {
		let capturedBody: Record<string, unknown> | undefined;
		const mockFetch = vi
			.fn()
			.mockImplementation(async (_url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string) as Record<
					string,
					unknown
				>;
				return new Response("{}", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			});
		vi.stubGlobal("fetch", mockFetch);

		await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(capturedBody?.model).toBe(PINNED_MODEL);
	});
});

// ── 3. Authorization header forwarding ───────────────────────────────────────

describe("POST /v1/chat/completions — auth header forwarding", () => {
	it("forwards Authorization: Bearer <secret> to OpenRouter", async () => {
		let capturedHeaders: Record<string, string> | undefined;
		const mockFetch = vi
			.fn()
			.mockImplementation(async (_url: string, init: RequestInit) => {
				capturedHeaders = init.headers as Record<string, string>;
				return new Response("{}", {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			});
		vi.stubGlobal("fetch", mockFetch);

		await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		// vitest.config.ts sets OPENROUTER_API_KEY = "test-openrouter-key"
		expect(capturedHeaders?.Authorization).toBe("Bearer test-openrouter-key");
	});
});

// ── 4. Correct OpenRouter URL ─────────────────────────────────────────────────

describe("POST /v1/chat/completions — upstream URL", () => {
	it("forwards POST to the correct OpenRouter URL", async () => {
		let capturedUrl: string | undefined;
		const mockFetch = vi.fn().mockImplementation(async (url: string) => {
			capturedUrl = url;
			return new Response("{}", {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		vi.stubGlobal("fetch", mockFetch);

		await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		expect(capturedUrl).toBe(OPENROUTER_URL);
	});
});

// ── 5. 400 for invalid JSON body ──────────────────────────────────────────────

describe("POST /v1/chat/completions — input validation", () => {
	it("returns 400 invalid_request_error for invalid JSON body", async () => {
		// No mock needed — handler should reject before calling fetch
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});

		expect(resp.status).toBe(400);
		const json = (await resp.json()) as {
			error: { type: string; message: string };
		};
		expect(json.error.type).toBe("invalid_request_error");
	});

	it("returns 400 invalid_request_error for missing messages array", async () => {
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "gpt-4o" }),
		});

		expect(resp.status).toBe(400);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("invalid_request_error");
	});

	it("returns 400 invalid_request_error for empty messages array", async () => {
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		expect(resp.status).toBe(400);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("invalid_request_error");
	});
});

// ── 6. 502 when upstream returns 5xx ─────────────────────────────────────────

describe("POST /v1/chat/completions — upstream errors", () => {
	it("returns 502 upstream_error when upstream returns 5xx", async () => {
		vi.stubGlobal(
			"fetch",
			makeUpstreamMock("Internal Server Error", 500, {
				"Content-Type": "text/plain",
			}),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		expect(resp.status).toBe(502);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("upstream_error");
	});

	it("returns 502 upstream_error when fetch throws (network failure)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network error")),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		expect(resp.status).toBe(502);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("upstream_error");
	});
});

// ── 7. stream:true preserved in outbound body ─────────────────────────────────

describe("POST /v1/chat/completions — stream flag passthrough", () => {
	it("preserves stream:true in the outbound body", async () => {
		let capturedBody: Record<string, unknown> | undefined;
		const mockFetch = vi
			.fn()
			.mockImplementation(async (_url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string) as Record<
					string,
					unknown
				>;
				return new Response("data: [DONE]\n\n", {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				});
			});
		vi.stubGlobal("fetch", mockFetch);

		await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "gpt-4o",
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		expect(capturedBody?.stream).toBe(true);
	});
});

// ── 8. Non-POST verbs fall through to 404 ────────────────────────────────────

describe("POST /v1/chat/completions — method guard", () => {
	it("GET /v1/chat/completions returns 404 (falls through to catch-all)", async () => {
		const resp = await SELF.fetch(ENDPOINT, { method: "GET" });
		expect(resp.status).toBe(404);
	});

	it("PUT /v1/chat/completions returns 404 (falls through to catch-all)", async () => {
		const resp = await SELF.fetch(ENDPOINT, { method: "PUT" });
		expect(resp.status).toBe(404);
	});
});
