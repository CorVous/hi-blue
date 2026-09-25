import { env, reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENROUTER_URL, PINNED_MODEL } from "./openai-proxy";
import { _setPricingCacheForTests } from "./pricing";
import { globalKey, perIpKey } from "./rate-guard";

const ENDPOINT = "https://example.com/v1/chat/completions";

async function waitForCounter(
	kvNs: KVNamespace,
	key: string,
	expected: string,
	{ timeoutMs = 1000 } = {},
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const v = await kvNs.get(key);
		if (v === expected) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	const final = await kvNs.get(key);
	throw new Error(
		`counter ${key} did not reach expected ${expected}, got ${final} within ${timeoutMs}ms`,
	);
}

const VALID_BODY = JSON.stringify({
	model: "gpt-4o",
	messages: [{ role: "user", content: "Hello" }],
});

function makeUpstreamMock(
	body: BodyInit,
	status = 200,
	headers: Record<string, string> = { "Content-Type": "text/event-stream" },
): typeof fetch {
	return vi
		.fn()
		.mockImplementation(() =>
			Promise.resolve(new Response(body, { status, headers })),
		);
}

const ONE_MICRO_USD_PER_TOKEN = {
	promptMicroUsdPerToken: 1,
	completionMicroUsdPerToken: 1,
};

beforeEach(() => {
	_setPricingCacheForTests(ONE_MICRO_USD_PER_TOKEN);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	_setPricingCacheForTests(null);
	await reset();
});

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

		expect(capturedHeaders?.Authorization).toBe("Bearer test-openrouter-key");
	});
});

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

