import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSingleAiSession, runSingleAiRound } from "../game-loop.js";
import type { AiPersona } from "../types";

// Provide globals before importing the module
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
vi.stubGlobal("localStorage", { getItem: () => null });

const WORKER_COMPLETIONS_URL = "http://localhost:8787/v1/chat/completions";

const TEST_PERSONA: AiPersona = {
	id: "blue",
	name: "Frost",
	color: "#5fa8d3",
	temperaments: ["laconic", "diffident"],
	personaGoal: "Hold the key at phase end.",
	blurb: "You are laconic and diffident. Hold the key at phase end.",
};

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

function makeSseChunk(content: string): string {
	return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

describe("createSingleAiSession", () => {
	it("creates a session with empty history", () => {
		const session = createSingleAiSession(TEST_PERSONA);
		expect(session.aiId).toBe("blue");
		expect(session.persona).toBe(TEST_PERSONA);
		expect(session.history).toEqual([]);
	});
});

describe("runSingleAiRound", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
		vi.stubGlobal("localStorage", { getItem: () => null });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("round 1: sends correct messages[] shape (system + user)", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(
				makeFetchResponse(makeSSEStream([`data: [DONE]\n\n`])),
			);
		vi.stubGlobal("fetch", mockFetch);

		const session = createSingleAiSession(TEST_PERSONA);
		await runSingleAiRound({
			session,
			message: "first prompt",
			onDelta: vi.fn(),
		});

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(WORKER_COMPLETIONS_URL);
		const body = JSON.parse(init.body as string);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0]).toMatchObject({
			role: "system",
			content: expect.stringContaining("Frost"),
		});
		expect(body.messages[1]).toEqual({ role: "user", content: "first prompt" });
	});

	it("round 2: messages[] includes round 1 exchange", async () => {
		const sseData1 = `${makeSseChunk("round one reply")}data: [DONE]\n\n`;
		const sseData2 = `${makeSseChunk("round two reply")}data: [DONE]\n\n`;

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(makeFetchResponse(makeSSEStream([sseData1])))
			.mockResolvedValueOnce(makeFetchResponse(makeSSEStream([sseData2])));
		vi.stubGlobal("fetch", mockFetch);

		const session = createSingleAiSession(TEST_PERSONA);

		// Round 1
		await runSingleAiRound({ session, message: "first", onDelta: vi.fn() });

		// Round 2
		await runSingleAiRound({ session, message: "second", onDelta: vi.fn() });

		const [, init2] = mockFetch.mock.calls[1] as [string, RequestInit];
		const body = JSON.parse(init2.body as string);
		expect(body.messages).toHaveLength(4);
		expect(body.messages[0]).toMatchObject({ role: "system" });
		expect(body.messages[1]).toEqual({ role: "user", content: "first" });
		expect(body.messages[2]).toEqual({
			role: "assistant",
			content: "round one reply",
		});
		expect(body.messages[3]).toEqual({ role: "user", content: "second" });
	});

	it("onDelta receives streamed chunks in order", async () => {
		const sseData = `${makeSseChunk("hi ")}${makeSseChunk("there")}data: [DONE]\n\n`;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([sseData]))),
		);

		const session = createSingleAiSession(TEST_PERSONA);
		const deltas: string[] = [];
		await runSingleAiRound({
			session,
			message: "hello",
			onDelta: (text) => deltas.push(text),
		});

		expect(deltas).toEqual(["hi ", "there"]);
	});

	it("session.history accumulates player and ai entries on success", async () => {
		const sseData = `${makeSseChunk("hi there")}data: [DONE]\n\n`;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([sseData]))),
		);

		const session = createSingleAiSession(TEST_PERSONA);
		await runSingleAiRound({
			session,
			message: "hello",
			onDelta: vi.fn(),
		});

		expect(session.history).toHaveLength(2);
		expect(session.history[0]).toEqual({
			role: "player",
			content: "hello",
			round: 0,
		});
		expect(session.history[1]).toEqual({
			role: "ai",
			content: "hi there",
			round: 0,
		});
	});

	it("fetch failure → rejects AND session.history is untouched", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeFetchResponse(makeSSEStream([]), false)),
		);

		const session = createSingleAiSession(TEST_PERSONA);
		await expect(
			runSingleAiRound({ session, message: "hello", onDelta: vi.fn() }),
		).rejects.toThrow(/HTTP 500/);

		expect(session.history).toHaveLength(0);
	});
});
