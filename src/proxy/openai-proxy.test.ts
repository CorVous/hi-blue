/**
 * Tests for POST /v1/chat/completions — OpenRouter proxy (issue #36).
 *
 * Uses SELF.fetch (cloudflare:test) so the full worker route-table is
 * exercised. The outbound fetch to OpenRouter is intercepted via
 * vi.stubGlobal('fetch', ...) — the worker isolate shares globalThis with
 * the test runner in vitest-pool-workers, so the stub is observable inside
 * the worker.
 */
import { env, reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENROUTER_URL, PINNED_MODEL } from "./openai-proxy";
import { globalKey, perIpKey } from "./rate-guard";

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

// ── 8. Non-POST verbs fall through to ASSETS binding ─────────────────────────
// NOTE: These tests were updated in the fix for issue #48. GET/PUT requests to
// /v1/chat/completions are not matched by any API route and fall through to
// env.ASSETS.fetch(request) — the Worker no longer returns 404 directly.
// vitest-pool-workers does not provide an ASSETS binding, so exercising these
// paths in this test suite would throw "Cannot read properties of undefined
// (reading 'fetch')". The behaviour is verified by the wrangler dev smoke
// probe; the tests are omitted here rather than adding a brittle stub.

// ── 9. Rate-guard integration — POST /v1/chat/completions ────────────────────

function kv(): KVNamespace {
	return (env as Record<string, KVNamespace>).RATE_GUARD_KV as KVNamespace;
}

// Tight caps for testing (must match vitest.config.ts bindings)
const PER_IP_CAP = 20_000;
const PRE_CHARGE = 4_000;

describe("rate-guard integration — POST /v1/chat/completions", () => {
	beforeEach(async () => {
		// Clear KV before each test
		const ns = kv();
		const listed = await ns.list();
		await Promise.all(listed.keys.map((k) => ns.delete(k.name)));
	});

	it("per-IP cap-hit returns 429 with error.code === 'per-ip-daily', upstream not called", async () => {
		// Exhaust the per-IP counter
		const ip = "5.5.5.5";
		const ipK = perIpKey(ip, Date.now());
		await kv().put(ipK, String(PER_IP_CAP - PRE_CHARGE + 1), {
			expirationTtl: 25 * 3600,
		});

		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(resp.status).toBe(429);
		const body = (await resp.json()) as {
			error: { type: string; code: string };
		};
		expect(body.error.type).toBe("rate_limit_exceeded");
		expect(body.error.code).toBe("per-ip-daily");
		// Upstream must not have been called
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("global cap-hit returns 429 with error.code === 'global-daily'", async () => {
		const gK = globalKey(Date.now());
		await kv().put(gK, String(1_000_000 - PRE_CHARGE + 1), {
			expirationTtl: 25 * 3600,
		});

		vi.stubGlobal("fetch", vi.fn());

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "6.6.6.6",
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(resp.status).toBe(429);
		const body = (await resp.json()) as {
			error: { code: string };
		};
		expect(body.error.code).toBe("global-daily");
	});

	it("happy path streaming: stub upstream with usage=1500, counters reconcile to 1500", async () => {
		const ip = "7.7.7.7";
		const ssePayload =
			'data: {"usage":{"total_tokens":1500}}\n\ndata: [DONE]\n\n';

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response(ssePayload, {
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					}),
				),
			),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		expect(resp.status).toBe(200);
		// Consume the stream so TransformStream flush fires
		await resp.text();

		// Give the flush microtask time to complete
		await new Promise((r) => setTimeout(r, 50));

		const now = Date.now();
		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey(ip, now)),
			kv().get(globalKey(now)),
		]);

		expect(Number(ipVal)).toBe(1500);
		expect(Number(gVal)).toBe(1500);
	});

	it("over-charge accepted: stub upstream usage=9000, counters stay at pre-charge (4000)", async () => {
		const ip = "8.8.8.8";
		const ssePayload =
			'data: {"usage":{"total_tokens":9000}}\n\ndata: [DONE]\n\n';

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response(ssePayload, {
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					}),
				),
			),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		await resp.text();
		await new Promise((r) => setTimeout(r, 50));

		const ipVal = await kv().get(perIpKey(ip, Date.now()));
		// Over-charge: counter remains at preCharge, no additional debit
		expect(Number(ipVal)).toBe(PRE_CHARGE);
	});

	it("upstream non-2xx returns 502 to client and counters return to 0", async () => {
		const ip = "9.9.9.9";

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response("Internal Server Error", {
						status: 500,
						headers: { "Content-Type": "text/plain" },
					}),
				),
			),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(resp.status).toBe(502);

		const now = Date.now();
		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey(ip, now)),
			kv().get(globalKey(now)),
		]);
		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});

	it("upstream fetch throws returns 502 and counters return to 0", async () => {
		const ip = "10.0.0.1";

		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network error")),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(resp.status).toBe(502);

		const now = Date.now();
		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey(ip, now)),
			kv().get(globalKey(now)),
		]);
		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});

	it("multi-IP isolation: IP A capped does not affect IP B", async () => {
		const ipA = "11.0.0.1";
		const ipB = "11.0.0.2";
		// Exhaust IP A
		await kv().put(
			perIpKey(ipA, Date.now()),
			String(PER_IP_CAP - PRE_CHARGE + 1),
			{
				expirationTtl: 25 * 3600,
			},
		);

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response("{}", {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				),
			),
		);

		const respA = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ipA,
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		const respB = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ipB,
			},
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(respA.status).toBe(429);
		expect(respB.status).toBe(200);
	});

	it("non-streaming JSON response: reconcile from body usage.total_tokens", async () => {
		const ip = "12.0.0.1";
		const jsonBody = JSON.stringify({ usage: { total_tokens: 800 } });

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response(jsonBody, {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				),
			),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: "hi" }],
				stream: false,
			}),
		});

		expect(resp.status).toBe(200);

		const now = Date.now();
		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey(ip, now)),
			kv().get(globalKey(now)),
		]);
		expect(Number(ipVal)).toBe(800);
		expect(Number(gVal)).toBe(800);
	});

	it("streaming with no usage chunk results in full refund (counters at 0)", async () => {
		const ip = "13.0.0.1";
		// SSE with no usage data
		const ssePayload = "data: {}\n\ndata: [DONE]\n\n";

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response(ssePayload, {
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					}),
				),
			),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		await resp.text();
		await new Promise((r) => setTimeout(r, 50));

		const now = Date.now();
		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey(ip, now)),
			kv().get(globalKey(now)),
		]);
		expect(Number(ipVal)).toBe(0);
		expect(Number(gVal)).toBe(0);
	});

	it("outbound body has stream_options.include_usage === true when stream:true", async () => {
		let capturedBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
				capturedBody = JSON.parse(init.body as string) as Record<
					string,
					unknown
				>;
				return new Response("data: [DONE]\n\n", {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				});
			}),
		);

		await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		expect(
			(capturedBody?.stream_options as Record<string, unknown> | undefined)
				?.include_usage,
		).toBe(true);
	});

	// ── smoke regression: stream-failure refund must persist to KV ──────────────
	// Reproduces the bug from attempt-1 smoke: the fire-and-forget
	// upstream.body.pipeTo(...).catch(async () => refundFull(...)) races against
	// worker-context teardown, so the KV put is cancelled and the counter stays
	// at seeded + preCharge instead of being refunded to seeded.
	it("stream failure mid-flight: per-IP counter is refunded back to seeded value (ctx.waitUntil fix)", async () => {
		const ip = "14.0.0.1";
		const seeded = 7_000;
		// Pre-seed the per-IP counter so we can tell whether a refund happened
		const now = Date.now();
		await kv().put(perIpKey(ip, now), String(seeded), {
			expirationTtl: 25 * 3600,
		});

		// Build an upstream response whose body errors mid-stream (no data sent)
		const erroringStream = new ReadableStream({
			start(controller) {
				// Immediately error the stream to simulate a mid-flight upstream failure
				controller.error(new Error("upstream disconnected mid-stream"));
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() =>
				Promise.resolve(
					new Response(erroringStream, {
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					}),
				),
			),
		);

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": ip,
			},
			body: JSON.stringify({
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}),
		});

		// Drain the client-side response — the erroring stream will throw here;
		// we catch it since we only care about the KV state afterwards.
		try {
			await resp.text();
		} catch {
			// expected: the upstream stream error propagates to the client reader
		}

		// Allow ctx.waitUntil promises to settle
		await new Promise((r) => setTimeout(r, 100));

		const ipVal = await kv().get(perIpKey(ip, Date.now()));
		// The pre-charge (4000) was added on top of seeded (7000) → 11000.
		// After the stream error the full pre-charge must be refunded → back to 7000.
		// Without ctx.waitUntil the KV put is cancelled and counter stays at 11000.
		expect(Number(ipVal)).toBe(seeded);
	});
});

