import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapHitError, HttpStatusError } from "../../llm-client.js";
import type { SynthesisInput } from "../llm-synthesis-provider.js";
import {
	BrowserSynthesisProvider,
	buildSynthesisUserMessage,
	SYNTHESIS_SYSTEM_PROMPT,
	SynthesisError,
} from "../llm-synthesis-provider.js";

const INPUT_A: SynthesisInput = {
	id: "a1b2",
	temperaments: ["stoic", "precise"],
	personaGoal: "Ensure order is maintained.",
};
const INPUT_B: SynthesisInput = {
	id: "c3d4",
	temperaments: ["impulsive", "impulsive"],
	personaGoal: "Act before others can.",
};
const INPUT_C: SynthesisInput = {
	id: "e5f6",
	temperaments: ["gentle", "wry"],
	personaGoal: "Keep the peace at any cost.",
};
const THREE_INPUTS = [INPUT_A, INPUT_B, INPUT_C];

const CANNED_PERSONAS = [
	{
		id: "a1b2",
		blurb: "a1b2 is stoic and precise.",
		voiceExamples: ["voice1-a1b2", "voice2-a1b2", "voice3-a1b2"],
	},
	{
		id: "c3d4",
		blurb: "c3d4 is intensely impulsive.",
		voiceExamples: ["voice1-c3d4", "voice2-c3d4", "voice3-c3d4"],
	},
	{
		id: "e5f6",
		blurb: "e5f6 is gentle and wry.",
		voiceExamples: ["voice1-e5f6", "voice2-e5f6", "voice3-e5f6"],
	},
];

interface ChatMessage {
	content: string | null;
	reasoning: string | null;
}

function chatCompletionResponse(message: ChatMessage): Response {
	return new Response(JSON.stringify({ choices: [{ message }] }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function contentMessage(payload: unknown): ChatMessage {
	return {
		content: typeof payload === "string" ? payload : JSON.stringify(payload),
		reasoning: null,
	};
}

function stubFetchAlwaysAnswering(message: ChatMessage) {
	const fetchMock = vi
		.fn()
		.mockImplementation(() => Promise.resolve(chatCompletionResponse(message)));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function personasWith(
	overrides: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
	return CANNED_PERSONAS.map((persona, i) => ({ ...persona, ...overrides[i] }));
}

function makeCapHitResponse(): Response {
	const body = JSON.stringify({
		error: {
			type: "rate_limit_exceeded",
			code: "per-ip-daily",
			message: "daily cap hit",
		},
	});
	return new Response(body, {
		status: 429,
		headers: { "Content-Type": "application/json" },
	});
}

describe("SYNTHESIS_SYSTEM_PROMPT", () => {
	it("does NOT contain anti-romance / anti-sycophancy guards", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).not.toContain("romance");
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).not.toContain("sycoph");
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).not.toContain("flatter");
	});

	it("encodes the 80–120 word length constraint", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT).toContain("80");
		expect(SYNTHESIS_SYSTEM_PROMPT).toContain("120");
	});

	it("encodes third-person framing using the persona's id as subject", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).toContain("third person");
		expect(SYNTHESIS_SYSTEM_PROMPT).toContain("id");
	});

	it("encodes contradictions-as-tension handling", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).toContain("tension");
	});

	it("encodes intensification for duplicate temperaments", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).toContain("intensif");
	});

	it("prohibits name / color / room mentions", () => {
		const lower = SYNTHESIS_SYSTEM_PROMPT.toLowerCase();
		const hasProhibition =
			lower.includes("name") ||
			lower.includes("color") ||
			lower.includes("room");
		expect(hasProhibition).toBe(true);
	});

	it("specifies strict JSON-only output with the expected shape", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT).toContain('"personas"');
		expect(SYNTHESIS_SYSTEM_PROMPT).toContain('"blurb"');
	});
});

