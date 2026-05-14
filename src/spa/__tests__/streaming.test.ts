import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCallResult, UsageInfo } from "../streaming.js";
import { parseSSEStream } from "../streaming.js";

// Build-time constants; provide stubs for tests
// biome-ignore lint/suspicious/noExplicitAny: stubbing a build-time constant
(globalThis as any).__WORKER_BASE_URL__ = "http://localhost:8787";
// biome-ignore lint/suspicious/noExplicitAny: stubbing a build-time constant
(globalThis as any).__DEV__ = true;

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

	it("surfaces cached_tokens from OpenAI-spec prompt_tokens_details", async () => {
		const usageChunk = JSON.stringify({
			choices: [],
			usage: {
				prompt_tokens: 1200,
				completion_tokens: 80,
				prompt_tokens_details: { cached_tokens: 900 },
				cost: 0.000123,
			},
		});

		const usages: UsageInfo[] = [];
		await parseSSEStream(
			makeSSEStream([`data: ${usageChunk}\n\ndata: [DONE]\n\n`]),
			vi.fn(),
			undefined,
			undefined,
			(u) => usages.push(u),
		);

		expect(usages).toHaveLength(1);
		expect(usages[0]).toMatchObject({
			cost: 0.000123,
			prompt_tokens: 1200,
			completion_tokens: 80,
			cached_tokens: 900,
		});
	});

	it("falls back to cache_read_input_tokens when prompt_tokens_details is absent", async () => {
		const usageChunk = JSON.stringify({
			choices: [],
			usage: {
				prompt_tokens: 500,
				completion_tokens: 50,
				cache_read_input_tokens: 400,
			},
		});

		const usages: UsageInfo[] = [];
		await parseSSEStream(
			makeSSEStream([`data: ${usageChunk}\n\ndata: [DONE]\n\n`]),
			vi.fn(),
			undefined,
			undefined,
			(u) => usages.push(u),
		);

		expect(usages[0]?.cached_tokens).toBe(400);
	});

	it("omits cached_tokens when neither field is present", async () => {
		const usageChunk = JSON.stringify({
			choices: [],
			usage: { prompt_tokens: 100, completion_tokens: 20 },
		});

		const usages: UsageInfo[] = [];
		await parseSSEStream(
			makeSSEStream([`data: ${usageChunk}\n\ndata: [DONE]\n\n`]),
			vi.fn(),
			undefined,
			undefined,
			(u) => usages.push(u),
		);

		expect(usages[0]?.cached_tokens).toBeUndefined();
		expect(usages[0]?.prompt_tokens).toBe(100);
	});

	it("[DONE] terminates stream without emitting", async () => {
		const sseData = `data: [DONE]\n\n`;

		const onDelta = vi.fn();
		await parseSSEStream(makeSSEStream([sseData]), onDelta);

		expect(onDelta).not.toHaveBeenCalled();
	});

	it("invokes onReasoning for delta.reasoning chunks and not onDelta", async () => {
		const reasoningChunk1 = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "let me think" } }] })}\n\n`;
		const reasoningChunk2 = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: " about this" } }] })}\n\n`;
		const contentChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" } }] })}\n\n`;
		const doneChunk = `data: [DONE]\n\n`;

		const sseData =
			reasoningChunk1 + reasoningChunk2 + contentChunk + doneChunk;

		const onDelta = vi.fn();
		const onReasoning = vi.fn();
		await parseSSEStream(makeSSEStream([sseData]), onDelta, onReasoning);

		expect(onReasoning).toHaveBeenCalledTimes(2);
		expect(onReasoning).toHaveBeenNthCalledWith(1, "let me think");
		expect(onReasoning).toHaveBeenNthCalledWith(2, " about this");
		expect(onDelta).toHaveBeenCalledTimes(1);
		expect(onDelta).toHaveBeenCalledWith("answer");
	});

	it("works without onReasoning — reasoning chunks are silently ignored", async () => {
		const reasoningChunk = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "internal thought" } }] })}\n\n`;
		const contentChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`;
		const doneChunk = `data: [DONE]\n\n`;

		const sseData = reasoningChunk + contentChunk + doneChunk;

		const onDelta = vi.fn();
		// Call without third argument — must not throw
		await parseSSEStream(makeSSEStream([sseData]), onDelta);

		expect(onDelta).toHaveBeenCalledTimes(1);
		expect(onDelta).toHaveBeenCalledWith("hi");
	});
});

