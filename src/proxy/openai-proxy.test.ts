import { env, reset, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PINNED_PROVIDER_ROUTING } from "../model";
import {
	FORWARDED_BODY_FIELDS,
	OPENROUTER_URL,
	PINNED_MODEL,
} from "./openai-proxy";
import { _setPricingCacheForTests } from "./pricing";
import { globalKey, perIpKey } from "./rate-guard";

const ENDPOINT = "https://example.com/v1/chat/completions";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SSE_HEADERS = { "Content-Type": "text/event-stream" };

const USER_HI = [{ role: "user", content: "hi" }];

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

function postChat(
	body: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	return SELF.fetch(ENDPOINT, {
		method: "POST",
		headers: { ...JSON_HEADERS, ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function postChatFrom(ip: string, body: unknown): Promise<Response> {
	return postChat(body, { "CF-Connecting-IP": ip });
}

function makeUpstreamMock(
	body: BodyInit,
	status = 200,
	headers: Record<string, string> = SSE_HEADERS,
): typeof fetch {
	return vi
		.fn()
		.mockImplementation(() =>
			Promise.resolve(new Response(body, { status, headers })),
		);
}

function stubUpstream(
	body: BodyInit,
	status = 200,
	headers: Record<string, string> = SSE_HEADERS,
): void {
	vi.stubGlobal("fetch", makeUpstreamMock(body, status, headers));
}

interface CapturedUpstreamRequest {
	url?: string;
	headers?: Record<string, string>;
	body?: Record<string, unknown>;
}

function captureUpstreamRequest(
	responseBody = "{}",
	responseHeaders: Record<string, string> = JSON_HEADERS,
): CapturedUpstreamRequest {
	const captured: CapturedUpstreamRequest = {};
	vi.stubGlobal(
		"fetch",
		vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
			captured.url = url;
			captured.headers = init.headers as Record<string, string>;
			captured.body = JSON.parse(init.body as string) as Record<
				string,
				unknown
			>;
			return new Response(responseBody, {
				status: 200,
				headers: responseHeaders,
			});
		}),
	);
	return captured;
}

async function forwardedBodyFor(
	body: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
	const captured = captureUpstreamRequest();
	await postChat(body);
	return captured.body;
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
	vi.restoreAllMocks();
	_setPricingCacheForTests(null);
	await reset();
});

describe("POST /v1/chat/completions — streaming pass-through", () => {
	it("returns 200 with text/event-stream when upstream does", async () => {
		const stream = "data: {}\n\ndata: [DONE]\n\n";
		stubUpstream(stream);

		const resp = await postChat(VALID_BODY);

		expect(resp.status).toBe(200);
		expect(resp.headers.get("Content-Type")).toContain("text/event-stream");
		const text = await resp.text();
		expect(text).toBe(stream);
	});
});

describe("POST /v1/chat/completions — model pinning", () => {
	it.each([
		["even when caller sends gpt-4o", { model: "gpt-4o", messages: USER_HI }],
		["when caller omits model", { messages: USER_HI }],
	])("pins model to PINNED_MODEL %s", async (_case, body) => {
		const forwarded = await forwardedBodyFor(body);

		expect(forwarded?.model).toBe(PINNED_MODEL);
	});

	it("pins provider routing even when caller asks for another provider", async () => {
		const forwarded = await forwardedBodyFor({
			messages: USER_HI,
			provider: { order: ["some-cheap-host"], allow_fallbacks: true },
		});

		expect(forwarded?.provider).toEqual(PINNED_PROVIDER_ROUTING);
	});
});

describe("POST /v1/chat/completions — forwarded body fields", () => {
	it("forwards every field the SPA sends", async () => {
		const spaFields = {
			messages: USER_HI,
			stream: false,
			usage: { include: true },
			tools: [{ type: "function", function: { name: "message" } }],
			tool_choice: "auto",
			parallel_tool_calls: true,
			reasoning: { enabled: false },
			response_format: { type: "json_object" },
		};

		const forwarded = await forwardedBodyFor(spaFields);

		expect(forwarded).toMatchObject(spaFields);
	});

	it("forwards standard sampling fields", async () => {
		const sampling = {
			temperature: 0.7,
			top_p: 0.9,
			max_tokens: 256,
			stop: ["\n"],
			seed: 42,
		};

		const forwarded = await forwardedBodyFor({
			messages: USER_HI,
			...sampling,
		});

		expect(forwarded).toMatchObject(sampling);
	});

	it("drops fields outside the allow-list", async () => {
		const forwarded = await forwardedBodyFor({
			messages: USER_HI,
			models: ["openai/gpt-4o", "anthropic/claude-opus"],
			transforms: ["middle-out"],
			plugins: [{ id: "web" }],
		});

		expect(forwarded).toBeDefined();
		expect(forwarded).not.toHaveProperty("models");
		expect(forwarded).not.toHaveProperty("transforms");
		expect(forwarded).not.toHaveProperty("plugins");
		for (const key of Object.keys(forwarded ?? {})) {
			expect([...FORWARDED_BODY_FIELDS, "model", "provider"]).toContain(key);
		}
	});
});

describe("POST /v1/chat/completions — upstream request", () => {
	it("forwards Authorization: Bearer <secret> to OpenRouter", async () => {
		const captured = captureUpstreamRequest();

		await postChat(VALID_BODY);

		expect(captured.headers?.Authorization).toBe("Bearer test-openrouter-key");
	});

	it("forwards POST to the correct OpenRouter URL", async () => {
		const captured = captureUpstreamRequest();

		await postChat(VALID_BODY);

		expect(captured.url).toBe(OPENROUTER_URL);
	});
});

describe("POST /v1/chat/completions — input validation", () => {
	it.each([
		["invalid JSON body", "not-json"],
		["missing messages array", { model: "gpt-4o" }],
		["empty messages array", { messages: [] }],
	])("returns 400 invalid_request_error for %s", async (_case, body) => {
		stubUpstream("{}");

		const resp = await postChat(body);

		expect(resp.status).toBe(400);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("invalid_request_error");
	});
});

describe("POST /v1/chat/completions — upstream errors", () => {
	it("returns 502 upstream_error when upstream returns 5xx", async () => {
		stubUpstream("Internal Server Error", 500, {
			"Content-Type": "text/plain",
		});

		const resp = await postChat(VALID_BODY);

		expect(resp.status).toBe(502);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("upstream_error");
	});

	it("returns 502 upstream_error when fetch throws (network failure)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:443")),
		);

		const resp = await postChat(VALID_BODY);

		expect(resp.status).toBe(502);
		const json = (await resp.json()) as {
			error: { type: string; message: string };
		};
		expect(json.error.type).toBe("upstream_error");
		expect(json.error.message).not.toContain("ECONNREFUSED");
	});

	it("passes an upstream 400 through with its status and body", async () => {
		const upstreamBody = JSON.stringify({
			error: { message: "context too long", code: 400 },
		});
		stubUpstream(upstreamBody, 400, JSON_HEADERS);

		const resp = await postChat(VALID_BODY);

		expect(resp.status).toBe(400);
		expect(resp.headers.get("Content-Type")).toBe("application/json");
		expect(await resp.text()).toBe(upstreamBody);
	});

	it("passes an upstream 429 through with its body and Retry-After", async () => {
		const upstreamBody = JSON.stringify({
			error: { message: "Provider rate limited", code: 429 },
		});
		stubUpstream(upstreamBody, 429, { ...JSON_HEADERS, "Retry-After": "7" });

		const resp = await postChat(VALID_BODY);

		expect(resp.status).toBe(429);
		expect(resp.headers.get("Retry-After")).toBe("7");
		expect(await resp.text()).toBe(upstreamBody);
	});
});