describe("buildSynthesisUserMessage", () => {
	it("includes all input ids", () => {
		const msg = buildSynthesisUserMessage(THREE_INPUTS);
		for (const inp of THREE_INPUTS) {
			expect(msg).toContain(inp.id);
		}
	});

	it("includes all temperaments", () => {
		const msg = buildSynthesisUserMessage(THREE_INPUTS);
		expect(msg).toContain("stoic");
		expect(msg).toContain("precise");
		expect(msg).toContain("impulsive");
	});

	it("includes persona goals", () => {
		const msg = buildSynthesisUserMessage(THREE_INPUTS);
		expect(msg).toContain("Ensure order is maintained");
	});
});

describe("BrowserSynthesisProvider", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		vi.useFakeTimers();
		vi.setTimerTickMode("nextTimerAsync");
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("parses content when present and returns blurbs", async () => {
		stubFetchAlwaysAnswering(contentMessage({ personas: CANNED_PERSONAS }));

		const result = await new BrowserSynthesisProvider().synthesizePersonas(
			THREE_INPUTS,
		);
		expect(result.personas).toEqual(CANNED_PERSONAS);
	});

	it("falls back to reasoning when content is null (GLM quirk)", async () => {
		stubFetchAlwaysAnswering({
			content: null,
			reasoning: JSON.stringify({ personas: CANNED_PERSONAS }),
		});

		const result = await new BrowserSynthesisProvider().synthesizePersonas(
			THREE_INPUTS,
		);
		expect(result.personas).toEqual(CANNED_PERSONAS);
	});

	it("retries once on transient SynthesisError and succeeds on second attempt", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				chatCompletionResponse(contentMessage("not-json{{{")),
			)
			.mockResolvedValueOnce(
				chatCompletionResponse(contentMessage({ personas: CANNED_PERSONAS })),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await new BrowserSynthesisProvider().synthesizePersonas(
			THREE_INPUTS,
		);
		expect(result.personas).toEqual(CANNED_PERSONAS);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("on two consecutive transient failures, throws on the second", async () => {
		const fetchMock = stubFetchAlwaysAnswering(contentMessage("not-json{{{"));

		await expect(
			new BrowserSynthesisProvider().synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("throws CapHitError immediately on 429 without retry", async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeCapHitResponse());
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			new BrowserSynthesisProvider().synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(CapHitError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		400, 401, 402, 403,
	])("throws an HTTP %i at once with OpenRouter's message, without retry", async (status) => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ error: { message: "Insufficient credits" } }),
					{ status, headers: { "Content-Type": "application/json" } },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const error = await new BrowserSynthesisProvider()
			.synthesizePersonas(THREE_INPUTS)
			.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(HttpStatusError);
		expect((error as HttpStatusError).upstreamMessage).toBe(
			"Insufficient credits",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("backs off before its one retry, for longer when Retry-After asks", async () => {
		vi.setTimerTickMode("manual");
		const chatFn = vi
			.fn()
			.mockRejectedValueOnce(
				new HttpStatusError({
					status: 429,
					statusText: "Too Many Requests",
					upstreamMessage: "Provider rate limited",
					retryAfterSec: 4,
				}),
			)
			.mockResolvedValueOnce(contentMessage({ personas: CANNED_PERSONAS }));

		const promise = new BrowserSynthesisProvider({
			chatFn,
		}).synthesizePersonas(THREE_INPUTS);

		await vi.waitFor(() => expect(chatFn).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(3_900);
		expect(chatFn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(100);
		const result = await promise;

		expect(chatFn).toHaveBeenCalledTimes(2);
		expect(result.personas).toEqual(CANNED_PERSONAS);
	});

	it("caps a huge Retry-After so the retry still happens soon", async () => {
		vi.setTimerTickMode("manual");
		const chatFn = vi
			.fn()
			.mockRejectedValueOnce(
				new HttpStatusError({
					status: 503,
					statusText: "Service Unavailable",
					upstreamMessage: null,
					retryAfterSec: 3_600,
				}),
			)
			.mockResolvedValueOnce(contentMessage({ personas: CANNED_PERSONAS }));

		const promise = new BrowserSynthesisProvider({
			chatFn,
		}).synthesizePersonas(THREE_INPUTS);

		await vi.waitFor(() => expect(chatFn).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(10_000);
		await promise;

		expect(chatFn).toHaveBeenCalledTimes(2);
	});

	it("does not retry once its signal is aborted, and passes the signal on", async () => {
		const controller = new AbortController();
		const chatFn = vi.fn().mockImplementation(async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		});

		await expect(
			new BrowserSynthesisProvider({
				chatFn,
				signal: controller.signal,
			}).synthesizePersonas(THREE_INPUTS),
		).rejects.toThrow("aborted");
		expect(chatFn).toHaveBeenCalledTimes(1);
		expect(chatFn.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
	});

	it("throws SynthesisError when both content and reasoning are null", async () => {
		stubFetchAlwaysAnswering({ content: null, reasoning: null });

		await expect(
			new BrowserSynthesisProvider().synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it.each([
		["the JSON shape is missing the personas array", { wrong: "shape" }],
		[
			"the response contains an unexpected id",
			{ personas: personasWith([{ id: "WRONG_ID" }]) },
		],
		[
			"the response is missing an expected id",
			{ personas: CANNED_PERSONAS.slice(0, 2) },
		],
		[
			"the voiceExamples field is missing",
			{
				personas: CANNED_PERSONAS.map(({ id, blurb }) => ({ id, blurb })),
			},
		],
		[
			"voiceExamples has length 1",
			{
				personas: personasWith([
					{ voiceExamples: ["only one"] },
					{ voiceExamples: ["only one"] },
					{ voiceExamples: ["only one"] },
				]),
			},
		],
		[
			"voiceExamples has length 4",
			{
				personas: personasWith([
					{ voiceExamples: ["one", "two", "three", "four"] },
					{ voiceExamples: ["one", "two", "three", "four"] },
					{ voiceExamples: ["one", "two", "three", "four"] },
				]),
			},
		],
		[
			"voiceExamples contains a non-string entry",
			{ personas: personasWith([{ voiceExamples: ["ok", 42, "ok"] }]) },
		],
		[
			"voiceExamples contains an empty string",
			{ personas: personasWith([{ voiceExamples: ["ok", "", "ok"] }]) },
		],
		["a blurb is empty", { personas: personasWith([{ blurb: "" }]) }],
		[
			"a blurb is whitespace-only",
			{ personas: personasWith([{ blurb: "   \n\t" }]) },
		],
	])("throws SynthesisError when %s", async (_label, payload) => {
		stubFetchAlwaysAnswering(contentMessage(payload));

		await expect(
			new BrowserSynthesisProvider().synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("returns voiceExamples when valid 3-entry array provided", async () => {
		stubFetchAlwaysAnswering(
			contentMessage({
				personas: personasWith([
					{ voiceExamples: ["line one.", "line two.", "line three."] },
				]),
			}),
		);

		const result = await new BrowserSynthesisProvider().synthesizePersonas(
			THREE_INPUTS,
		);
		const a1b2 = result.personas.find((p) => p.id === "a1b2");
		expect(a1b2?.voiceExamples).toEqual([
			"line one.",
			"line two.",
			"line three.",
		]);
	});
});

describe("SYNTHESIS_SYSTEM_PROMPT — voiceExamples", () => {
	it("includes 'voiceExamples' JSON token", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT).toContain('"voiceExamples"');
	});

	it("mentions exactly 3 voice examples requirement", () => {
		const lower = SYNTHESIS_SYSTEM_PROMPT.toLowerCase();
		const mentionsThree =
			lower.includes("exactly 3") || lower.includes("3 voiceexamples");
		expect(mentionsThree).toBe(true);
	});

	it("mentions one sentence constraint", () => {
		expect(SYNTHESIS_SYSTEM_PROMPT.toLowerCase()).toContain("one sentence");
	});

	it("prohibits first-person goal descriptions in voice examples", () => {
		const lower = SYNTHESIS_SYSTEM_PROMPT.toLowerCase();
		const hasProhibition =
			lower.includes("first-person") ||
			lower.includes("first person") ||
			lower.includes("i want") ||
			lower.includes("don't say");
		expect(hasProhibition).toBe(true);
	});
});