// ── 10. CORS — OPTIONS preflight (issue #38) ──────────────────────────────────
//
// vitest.config.ts sets ALLOWED_ORIGINS = "https://app.example,http://localhost:5173"

describe("OPTIONS /v1/chat/completions — CORS preflight", () => {
	it("returns 204 with ACAO/ACAM/ACAH for an allow-listed origin", async () => {
		const resp = await SELF.fetch(ENDPOINT, {
			method: "OPTIONS",
			headers: {
				Origin: "https://app.example",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "X-Test",
			},
		});

		expect(resp.status).toBe(204);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
		expect(resp.headers.get("Access-Control-Allow-Methods")).toBe(
			"POST, OPTIONS",
		);
		// ACAH must echo the custom header sent in Access-Control-Request-Headers
		expect(resp.headers.get("Access-Control-Allow-Headers")).toBe("X-Test");
	});

	it("returns 204 WITHOUT ACAO for an unlisted origin", async () => {
		const resp = await SELF.fetch(ENDPOINT, {
			method: "OPTIONS",
			headers: {
				Origin: "https://evil.com",
				"Access-Control-Request-Method": "POST",
			},
		});

		expect(resp.status).toBe(204);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("returns 204 with Vary: Origin regardless of origin allow-list status", async () => {
		const resp = await SELF.fetch(ENDPOINT, {
			method: "OPTIONS",
			headers: {
				Origin: "https://evil.com",
				"Access-Control-Request-Method": "POST",
			},
		});

		expect(resp.status).toBe(204);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});
});

// ── 11. CORS — POST response headers (issue #38) ─────────────────────────────

describe("POST /v1/chat/completions — CORS response headers", () => {
	it("adds ACAO + Vary: Origin for an allow-listed origin", async () => {
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "https://app.example",
			},
			body: VALID_BODY,
		});

		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});

	it("supports the second origin in a multi-origin allow-list (localhost:5173)", async () => {
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "http://localhost:5173",
			},
			body: VALID_BODY,
		});

		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5173",
		);
	});

	it("does NOT add ACAO for an unlisted origin", async () => {
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: "https://evil.com",
			},
			body: VALID_BODY,
		});

		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("does NOT add ACAO when Origin header is absent", async () => {
		vi.stubGlobal("fetch", makeUpstreamMock("{}"));

		const resp = await SELF.fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: VALID_BODY,
		});

		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});
});
