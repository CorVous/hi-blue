import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSSEStream } from "../streaming.js";

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

describe("parseSSEStream", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("emits deltas in order", async () => {
		const sseData = [
			`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
			`data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
			`data: [DONE]\n\n`,
		].join("");

		const deltas: string[] = [];
		await parseSSEStream(makeSSEStream([sseData]), (text) => deltas.push(text));

		expect(deltas).toEqual(["Hello", " world"]);
	});

	it("handles SSE events split across chunk boundaries", async () => {
		// Split "data: {...}\n\ndata: [DONE]\n\n" into two chunks mid-event
		const fullEvent = `data: ${JSON.stringify({ choices: [{ delta: { content: "split" } }] })}\n\ndata: [DONE]\n\n`;
		const midpoint = Math.floor(fullEvent.length / 2);
		const chunk1 = fullEvent.slice(0, midpoint);
		const chunk2 = fullEvent.slice(midpoint);

		const deltas: string[] = [];
		await parseSSEStream(makeSSEStream([chunk1, chunk2]), (text) =>
			deltas.push(text),
		);

		expect(deltas).toEqual(["split"]);
	});

	it("ignores usage-only chunks without choices[0].delta.content", async () => {
		const usageChunk = JSON.stringify({
			choices: [],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		});

		const onDelta = vi.fn();
		await parseSSEStream(
			makeSSEStream([`data: ${usageChunk}\n\ndata: [DONE]\n\n`]),
			onDelta,
		);

		expect(onDelta).not.toHaveBeenCalled();
	});

	it("[DONE] terminates stream without emitting", async () => {
		const sseData = `data: [DONE]\n\n`;

		const onDelta = vi.fn();
		await parseSSEStream(makeSSEStream([sseData]), onDelta);

		expect(onDelta).not.toHaveBeenCalled();
	});
});