describe("parseSSEStream — tool_call delta assembly", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("assembles a single tool call across three SSE chunks", async () => {
		// Chunk 1: first fragment with id and name
		const chunk1 = `data: ${JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call_abc",
								type: "function",
								function: { name: "pick_up", arguments: "" },
							},
						],
					},
				},
			],
		})}\n\n`;
		// Chunk 2: more arguments
		const chunk2 = `data: ${JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [{ index: 0, function: { arguments: '{"item' } }],
					},
				},
			],
		})}\n\n`;
		// Chunk 3: finish arguments and finish_reason
		const chunk3 = `data: ${JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [{ index: 0, function: { arguments: '":"flower"}' } }],
					},
					finish_reason: "tool_calls",
				},
			],
		})}\n\ndata: [DONE]\n\n`;

		const calls: ToolCallResult[] = [];
		await parseSSEStream(
			makeSSEStream([chunk1, chunk2, chunk3]),
			vi.fn(),
			undefined,
			(c) => calls.push(c),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.id).toBe("call_abc");
		expect(calls[0]?.name).toBe("pick_up");
		expect(calls[0]?.argumentsJson).toBe('{"item":"flower"}');
	});

	it("assembles two distinct tool calls (index:0 and index:1)", async () => {
		const chunk = `data: ${JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call_1",
								type: "function",
								function: { name: "pick_up", arguments: '{"item":"flower"}' },
							},
							{
								index: 1,
								id: "call_2",
								type: "function",
								function: { name: "put_down", arguments: '{"item":"key"}' },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		})}\n\ndata: [DONE]\n\n`;

		const calls: ToolCallResult[] = [];
		await parseSSEStream(makeSSEStream([chunk]), vi.fn(), undefined, (c) =>
			calls.push(c),
		);

		expect(calls).toHaveLength(2);
		expect(calls[0]?.name).toBe("pick_up");
		expect(calls[1]?.name).toBe("put_down");
	});

	it("content-only response does not invoke onToolCall", async () => {
		const sseData =
			`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n` +
			`data: [DONE]\n\n`;

		const onToolCall = vi.fn();
		await parseSSEStream(
			makeSSEStream([sseData]),
			vi.fn(),
			undefined,
			onToolCall,
		);

		expect(onToolCall).not.toHaveBeenCalled();
	});

	it("content + tool_call response invokes both onDelta and onToolCall", async () => {
		const sseData =
			`data: ${JSON.stringify({ choices: [{ delta: { content: "I'll pick it up" } }] })}\n\n` +
			`data: ${JSON.stringify({
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_x",
									type: "function",
									function: { name: "pick_up", arguments: '{"item":"flower"}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})}\n\n` +
			`data: [DONE]\n\n`;

		const deltas: string[] = [];
		const calls: ToolCallResult[] = [];
		await parseSSEStream(
			makeSSEStream([sseData]),
			(t) => deltas.push(t),
			undefined,
			(c) => calls.push(c),
		);

		expect(deltas).toEqual(["I'll pick it up"]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("pick_up");
	});

	it("finish_reason:tool_calls flushes a partial (incomplete arguments) call", async () => {
		// The model may emit finish_reason before [DONE]
		const sseData = `data: ${JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call_y",
								type: "function",
								function: { name: "use", arguments: '{"item":"wand"}' },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		})}\n\ndata: [DONE]\n\n`;

		const calls: ToolCallResult[] = [];
		await parseSSEStream(makeSSEStream([sseData]), vi.fn(), undefined, (c) =>
			calls.push(c),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("use");
		expect(calls[0]?.argumentsJson).toBe('{"item":"wand"}');
	});

	it("[DONE] flushes assembled tool calls even without finish_reason:tool_calls", async () => {
		const sseData = `data: ${JSON.stringify({
			choices: [
				{
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call_z",
								type: "function",
								function: {
									name: "give",
									arguments: '{"item":"key","to":"cyan"}',
								},
							},
						],
					},
				},
			],
		})}\n\ndata: [DONE]\n\n`;

		const calls: ToolCallResult[] = [];
		await parseSSEStream(makeSSEStream([sseData]), vi.fn(), undefined, (c) =>
			calls.push(c),
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("give");
	});
});
