import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PERSONA_PLACEHOLDER,
	resolveLLMTarget,
	streamChat,
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
});
