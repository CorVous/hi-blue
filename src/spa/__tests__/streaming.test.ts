import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamCompletion } from "../streaming.js";

// __WORKER_BASE_URL__ is a build-time constant; provide a stub for tests
// biome-ignore lint/suspicious/noExplicitAny: stubbing a build-time constant
(globalThis as any).__WORKER_BASE_URL__ = "http://localhost:8787";

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

describe("streamCompletion", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls fetch with correct URL and body", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(
					makeSSEStream([
						`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\ndata: [DONE]\n\n`,
					]),
				),
			);
		vi.stubGlobal("fetch", mockFetch);

		await streamCompletion({
			baseUrl: "http://localhost:8787",
			message: "hello",
			onDelta: vi.fn(),
		});

		expect(mockFetch).toHaveBeenCalledOnce();
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://localhost:8787/v1/chat/completions");
		expect(init.method).toBe("POST");
		const bodyParsed = JSON.parse(init.body as string);
		expect(bodyParsed).toEqual({
			messages: [{ role: "user", content: "hello" }],
			stream: true,
		});
		expect(bodyParsed).not.toHaveProperty("model");
	});

	it("emits deltas in order", async () => {
		const sseData = [
			`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
			`data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
			`data: [DONE]\n\n`,
		].join("");

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([sseData]))),
		);

		const deltas: string[] = [];
		await streamCompletion({
			baseUrl: "http://localhost:8787",
			message: "test",
			onDelta: (text) => deltas.push(text),
		});

		expect(deltas).toEqual(["Hello", " world"]);
	});

	it("handles SSE events split across chunk boundaries", async () => {
		// Split "data: {...}\n\ndata: [DONE]\n\n" into two chunks mid-event
		const fullEvent = `data: ${JSON.stringify({ choices: [{ delta: { content: "split" } }] })}\n\ndata: [DONE]\n\n`;
		const midpoint = Math.floor(fullEvent.length / 2);
		const chunk1 = fullEvent.slice(0, midpoint);
		const chunk2 = fullEvent.slice(midpoint);

		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(makeFetchResponse(makeSSEStream([chunk1, chunk2]))),
		);

		const deltas: string[] = [];
		await streamCompletion({
			baseUrl: "http://localhost:8787",
			message: "test",
			onDelta: (text) => deltas.push(text),
		});

		expect(deltas).toEqual(["split"]);
	});

	it("ignores usage-only chunks without choices[0].delta.content", async () => {
		const usageChunk = JSON.stringify({
			choices: [],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});

		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					makeFetchResponse(
						makeSSEStream([`data: ${usageChunk}\n\ndata: [DONE]\n\n`]),
					),
				),
		);

		const onDelta = vi.fn();
		await streamCompletion({
			baseUrl: "http://localhost:8787",
			message: "test",
			onDelta,
		});

		expect(onDelta).not.toHaveBeenCalled();
	});

	it("[DONE] terminates stream without emitting", async () => {
		const sseData = `data: [DONE]\n\n`;

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([sseData]))),
		);

		const onDelta = vi.fn();
		await streamCompletion({
			baseUrl: "http://localhost:8787",
			message: "test",
			onDelta,
		});

		expect(onDelta).not.toHaveBeenCalled();
	});

	it("throws on non-ok response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([]), false)),
		);

		await expect(
			streamCompletion({
				baseUrl: "http://localhost:8787",
				message: "test",
				onDelta: vi.fn(),
			}),
		).rejects.toThrow(/HTTP 500/);
	});
});
