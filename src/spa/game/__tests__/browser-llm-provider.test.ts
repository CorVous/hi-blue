/**
 * Unit tests for BrowserLLMProvider live-delta callback (issue #102).
 *
 * Mocks globalThis.fetch with a real ReadableStream that enqueues two SSE
 * delta events. Asserts that streamRound(messages, tools, onDelta) invokes
 * onDelta once per delta in order, and that assistantText equals their concat.
 */
import { describe, expect, it, vi } from "vitest";
import { BrowserLLMProvider } from "../browser-llm-provider";

// Build-time globals are provided by src/spa/test-setup.ts

function makeSseBody(words: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const word of words) {
				const line = `data: ${JSON.stringify({ choices: [{ delta: { content: word }, finish_reason: null }] })}\n\n`;
				controller.enqueue(encoder.encode(line));
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
}

describe("BrowserLLMProvider.streamRound — onDelta callback", () => {
	it("invokes onDelta once per SSE chunk, in order", async () => {
		const words = ["hello ", "world"];

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(makeSseBody(words), {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		const provider = new BrowserLLMProvider();
		const received: string[] = [];

		const result = await provider.streamRound([], [], (text) => {
			received.push(text);
		});

		expect(received).toEqual(words);
		expect(result.assistantText).toBe("hello world");

		vi.restoreAllMocks();
	});

	it("invokes onDelta for each of three chunks and concatenates correctly", async () => {
		const words = ["alpha ", "beta ", "gamma."];

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(makeSseBody(words), {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		const provider = new BrowserLLMProvider();
		const received: string[] = [];

		const result = await provider.streamRound([], [], (text) => {
			received.push(text);
		});

		expect(received).toHaveLength(3);
		expect(received).toEqual(words);
		expect(result.assistantText).toBe("alpha beta gamma.");

		vi.restoreAllMocks();
	});

	it("still collects assistantText when onDelta is not provided", async () => {
		const words = ["one ", "two"];

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(makeSseBody(words), {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		const provider = new BrowserLLMProvider();
		const result = await provider.streamRound([], []);

		expect(result.assistantText).toBe("one two");

		vi.restoreAllMocks();
	});
});

describe("BrowserLLMProvider — reasoning default (issue #169)", () => {
	function captureRequestBody(): { getBody: () => Record<string, unknown> } {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(makeSseBody(["ok"]), {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		return {
			getBody: () => {
				const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
				return JSON.parse(String(init?.body)) as Record<string, unknown>;
			},
		};
	}

	it("disables reasoning by default (no opts)", async () => {
		const { getBody } = captureRequestBody();

		await new BrowserLLMProvider().streamRound([], []);

		expect(getBody().reasoning).toEqual({ enabled: false });

		vi.restoreAllMocks();
	});

	it("disables reasoning when constructed with { disableReasoning: true }", async () => {
		const { getBody } = captureRequestBody();

		await new BrowserLLMProvider({ disableReasoning: true }).streamRound(
			[],
			[],
		);

		expect(getBody().reasoning).toEqual({ enabled: false });

		vi.restoreAllMocks();
	});

	it("omits the reasoning field when constructed with { disableReasoning: false }", async () => {
		const { getBody } = captureRequestBody();

		await new BrowserLLMProvider({ disableReasoning: false }).streamRound(
			[],
			[],
		);

		expect(getBody()).not.toHaveProperty("reasoning");

		vi.restoreAllMocks();
	});
});