describe("POST /v1/chat/completions — input validation", () => {
	it("returns 400 invalid_request_error for invalid JSON body", async () => {
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

function kv(): KVNamespace {
	return (env as Record<string, KVNamespace>).RATE_GUARD_KV as KVNamespace;
}

const VITEST_CONFIG_PER_IP_CAP_MICRO_USD = 20_000;
const VITEST_CONFIG_GLOBAL_CAP_MICRO_USD = 1_000_000;
const VITEST_CONFIG_PRE_CHARGE_MICRO_USD = 4_000;

describe("cost-guard integration — POST /v1/chat/completions", () => {
	beforeEach(async () => {
		const ns = kv();
		const listed = await ns.list();
		await Promise.all(listed.keys.map((k) => ns.delete(k.name)));
	});

	it("per-IP cap-hit returns 429 with error.code === 'per-ip-daily', upstream not called", async () => {
		const ip = "5.5.5.5";
		const ipK = perIpKey(ip, Date.now());
		await kv().put(
			ipK,
			String(
				VITEST_CONFIG_PER_IP_CAP_MICRO_USD -
					VITEST_CONFIG_PRE_CHARGE_MICRO_USD +
					1,
			),
			{
				expirationTtl: 25 * 3600,
			},
		);

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
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("global cap-hit returns 429 with error.code === 'global-daily'", async () => {
		const gK = globalKey(Date.now());
		await kv().put(
			gK,
			String(
				VITEST_CONFIG_GLOBAL_CAP_MICRO_USD -
					VITEST_CONFIG_PRE_CHARGE_MICRO_USD +
					1,
			),
			{
				expirationTtl: 25 * 3600,
			},
		);

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

	it("happy path streaming: upstream usage 500/1000 → counters reconcile to 1500 micro-USD", async () => {
		const ip = "7.7.7.7";
		const ssePayload =
			'data: {"usage":{"prompt_tokens":500,"completion_tokens":1000}}\n\ndata: [DONE]\n\n';

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
		await resp.text();

		const now = Date.now();
		await Promise.all([
			waitForCounter(kv(), perIpKey(ip, now), "1500"),
			waitForCounter(kv(), globalKey(now), "1500"),
		]);

		const [ipVal, gVal] = await Promise.all([
			kv().get(perIpKey(ip, now)),
			kv().get(globalKey(now)),
		]);

		expect(Number(ipVal)).toBe(1500);
		expect(Number(gVal)).toBe(1500);
	});

	it("over-charge accepted: upstream usage 3000/6000 → counters stay at pre-charge (4000)", async () => {
		const ip = "8.8.8.8";
		const ssePayload =
			'data: {"usage":{"prompt_tokens":3000,"completion_tokens":6000}}\n\ndata: [DONE]\n\n';

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

		const ipKey454 = perIpKey(ip, Date.now());
		await waitForCounter(
			kv(),
			ipKey454,
			String(VITEST_CONFIG_PRE_CHARGE_MICRO_USD),
		);

		const ipVal = await kv().get(ipKey454);
		expect(Number(ipVal)).toBe(VITEST_CONFIG_PRE_CHARGE_MICRO_USD);
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
		await kv().put(
			perIpKey(ipA, Date.now()),
			String(
				VITEST_CONFIG_PER_IP_CAP_MICRO_USD -
					VITEST_CONFIG_PRE_CHARGE_MICRO_USD +
					1,
			),
			{ expirationTtl: 25 * 3600 },
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

	it("non-streaming JSON response: reconcile from prompt_tokens + completion_tokens", async () => {
		const ip = "12.0.0.1";
		const jsonBody = JSON.stringify({
			usage: { prompt_tokens: 300, completion_tokens: 500 },
		});

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

		const now = Date.now();
		await Promise.all([
			waitForCounter(kv(), perIpKey(ip, now), "0"),
			waitForCounter(kv(), globalKey(now), "0"),
		]);

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

	it("differentiated pricing: prompt vs completion priced separately", async () => {
		_setPricingCacheForTests({
			promptMicroUsdPerToken: 2,
			completionMicroUsdPerToken: 5,
		});

		const ip = "15.0.0.1";
		const jsonBody = JSON.stringify({
			usage: { prompt_tokens: 100, completion_tokens: 200 },
		});

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

		const ipVal = await kv().get(perIpKey(ip, Date.now()));
		expect(Number(ipVal)).toBe(1200);
	});

	it("stream failure mid-flight: per-IP counter is refunded back to seeded value (ctx.waitUntil fix)", async () => {
		const ip = "14.0.0.1";
		const seeded = 7_000;
		const now = Date.now();
		await kv().put(perIpKey(ip, now), String(seeded), {
			expirationTtl: 25 * 3600,
		});

		const erroringStream = new ReadableStream({
			start(controller) {
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

		await resp.text().catch(() => undefined);

		const ipKey766 = perIpKey(ip, Date.now());
		await waitForCounter(kv(), ipKey766, String(seeded));

		const ipVal = await kv().get(ipKey766);
		expect(Number(ipVal)).toBe(seeded);
	});

	describe("prompt-cache discount: upstream usage.cost is authoritative over token-count pricing", () => {
		it("streaming: prefers upstream usage.cost over local recompute", async () => {
			const ip = "11.0.0.1";
			const ssePayload =
				'data: {"usage":{"prompt_tokens":500,"completion_tokens":1000,"cost":0.000200,"prompt_tokens_details":{"cached_tokens":480}}}\n\ndata: [DONE]\n\n';

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
			await resp.text();

			const ipKey812 = perIpKey(ip, Date.now());
			await waitForCounter(kv(), ipKey812, "200");

			const ipVal = await kv().get(ipKey812);
			expect(Number(ipVal)).toBe(200);
		});

		it("non-streaming: prefers upstream usage.cost over local recompute", async () => {
			const ip = "11.0.0.2";
			const responseBody = JSON.stringify({
				choices: [{ message: { content: "ok" } }],
				usage: {
					prompt_tokens: 300,
					completion_tokens: 500,
					cost: 0.00015,
					prompt_tokens_details: { cached_tokens: 250 },
				},
			});

			vi.stubGlobal(
				"fetch",
				vi.fn().mockImplementation(() =>
					Promise.resolve(
						new Response(responseBody, {
							status: 200,
							headers: { "Content-Type": "application/json" },
						}),
					),
				),
			);

			await SELF.fetch(ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": ip,
				},
				body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
			});

			const ipKey851 = perIpKey(ip, Date.now());
			await waitForCounter(kv(), ipKey851, "150");

			const ipVal = await kv().get(ipKey851);
			expect(Number(ipVal)).toBe(150);
		});

		it("falls back to local price recompute when upstream cost is absent", async () => {
			const ip = "11.0.0.3";
			const ssePayload =
				'data: {"usage":{"prompt_tokens":500,"completion_tokens":1000,"prompt_tokens_details":{"cached_tokens":400}}}\n\ndata: [DONE]\n\n';

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

			const ipKey888 = perIpKey(ip, Date.now());
			await waitForCounter(kv(), ipKey888, "1500");

			const ipVal = await kv().get(ipKey888);
			expect(Number(ipVal)).toBe(1500);
		});
	});
});

describe("/v1/chat/completions — CORS wiring (exhaustive cases in cors.test.ts)", () => {
	it("OPTIONS answers with the preflight built from the env allow-list", async () => {
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
		expect(resp.headers.get("Access-Control-Allow-Headers")).toBe("X-Test");
		expect(resp.headers.get("Vary")).toBe("Origin");
	});

	it("POST adds ACAO + Vary: Origin for an allow-listed origin", async () => {
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

	it("POST does NOT add ACAO for an unlisted origin", async () => {
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
});