describe("POST /v1/chat/completions — stream flag", () => {
	it.each([
		["string", "true"],
		["number", 1],
		["null", null],
		["object", {}],
	])("returns 400 when stream is a %s, without calling upstream", async (_kind, stream) => {
		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		const resp = await postChat({ messages: USER_HI, stream });

		expect(resp.status).toBe(400);
		const json = (await resp.json()) as { error: { type: string } };
		expect(json.error.type).toBe("invalid_request_error");
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("preserves stream:true and forces stream_options.include_usage in the outbound body", async () => {
		const captured = captureUpstreamRequest("data: [DONE]\n\n", SSE_HEADERS);

		await postChat({ model: "gpt-4o", messages: USER_HI, stream: true });

		expect(captured.body?.stream).toBe(true);
		expect(
			(captured.body?.stream_options as Record<string, unknown> | undefined)
				?.include_usage,
		).toBe(true);
	});
});

function kv(): KVNamespace {
	return (env as Record<string, KVNamespace>).RATE_GUARD_KV as KVNamespace;
}

const VITEST_CONFIG_PER_IP_CAP_MICRO_USD = 20_000;
const VITEST_CONFIG_GLOBAL_CAP_MICRO_USD = 1_000_000;
const VITEST_CONFIG_PRE_CHARGE_MICRO_USD = 4_000;

function seedOnePastPreChargeHeadroom(key: string, capMicroUsd: number) {
	return kv().put(
		key,
		String(capMicroUsd - VITEST_CONFIG_PRE_CHARGE_MICRO_USD + 1),
		{ expirationTtl: 25 * 3600 },
	);
}

async function countersFor(ip: string): Promise<[number, number]> {
	const now = Date.now();
	const [ipVal, gVal] = await Promise.all([
		kv().get(perIpKey(ip, now)),
		kv().get(globalKey(now)),
	]);
	return [Number(ipVal), Number(gVal)];
}

async function waitForCounters(ip: string, expected: string): Promise<void> {
	const now = Date.now();
	await Promise.all([
		waitForCounter(kv(), perIpKey(ip, now), expected),
		waitForCounter(kv(), globalKey(now), expected),
	]);
}

describe("cost-guard integration — POST /v1/chat/completions", () => {
	it("per-IP cap-hit returns 429 with error.code === 'per-ip-daily', upstream not called", async () => {
		const ip = "5.5.5.5";
		await seedOnePastPreChargeHeadroom(
			perIpKey(ip, Date.now()),
			VITEST_CONFIG_PER_IP_CAP_MICRO_USD,
		);
		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		const resp = await postChatFrom(ip, { messages: USER_HI });

		expect(resp.status).toBe(429);
		const body = (await resp.json()) as {
			error: { type: string; code: string };
		};
		expect(body.error.type).toBe("rate_limit_exceeded");
		expect(body.error.code).toBe("per-ip-daily");
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("global cap-hit returns 429 with error.code === 'global-daily'", async () => {
		await seedOnePastPreChargeHeadroom(
			globalKey(Date.now()),
			VITEST_CONFIG_GLOBAL_CAP_MICRO_USD,
		);
		vi.stubGlobal("fetch", vi.fn());

		const resp = await postChatFrom("6.6.6.6", { messages: USER_HI });

		expect(resp.status).toBe(429);
		const body = (await resp.json()) as {
			error: { code: string };
		};
		expect(body.error.code).toBe("global-daily");
	});

	it("happy path streaming: upstream usage 500/1000 → counters reconcile to 1500 micro-USD", async () => {
		const ip = "7.7.7.7";
		stubUpstream(
			'data: {"usage":{"prompt_tokens":500,"completion_tokens":1000}}\n\ndata: [DONE]\n\n',
		);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

		expect(resp.status).toBe(200);
		await resp.text();
		await waitForCounters(ip, "1500");
	});

	it("over-charge is billed: upstream usage 3000/6000 → counters rise to the actual 9000", async () => {
		const ip = "8.8.8.8";
		stubUpstream(
			'data: {"usage":{"prompt_tokens":3000,"completion_tokens":6000}}\n\ndata: [DONE]\n\n',
		);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

		await resp.text();
		await waitForCounters(ip, "9000");
	});

	it("upstream 5xx returns 502 to client and counters return to 0", async () => {
		const ip = "9.9.9.9";
		stubUpstream("Internal Server Error", 500, {
			"Content-Type": "text/plain",
		});

		const resp = await postChatFrom(ip, { messages: USER_HI });

		expect(resp.status).toBe(502);
		expect(await countersFor(ip)).toEqual([0, 0]);
	});

	it("upstream 4xx is passed through and counters return to 0", async () => {
		const ip = "9.9.9.10";
		stubUpstream('{"error":{"message":"rate limited"}}', 429, JSON_HEADERS);

		const resp = await postChatFrom(ip, { messages: USER_HI });

		expect(resp.status).toBe(429);
		expect(await countersFor(ip)).toEqual([0, 0]);
	});

	it("non-boolean stream is rejected before any pre-charge", async () => {
		const ip = "9.9.9.11";
		vi.stubGlobal("fetch", vi.fn());

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: "true" });

		expect(resp.status).toBe(400);
		expect(await kv().get(perIpKey(ip, Date.now()))).toBeNull();
	});

	it("IPv6 clients in the same /64 share one per-IP counter", async () => {
		await seedOnePastPreChargeHeadroom(
			perIpKey("2001:db8:1:2::1", Date.now()),
			VITEST_CONFIG_PER_IP_CAP_MICRO_USD,
		);
		const mockFetch = vi.fn();
		vi.stubGlobal("fetch", mockFetch);

		const resp = await postChatFrom("2001:db8:1:2:aaaa:bbbb:cccc:dddd", {
			messages: USER_HI,
		});

		expect(resp.status).toBe(429);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("upstream fetch throws returns 502 and counters return to 0", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const ip = "10.0.0.1";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network error")),
		);

		const resp = await postChatFrom(ip, { messages: USER_HI });

		expect(resp.status).toBe(502);
		expect(await countersFor(ip)).toEqual([0, 0]);
	});

	it("multi-IP isolation: IP A capped does not affect IP B", async () => {
		const ipA = "11.0.0.1";
		const ipB = "11.0.0.2";
		await seedOnePastPreChargeHeadroom(
			perIpKey(ipA, Date.now()),
			VITEST_CONFIG_PER_IP_CAP_MICRO_USD,
		);
		stubUpstream("{}", 200, JSON_HEADERS);

		const respA = await postChatFrom(ipA, { messages: USER_HI });
		const respB = await postChatFrom(ipB, { messages: USER_HI });

		expect(respA.status).toBe(429);
		expect(respB.status).toBe(200);
	});

	it("non-streaming JSON response: reconcile from prompt_tokens + completion_tokens", async () => {
		const ip = "12.0.0.1";
		stubUpstream(
			JSON.stringify({ usage: { prompt_tokens: 300, completion_tokens: 500 } }),
			200,
			JSON_HEADERS,
		);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: false });

		expect(resp.status).toBe(200);
		expect(await countersFor(ip)).toEqual([800, 800]);
	});

	it.each([
		["null", "16.0.0.1"],
		["42", "16.0.0.2"],
		['"text"', "16.0.0.3"],
	])("non-streaming JSON body %s is relayed with a full refund", async (body, ip) => {
		stubUpstream(body, 200, JSON_HEADERS);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: false });

		expect(resp.status).toBe(200);
		expect(await resp.text()).toBe(body);
		expect(await countersFor(ip)).toEqual([0, 0]);
	});

	it("streaming data: null line does not break usage reconciliation", async () => {
		const ip = "16.0.0.4";
		const ssePayload =
			'data: null\n\ndata: {"usage":{"prompt_tokens":200,"completion_tokens":300}}\n\ndata: [DONE]\n\n';
		stubUpstream(ssePayload);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

		expect(await resp.text()).toBe(ssePayload);
		await waitForCounters(ip, "500");
	});

	it("streaming with no usage chunk results in full refund (counters at 0)", async () => {
		const ip = "13.0.0.1";
		stubUpstream("data: {}\n\ndata: [DONE]\n\n");

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

		await resp.text();
		await waitForCounters(ip, "0");
	});

	it("differentiated pricing: prompt vs completion priced separately", async () => {
		_setPricingCacheForTests({
			promptMicroUsdPerToken: 2,
			completionMicroUsdPerToken: 5,
		});
		const ip = "15.0.0.1";
		stubUpstream(
			JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 200 } }),
			200,
			JSON_HEADERS,
		);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: false });

		expect(resp.status).toBe(200);
		const ipVal = await kv().get(perIpKey(ip, Date.now()));
		expect(Number(ipVal)).toBe(1200);
	});

	it("stream failure mid-flight before usage: the pre-charge is kept (ctx.waitUntil fix)", async () => {
		const ip = "14.0.0.1";
		const seeded = 7_000;
		await kv().put(perIpKey(ip, Date.now()), String(seeded), {
			expirationTtl: 25 * 3600,
		});
		stubUpstream(
			new ReadableStream({
				start(controller) {
					controller.error(new Error("upstream disconnected mid-stream"));
				},
			}),
		);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

		await resp.text().catch(() => undefined);

		const ipKey = perIpKey(ip, Date.now());
		await waitForCounter(
			kv(),
			ipKey,
			String(seeded + VITEST_CONFIG_PRE_CHARGE_MICRO_USD),
		);
		await new Promise((r) => setTimeout(r, 50));
		expect(Number(await kv().get(ipKey))).toBe(
			seeded + VITEST_CONFIG_PRE_CHARGE_MICRO_USD,
		);
	});

	it("stream failure after the usage chunk settles with the parsed usage", async () => {
		const ip = "14.0.0.2";
		const usageChunk = new TextEncoder().encode(
			'data: {"usage":{"prompt_tokens":300,"completion_tokens":200}}\n\n',
		);
		let pulls = 0;
		stubUpstream(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					pulls += 1;
					if (pulls === 1) {
						controller.enqueue(usageChunk);
						return;
					}
					controller.error(new Error("client went away"));
				},
			}),
		);

		const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

		await resp.text().catch(() => undefined);
		await waitForCounters(ip, "500");
	});

	describe("prompt-cache discount: upstream usage.cost is authoritative over token-count pricing", () => {
		it("streaming: prefers upstream usage.cost over local recompute", async () => {
			const ip = "11.0.0.1";
			stubUpstream(
				'data: {"usage":{"prompt_tokens":500,"completion_tokens":1000,"cost":0.000200,"prompt_tokens_details":{"cached_tokens":480}}}\n\ndata: [DONE]\n\n',
			);

			const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

			expect(resp.status).toBe(200);
			await resp.text();
			await waitForCounter(kv(), perIpKey(ip, Date.now()), "200");
		});

		it("non-streaming: prefers upstream usage.cost over local recompute", async () => {
			const ip = "11.0.0.2";
			stubUpstream(
				JSON.stringify({
					choices: [{ message: { content: "ok" } }],
					usage: {
						prompt_tokens: 300,
						completion_tokens: 500,
						cost: 0.00015,
						prompt_tokens_details: { cached_tokens: 250 },
					},
				}),
				200,
				JSON_HEADERS,
			);

			await postChatFrom(ip, { messages: USER_HI });

			await waitForCounter(kv(), perIpKey(ip, Date.now()), "150");
		});

		it("falls back to local price recompute when upstream cost is absent", async () => {
			const ip = "11.0.0.3";
			stubUpstream(
				'data: {"usage":{"prompt_tokens":500,"completion_tokens":1000,"prompt_tokens_details":{"cached_tokens":400}}}\n\ndata: [DONE]\n\n',
			);

			const resp = await postChatFrom(ip, { messages: USER_HI, stream: true });

			await resp.text();
			await waitForCounter(kv(), perIpKey(ip, Date.now()), "1500");
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
		stubUpstream("{}");

		const resp = await postChat(VALID_BODY, { Origin: "https://app.example" });

		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.example",
		);
		expect(resp.headers.get("Vary")).toBe("Origin");
	});

	it("POST does NOT add ACAO for an unlisted origin", async () => {
		stubUpstream("{}");

		const resp = await postChat(VALID_BODY, { Origin: "https://evil.com" });

		expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});
});
