import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PINNED_MODEL } from "../../model.js";
import {
	CapHitError,
	PERSONA_PLACEHOLDER,
	parseCapHitFromResponse,
	resolveLLMTarget,
	streamChat,
	streamCompletion,
} from "../llm-client.js";

// Provide __WORKER_BASE_URL__ global before importing the module
// biome-ignore lint/suspicious/noExplicitAny: stubbing a build-time constant
(globalThis as any).__WORKER_BASE_URL__ = "http://localhost:8787";

const WORKER_COMPLETIONS_URL = "http://localhost:8787/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

function makeFetchResponse(
	body: ReadableStream<Uint8Array>,
	ok = true,
): Response {
	return {
		ok,
		status: ok ? 200 : 500,
		statusText: ok ? "OK" : "Internal Server Error",
		body,
		headers: { get: () => null },
	} as unknown as Response;
}

function make429Response(
	body: unknown,
	retryAfter: string | null = null,
): Response {
	return {
		ok: false,
		status: 429,
		statusText: "Too Many Requests",
		headers: {
			get: (name: string) =>
				name.toLowerCase() === "retry-after" ? retryAfter : null,
		},
		json: () => Promise.resolve(body),
	} as unknown as Response;
}

describe("resolveLLMTarget", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns OpenRouter URL and Bearer header when key present", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue("sk-test-key"),
		});

		const { url, headers } = resolveLLMTarget();

		expect(url).toBe(OPENROUTER_URL);
		expect(headers.Authorization).toBe("Bearer sk-test-key");
		expect(headers["Content-Type"]).toBe("application/json");
	});

	it("returns Worker URL and no Authorization header when key absent", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		const { url, headers } = resolveLLMTarget();

		expect(url).toBe(WORKER_COMPLETIONS_URL);
		expect(headers).not.toHaveProperty("Authorization");
		expect(headers["Content-Type"]).toBe("application/json");
	});

	it("treats empty-string key as absent (falls back to free-tier)", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(""),
		});

		const { url, headers } = resolveLLMTarget();

		expect(url).toBe(WORKER_COMPLETIONS_URL);
		expect(headers).not.toHaveProperty("Authorization");
	});

	it("falls back to free-tier when localStorage.getItem throws (no exception)", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockImplementation(() => {
				throw new Error("SecurityError: access denied");
			}),
		});

		let result: ReturnType<typeof resolveLLMTarget> | undefined;
		expect(() => {
			result = resolveLLMTarget();
		}).not.toThrow();

		expect(result?.url).toBe(WORKER_COMPLETIONS_URL);
		expect(result?.headers).not.toHaveProperty("Authorization");
	});
});

describe("parseCapHitFromResponse", () => {
	it("returns null for non-429 response", async () => {
		const response = {
			status: 200,
			headers: { get: () => null },
		} as unknown as Response;
		await expect(parseCapHitFromResponse(response)).resolves.toBeNull();
	});

	it("returns CapHitError with per-ip-daily reason", async () => {
		const response = make429Response({
			error: {
				message: "daily cap hit",
				type: "rate_limit_exceeded",
				code: "per-ip-daily",
			},
		});
		const err = await parseCapHitFromResponse(response);
		expect(err).toBeInstanceOf(CapHitError);
		expect(err?.reason).toBe("per-ip-daily");
		expect(err?.message).toBe("daily cap hit");
		expect(err?.status).toBe(429);
		expect(err?.retryAfterSec).toBeNull();
	});

	it("returns CapHitError with global-daily reason", async () => {
		const response = make429Response({
			error: {
				message: "global cap hit",
				type: "rate_limit_exceeded",
				code: "global-daily",
			},
		});
		const err = await parseCapHitFromResponse(response);
		expect(err).toBeInstanceOf(CapHitError);
		expect(err?.reason).toBe("global-daily");
	});

	it("parses Retry-After header into retryAfterSec", async () => {
		const response = make429Response(
			{
				error: {
					message: "cap hit",
					type: "rate_limit_exceeded",
					code: "per-ip-daily",
				},
			},
			"3600",
		);
		const err = await parseCapHitFromResponse(response);
		expect(err?.retryAfterSec).toBe(3600);
	});

	it("falls back to reason:unknown when body is malformed JSON", async () => {
		const response: Response = {
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
			headers: { get: () => null },
			json: () => Promise.reject(new SyntaxError("bad json")),
		} as unknown as Response;
		const err = await parseCapHitFromResponse(response);
		expect(err).toBeInstanceOf(CapHitError);
		expect(err?.reason).toBe("unknown");
		expect(err?.retryAfterSec).toBeNull();
	});

	it("falls back to reason:unknown when 429 body lacks rate_limit_exceeded type", async () => {
		const response = make429Response({ error: { type: "other_error" } });
		const err = await parseCapHitFromResponse(response);
		expect(err).toBeInstanceOf(CapHitError);
		expect(err?.reason).toBe("unknown");
	});

	it("falls back to reason:unknown when 429 body has no error field", async () => {
		const response = make429Response({ message: "too many requests" });
		const err = await parseCapHitFromResponse(response);
		expect(err).toBeInstanceOf(CapHitError);
		expect(err?.reason).toBe("unknown");
	});
});

