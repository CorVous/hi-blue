import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLLMProvider } from "../browser-llm-provider";

function makeSseBody(
	deltas: Array<Record<string, string>>,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const delta of deltas) {
				const line = `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`;
				controller.enqueue(encoder.encode(line));
			}
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});
}

function stubFetchWithBody(body: ReadableStream<Uint8Array>) {
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(body, {
			status: 200,
			headers: { "Content-Type": "text/event-stream" },
		}),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function stubFetchWithWords(words: string[]) {
	return stubFetchWithBody(makeSseBody(words.map((content) => ({ content }))));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("BrowserLLMProvider.streamRound — onDelta callback", () => {
	it("invokes onDelta once per SSE chunk, in order, and concatenates the text", async () => {
		const words = ["alpha ", "beta ", "gamma."];
		stubFetchWithWords(words);

		const received: string[] = [];
		const result = await new BrowserLLMProvider().streamRound(
			[],
			[],
			(text) => {
				received.push(text);
			},
		);

		expect(received).toEqual(words);
		expect(result.assistantText).toBe("alpha beta gamma.");
	});

	it("still collects assistantText when onDelta is not provided", async () => {
		stubFetchWithWords(["one ", "two"]);

		const result = await new BrowserLLMProvider().streamRound([], []);

		expect(result.assistantText).toBe("one two");
	});
});

describe("BrowserLLMProvider — reasoning default", () => {
	function captureRequestBody(): { getBody: () => Record<string, unknown> } {
		const fetchMock = stubFetchWithWords(["ok"]);
		return {
			getBody: () => {
				const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
				return JSON.parse(String(init?.body)) as Record<string, unknown>;
			},
		};
	}

	it("leaves reasoning on by default (no opts) — the request omits the reasoning field", async () => {
		const { getBody } = captureRequestBody();

		await new BrowserLLMProvider().streamRound([], []);

		expect(getBody()).not.toHaveProperty("reasoning");
	});

	it("disables reasoning when constructed with { disableReasoning: true }", async () => {
		const { getBody } = captureRequestBody();

		await new BrowserLLMProvider({ disableReasoning: true }).streamRound(
			[],
			[],
		);

		expect(getBody().reasoning).toEqual({ enabled: false });
	});

	it("omits the reasoning field when constructed with { disableReasoning: false }", async () => {
		const { getBody } = captureRequestBody();

		await new BrowserLLMProvider({ disableReasoning: false }).streamRound(
			[],
			[],
		);

		expect(getBody()).not.toHaveProperty("reasoning");
	});
});

describe("BrowserLLMProvider.streamRound — onLifecycle callback", () => {
	it("fires started → first-token → completed for a multi-delta stream, with first-token only once", async () => {
		stubFetchWithWords(["hello ", "world"]);

		const events: string[] = [];
		const result = await new BrowserLLMProvider().streamRound(
			[],
			[],
			undefined,
			undefined,
			(event) => {
				events.push(event.phase);
			},
		);

		expect(events).toEqual(["started", "first-token", "completed"]);
		expect(result.assistantText).toBe("hello world");
	});

	it("forwards daemonId on every event", async () => {
		stubFetchWithWords(["test"]);

		const events: string[] = [];
		await new BrowserLLMProvider().streamRound(
			[],
			[],
			undefined,
			"daemon-456",
			(event) => {
				events.push(
					event.daemonId ? `${event.phase}:${event.daemonId}` : event.phase,
				);
			},
		);

		expect(events).toEqual([
			"started:daemon-456",
			"first-token:daemon-456",
			"completed:daemon-456",
		]);
	});

	it("fires started then errored when fetch rejects", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network failed")),
		);

		const events: string[] = [];
		await expect(
			new BrowserLLMProvider().streamRound(
				[],
				[],
				undefined,
				undefined,
				(event) => {
					events.push(event.phase);
				},
			),
		).rejects.toThrow();

		expect(events).toEqual(["started", "errored"]);
	});

	it("does not fire first-token if the stream errors before the first chunk", async () => {
		stubFetchWithBody(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.error(new Error("Stream failed"));
				},
			}),
		);

		const events: string[] = [];
		await expect(
			new BrowserLLMProvider().streamRound(
				[],
				[],
				undefined,
				undefined,
				(event) => {
					events.push(event.phase);
				},
			),
		).rejects.toThrow();

		expect(events).toEqual(["started", "errored"]);
	});
});

describe("BrowserLLMProvider.streamRound — reasoning stays out of assistantText", () => {
	it("returns empty assistantText when the stream carries only reasoning", async () => {
		stubFetchWithBody(
			makeSseBody([{ reasoning: "I should greet blue first." }]),
		);

		const result = await new BrowserLLMProvider().streamRound([], []);

		expect(result.assistantText).toBe("");
		expect(result.toolCalls).toEqual([]);
	});
});
