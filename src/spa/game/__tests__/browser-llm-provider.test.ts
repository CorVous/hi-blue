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

describe("BrowserLLMProvider.streamRound — onLifecycle callback", () => {
	it("fires started → first-token → completed for a normal stream", async () => {
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
		const events: string[] = [];

		const result = await provider.streamRound(
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

		vi.restoreAllMocks();
	});

	it("fires first-token only once across multiple deltas", async () => {
		const words = ["a", "b", "c", "d"];

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
		const events: string[] = [];

		await provider.streamRound([], [], undefined, undefined, (event) => {
			events.push(event.phase);
		});

		const firstTokenCount = events.filter((p) => p === "first-token").length;
		expect(firstTokenCount).toBe(1);

		vi.restoreAllMocks();
	});

	it("forwards daemonId on every event", async () => {
		const words = ["test"];

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
		const events: Array<string> = [];

		await provider.streamRound([], [], undefined, "daemon-456", (event) => {
			events.push(
				event.daemonId ? `${event.phase}:${event.daemonId}` : event.phase,
			);
		});

		expect(events).toEqual([
			"started:daemon-456",
			"first-token:daemon-456",
			"completed:daemon-456",
		]);

		vi.restoreAllMocks();
	});

	it("fires started then errored when fetch rejects", async () => {
		const fetchError = new Error("Network failed");

		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(fetchError));

		const provider = new BrowserLLMProvider();
		const events: Array<string> = [];

		try {
			await provider.streamRound([], [], undefined, undefined, (event) => {
				events.push(event.phase);
			});
		} catch {
			// Expected to throw
		}

		expect(events).toEqual(["started", "errored"]);

		vi.restoreAllMocks();
	});

	it("does not fire first-token if no deltas arrive (errored before first chunk)", async () => {
		const streamError = new Error("Stream failed");

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.error(streamError);
						},
					}),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
			),
		);

		const provider = new BrowserLLMProvider();
		const events: string[] = [];

		try {
			await provider.streamRound([], [], undefined, undefined, (event) => {
				events.push(event.phase);
			});
		} catch {
			// Expected to throw
		}

		expect(events).toEqual(["started", "errored"]);
		expect(events).not.toContain("first-token");

		vi.restoreAllMocks();
	});
});