describe("streamChat", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("prepends persona placeholder as messages[0]", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		await streamChat({ message: "hello", onDelta: vi.fn() });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.messages[0]).toEqual({
			role: "system",
			content: PERSONA_PLACEHOLDER,
		});
		expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
	});

	it("POSTs to OpenRouter with Authorization when BYOK key is set (kill-line: not the Worker)", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue("sk-byok-key"),
		});

		await streamChat({ message: "hello", onDelta: vi.fn() });

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(OPENROUTER_URL);
		expect(url).not.toContain("localhost:8787");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer sk-byok-key",
		);
	});

	it("POSTs to Worker URL with no Authorization header when no key", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		await streamChat({ message: "hello", onDelta: vi.fn() });

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(WORKER_COMPLETIONS_URL);
		expect(init.headers as Record<string, string>).not.toHaveProperty(
			"Authorization",
		);
	});

	it("emits a delta via parseSSEStream (happy-path wiring check)", async () => {
		const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi!" } }] })}\n\ndata: [DONE]\n\n`;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([sseData]))),
		);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		const deltas: string[] = [];
		await streamChat({ message: "test", onDelta: (t) => deltas.push(t) });

		expect(deltas).toEqual(["hi!"]);
	});

	it("throws on non-ok response with HTTP status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([]), false)),
		);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		await expect(
			streamChat({ message: "test", onDelta: vi.fn() }),
		).rejects.toThrow(/HTTP 500/);
	});

	it("throws CapHitError when fetch returns 429 with rate_limit_exceeded body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				make429Response(
					{
						error: {
							message: "per-ip cap hit",
							type: "rate_limit_exceeded",
							code: "per-ip-daily",
						},
					},
					"86400",
				),
			),
		);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		const err = await streamChat({ message: "test", onDelta: vi.fn() }).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(CapHitError);
		const capErr = err as CapHitError;
		expect(capErr.reason).toBe("per-ip-daily");
		expect(capErr.retryAfterSec).toBe(86400);
		expect(capErr.status).toBe(429);
	});

	it("throws CapHitError with reason:unknown when 429 body is malformed", async () => {
		const response: Response = {
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
			headers: { get: () => null },
			json: () => Promise.reject(new SyntaxError("bad json")),
		} as unknown as Response;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		const err = await streamChat({ message: "test", onDelta: vi.fn() }).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(CapHitError);
		expect((err as CapHitError).reason).toBe("unknown");
	});

	it("still throws generic HTTP error for non-429 failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([]), false)),
		);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		await expect(
			streamChat({ message: "test", onDelta: vi.fn() }),
		).rejects.toThrow(/HTTP 500/);
	});

	it("sends model: PINNED_MODEL on the free-tier path", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		await streamChat({ message: "hello", onDelta: vi.fn() });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string).model).toBe("z-ai/glm-4.7-flash");
		expect(JSON.parse(init.body as string).model).toBe(PINNED_MODEL);
	});

	it("sends model: PINNED_MODEL on the BYOK path", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue("sk-byok-key"),
		});

		await streamChat({ message: "hello", onDelta: vi.fn() });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(init.body as string).model).toBe("z-ai/glm-4.7-flash");
		expect(JSON.parse(init.body as string).model).toBe(PINNED_MODEL);
	});
});

describe("streamCompletion", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards messages[] verbatim without prepending a placeholder", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue(null),
		});

		const customMessages = [
			{ role: "system" as const, content: "You are a custom assistant." },
			{ role: "user" as const, content: "hello" },
		];

		await streamCompletion({ messages: customMessages, onDelta: vi.fn() });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.messages).toEqual(customMessages);
		// Ensure the PERSONA_PLACEHOLDER is NOT injected
		expect(JSON.stringify(body.messages)).not.toContain(PERSONA_PLACEHOLDER);
	});

	it("POSTs to OpenRouter with Authorization when BYOK key is set", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);
		vi.stubGlobal("localStorage", {
			getItem: vi.fn().mockReturnValue("sk-byok-key"),
		});

		await streamCompletion({
			messages: [{ role: "user", content: "hello" }],
			onDelta: vi.fn(),
		});

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(OPENROUTER_URL);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer sk-byok-key",
		);
	});
});
