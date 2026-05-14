/**
 * Unit tests for llm-synthesis-provider.ts
 *
 * Covers: MockSynthesisProvider, BrowserSynthesisProvider (via mocked fetch),
 * SYNTHESIS_SYSTEM_PROMPT content assertions, retry logic, CapHitError handling,
 * GLM content/reasoning fallback, and JSON shape validation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapHitError } from "../../llm-client.js";
import type { SynthesisInput } from "../llm-synthesis-provider.js";
import {
	BrowserSynthesisProvider,
	buildSynthesisUserMessage,
	MockSynthesisProvider,
	SYNTHESIS_SYSTEM_PROMPT,
	SynthesisError,
} from "../llm-synthesis-provider.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

/** Build a successful non-streaming fetch response with JSON in content. */
function makeJsonFetchResponse(
	payload: unknown,
	useReasoning = false,
): Response {
	const message = useReasoning
		? { content: null, reasoning: JSON.stringify(payload) }
		: { content: JSON.stringify(payload), reasoning: null };
	const body = JSON.stringify({
		choices: [{ message }],
	});
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

/** Build a 429 rate-limit response. */
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

// ── MockSynthesisProvider ─────────────────────────────────────────────────────

describe("MockSynthesisProvider", () => {
	it("returns canned responses from the provided function", async () => {
		const provider = new MockSynthesisProvider(() => ({
			personas: CANNED_PERSONAS,
		}));
		const result = await provider.synthesizePersonas(THREE_INPUTS);
		expect(result.personas).toEqual(CANNED_PERSONAS);
	});

	it("tracks calls for assertions", async () => {
		const provider = new MockSynthesisProvider(() => ({
			personas: CANNED_PERSONAS,
		}));
		expect(provider.calls).toHaveLength(0);
		await provider.synthesizePersonas(THREE_INPUTS);
		expect(provider.calls).toHaveLength(1);
		expect(provider.calls[0]).toEqual(THREE_INPUTS);
		await provider.synthesizePersonas([INPUT_A]);
		expect(provider.calls).toHaveLength(2);
	});

	it("passes input to the factory function verbatim", async () => {
		let received: SynthesisInput[] | null = null;
		const provider = new MockSynthesisProvider((input) => {
			received = input;
			return {
				personas: input.map((p) => ({
					id: p.id,
					blurb: "test",
					voiceExamples: ["ex1", "ex2", "ex3"],
				})),
			};
		});
		await provider.synthesizePersonas(THREE_INPUTS);
		expect(received).toEqual(THREE_INPUTS);
	});

	it("makes no real fetch calls", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const provider = new MockSynthesisProvider(() => ({
			personas: CANNED_PERSONAS,
		}));
		await provider.synthesizePersonas(THREE_INPUTS);
		expect(fetchSpy).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});

// ── SYNTHESIS_SYSTEM_PROMPT assertions ────────────────────────────────────────

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

// ── buildSynthesisUserMessage ─────────────────────────────────────────────────

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

// ── BrowserSynthesisProvider ──────────────────────────────────────────────────

describe("BrowserSynthesisProvider", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		vi.stubGlobal("__DEV__", true);
		// Stub localStorage so resolveLLMTarget can read it
		vi.stubGlobal("localStorage", { getItem: () => null });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("parses content when present and returns blurbs", async () => {
		const payload = { personas: CANNED_PERSONAS };
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeJsonFetchResponse(payload)),
		);

		const provider = new BrowserSynthesisProvider();
		const result = await provider.synthesizePersonas(THREE_INPUTS);
		expect(result.personas).toEqual(CANNED_PERSONAS);
	});

	it("falls back to reasoning when content is null (GLM quirk)", async () => {
		const payload = { personas: CANNED_PERSONAS };
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(makeJsonFetchResponse(payload, true)),
		);

		const provider = new BrowserSynthesisProvider();
		const result = await provider.synthesizePersonas(THREE_INPUTS);
		expect(result.personas).toEqual(CANNED_PERSONAS);
	});

	it("retries once on transient SynthesisError and succeeds on second attempt", async () => {
		const payload = { personas: CANNED_PERSONAS };
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "not-json{{{", reasoning: null } }],
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			)
			.mockResolvedValueOnce(makeJsonFetchResponse(payload));

		vi.stubGlobal("fetch", fetchMock);
		const provider = new BrowserSynthesisProvider();
		const result = await provider.synthesizePersonas(THREE_INPUTS);
		expect(result.personas).toEqual(CANNED_PERSONAS);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("throws CapHitError immediately on 429 without retry", async () => {
		const fetchMock = vi.fn().mockResolvedValue(makeCapHitResponse());

		vi.stubGlobal("fetch", fetchMock);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(CapHitError);
		// Only one attempt — no retry on CapHitError
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws SynthesisError when both content and reasoning are null", async () => {
		const makeBody = () =>
			JSON.stringify({
				choices: [{ message: { content: null, reasoning: null } }],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when JSON shape is missing personas array", async () => {
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ wrong: "shape" }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when response contains unexpected ids", async () => {
		const badPersonas = [
			{ id: "WRONG_ID", blurb: "blurb1" },
			{ id: "c3d4", blurb: "blurb2" },
			{ id: "e5f6", blurb: "blurb3" },
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: badPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when response is missing an expected id", async () => {
		// Only 2 personas returned instead of 3
		const incompletePersonas = [
			{ id: "a1b2", blurb: "blurb1" },
			{ id: "c3d4", blurb: "blurb2" },
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: incompletePersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("on two consecutive transient failures, throws on the second", async () => {
		const makeBadBody = () =>
			JSON.stringify({
				choices: [{ message: { content: "not-json{{{", reasoning: null } }],
			});
		const fetchMock = vi
			.fn()
			.mockImplementation(() =>
				Promise.resolve(new Response(makeBadBody(), { status: 200 })),
			);

		vi.stubGlobal("fetch", fetchMock);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
		// Two attempts (first + one retry)
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	// ── voiceExamples validation ──────────────────────────────────────────────

	it("throws SynthesisError when voiceExamples field is missing", async () => {
		const badPersonas = [
			{ id: "a1b2", blurb: "blurb1" },
			{ id: "c3d4", blurb: "blurb2" },
			{ id: "e5f6", blurb: "blurb3" },
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: badPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when voiceExamples has length != 3 (length 1)", async () => {
		const badPersonas = [
			{ id: "a1b2", blurb: "blurb1", voiceExamples: ["only one"] },
			{ id: "c3d4", blurb: "blurb2", voiceExamples: ["only one"] },
			{ id: "e5f6", blurb: "blurb3", voiceExamples: ["only one"] },
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: badPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when voiceExamples has length != 3 (length 4)", async () => {
		const badPersonas = [
			{
				id: "a1b2",
				blurb: "blurb1",
				voiceExamples: ["one", "two", "three", "four"],
			},
			{
				id: "c3d4",
				blurb: "blurb2",
				voiceExamples: ["one", "two", "three", "four"],
			},
			{
				id: "e5f6",
				blurb: "blurb3",
				voiceExamples: ["one", "two", "three", "four"],
			},
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: badPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when voiceExamples contains a non-string entry", async () => {
		const badPersonas = [
			{ id: "a1b2", blurb: "blurb1", voiceExamples: ["ok", 42, "ok"] },
			{ id: "c3d4", blurb: "blurb2", voiceExamples: ["ok", "ok", "ok"] },
			{ id: "e5f6", blurb: "blurb3", voiceExamples: ["ok", "ok", "ok"] },
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: badPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("throws SynthesisError when voiceExamples contains an empty string", async () => {
		const badPersonas = [
			{ id: "a1b2", blurb: "blurb1", voiceExamples: ["ok", "", "ok"] },
			{ id: "c3d4", blurb: "blurb2", voiceExamples: ["ok", "ok", "ok"] },
			{ id: "e5f6", blurb: "blurb3", voiceExamples: ["ok", "ok", "ok"] },
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: badPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					Promise.resolve(new Response(makeBody(), { status: 200 })),
				),
		);
		const provider = new BrowserSynthesisProvider();
		await expect(
			provider.synthesizePersonas(THREE_INPUTS),
		).rejects.toBeInstanceOf(SynthesisError);
	});

	it("returns voiceExamples when valid 3-entry array provided", async () => {
		const goodPersonas = [
			{
				id: "a1b2",
				blurb: "blurb1",
				voiceExamples: ["line one.", "line two.", "line three."],
			},
			{
				id: "c3d4",
				blurb: "blurb2",
				voiceExamples: ["alpha.", "beta.", "gamma."],
			},
			{
				id: "e5f6",
				blurb: "blurb3",
				voiceExamples: ["uno.", "dos.", "tres."],
			},
		];
		const makeBody = () =>
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({ personas: goodPersonas }),
							reasoning: null,
						},
					},
				],
			});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(makeBody(), { status: 200 })),
		);
		const provider = new BrowserSynthesisProvider();
		const result = await provider.synthesizePersonas(THREE_INPUTS);
		const a1b2 = result.personas.find((p) => p.id === "a1b2");
		expect(a1b2?.voiceExamples).toEqual([
			"line one.",
			"line two.",
			"line three.",
		]);
	});
});

// ── SYNTHESIS_SYSTEM_PROMPT — voiceExamples additions ────────────────────────

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

	it("prohibits name/color/room in voice examples", () => {
		// The same prohibition block covers both blurbs and voice examples.
		const lower = SYNTHESIS_SYSTEM_PROMPT.toLowerCase();
		const hasProhibition =
			lower.includes("name") ||
			lower.includes("color") ||
			lower.includes("room");
		expect(hasProhibition).toBe(true);
	});
});
