import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { CapHitError, HttpStatusError } from "../../llm-client.js";
import { validateBoundDualContentPack } from "../binding-aware-validator.js";
import type { BindingSkeleton } from "../binding-prompt-builder.js";
import {
	BrowserContentPackProvider,
	buildCorrectiveFeedback,
	DUAL_CONTENT_PACK_SYSTEM_PROMPT,
	type DualBindingContentPackInput,
} from "../content-pack-provider.js";

const OUTER_ATTEMPT_BUDGET = 3;
const FIRST_RETRY_BACKOFF_MS = 1_000;
const CORRECTIVE_FEEDBACK_MARKER = "Your previous attempt failed validation";

type ChatMessage = { role: string; content: string };

function chatReply(payload: unknown): {
	content: string;
	reasoning: null;
} {
	return {
		content: typeof payload === "string" ? payload : JSON.stringify(payload),
		reasoning: null,
	};
}

function messagesOfCall(chatFn: Mock, callIndex: number): ChatMessage[] {
	const messages = chatFn.mock.calls[callIndex]?.[0]?.messages as
		| ChatMessage[]
		| undefined;
	expect(messages).toBeDefined();
	return messages ?? [];
}

function correctionTurnOf(messages: ChatMessage[]): ChatMessage | undefined {
	return messages.find((m) => m.content.includes(CORRECTIVE_FEEDBACK_MARKER));
}

function dualInputFor(
	bindings: BindingSkeleton[],
	obstacleCount: number,
): DualBindingContentPackInput {
	return {
		phases: [
			{
				settingA: "abandoned subway station",
				settingB: "sun-baked salt flat",
				theme: "mundane",
				weatherA: "overcast",
				weatherB: "clear",
				timeOfDayA: "night",
				timeOfDayB: "midday",
				bindings,
				decoyIds: ["decoy-0", "decoy-1"],
				obstacleCount,
			},
		],
	};
}

describe("DUAL_CONTENT_PACK_SYSTEM_PROMPT — prose tells", () => {
	it("requires the prose tell at MUST strength (issue #253)", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/examineDescription[\s\S]*MUST[\s\S]*paired space/,
		);
	});

	it("documents convergenceTier1ActorFlavor and convergenceTier2ActorFlavor", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toContain(
			"convergenceTier1ActorFlavor",
		);
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toContain(
			"convergenceTier2ActorFlavor",
		);
	});

	it("requires the convergence shared-presence prose-tell hint on examineDescription", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/MUST[\s\S]*(shared occupancy|another presence)/,
		);
	});

	it("forbids {actor} in activationFlavor", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/activationFlavor[\s\S]*no.*\{actor\}/i,
		);
	});
});

describe("DUAL_CONTENT_PACK_SYSTEM_PROMPT — issue #335 rules", () => {
	it("describes activationFlavor as a field on objective_space", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(/activationFlavor/);
	});

	it("requires the objective_space prose tell at MUST strength", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/use_space[\s\S]*examineDescription[\s\S]*MUST/i,
		);
	});
});

describe("BrowserContentPackProvider — dual outer-retry layer", () => {
	const dualInput = dualInputFor(
		[{ type: "carry", objectId: "carry-0-obj", spaceId: "carry-0-space" }],
		0,
	);

	afterEach(() => {
		vi.useRealTimers();
	});

	function buildDualResponse() {
		const mkPack = (setting: string, objName: string, spaceName: string) => ({
			setting,
			wallName: "concrete barrier",
			bindings: [
				{
					id: "carry-0",
					type: "carry",
					object: {
						id: "carry-0-obj",
						name: objName,
						examineDescription: `An object. It belongs on the ${spaceName.toLowerCase()}.`,
						useOutcome: "You turn it over in your hands.",
						placementFlavor: `{actor} sets it on the ${spaceName.toLowerCase()}.`,
						proximityFlavor: "It hums faintly nearby.",
					},
					space: {
						id: "carry-0-space",
						name: spaceName,
						examineDescription: "A sturdy mount with a subtle indentation.",
						proximityFlavor: "The space vibrates softly.",
					},
				},
			],
			decoys: [
				{
					id: "decoy-0",
					name: "Old Disc",
					examineDescription: "A small tarnished disc.",
					proximityFlavor: "The disc gleams.",
					useOutcome: "Nothing.",
				},
				{
					id: "decoy-1",
					name: "Plain Coin",
					examineDescription: "A coin from another era.",
					proximityFlavor: "The coin catches light.",
					useOutcome: "Nothing.",
				},
			],
			obstacles: [],
		});
		return {
			phases: [
				{
					packA: mkPack(
						"abandoned subway station",
						"Iron Key",
						"Brass Pedestal",
					),
					packB: mkPack("sun-baked salt flat", "Bone Token", "Survey Marker"),
				},
			],
		};
	}

	function dualResponseWithPackAObject(
		mutate: (object: Record<string, unknown>) => void,
	): unknown {
		const response = buildDualResponse();
		const object = response.phases[0]?.packA.bindings[0]?.object;
		mutate(object as Record<string, unknown>);
		return response;
	}

	it("Test 1 — retries on dual validation failure (N=1), then succeeds and includes corrective feedback", async () => {
		const mockChatFn = vi
			.fn()
			.mockResolvedValueOnce(
				chatReply(
					dualResponseWithPackAObject((object) => {
						delete object.examineDescription;
					}),
				),
			)
			.mockResolvedValueOnce(chatReply(buildDualResponse()));

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateDualContentPacks(dualInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.phases[0]?.rawPackA.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
		expect(result.phases[0]?.rawPackB.bindings?.[0]?.object?.name).toBe(
			"Bone Token",
		);
		expect(correctionTurnOf(messagesOfCall(mockChatFn, 1))).toBeDefined();
	});

	it("Test 2 — retries on dual validation failure (N=2), then succeeds and includes corrective feedback", async () => {
		const mockChatFn = vi
			.fn()
			.mockResolvedValueOnce(
				chatReply(
					dualResponseWithPackAObject((object) => {
						delete object.name;
					}),
				),
			)
			.mockResolvedValueOnce(
				chatReply(
					dualResponseWithPackAObject((object) => {
						object.placementFlavor = "Sets it on the pedestal.";
					}),
				),
			)
			.mockResolvedValueOnce(chatReply(buildDualResponse()));

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateDualContentPacks(dualInput);

		expect(mockChatFn).toHaveBeenCalledTimes(3);
		expect(result.phases[0]?.rawPackA.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
		expect(correctionTurnOf(messagesOfCall(mockChatFn, 2))).toBeDefined();
	});

	it("Test 3 — CapHitError on first call short-circuits without retry", async () => {
		const mockChatFn = vi.fn().mockRejectedValueOnce(
			new CapHitError({
				message: "rate limit exceeded",
				reason: "global-daily",
				retryAfterSec: 3600,
			}),
		);

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });

		await expect(provider.generateDualContentPacks(dualInput)).rejects.toThrow(
			CapHitError,
		);
		expect(mockChatFn).toHaveBeenCalledTimes(1);
	});

	it.each([
		400, 401, 402, 403,
	])("an HTTP %i rethrows at once without retrying", async (status) => {
		const mockChatFn = vi.fn().mockRejectedValue(
			new HttpStatusError({
				status,
				statusText: "",
				upstreamMessage: "No auth credentials found",
				retryAfterSec: null,
			}),
		);

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });

		await expect(
			provider.generateDualContentPacks(dualInput),
		).rejects.toMatchObject({
			status,
			upstreamMessage: "No auth credentials found",
		});
		expect(mockChatFn).toHaveBeenCalledTimes(1);
	});

	it("passes its abort signal to every call and stops retrying once aborted", async () => {
		const controller = new AbortController();
		const mockChatFn = vi.fn().mockImplementation(async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		});

		const provider = new BrowserContentPackProvider({
			chatFn: mockChatFn,
			signal: controller.signal,
		});

		await expect(provider.generateDualContentPacks(dualInput)).rejects.toThrow(
			"aborted",
		);
		expect(mockChatFn).toHaveBeenCalledTimes(1);
		expect(mockChatFn.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
	});

	it("waits for a longer Retry-After before retrying a retryable HTTP error", async () => {
		vi.useFakeTimers();
		const mockChatFn = vi
			.fn()
			.mockRejectedValueOnce(
				new HttpStatusError({
					status: 429,
					statusText: "Too Many Requests",
					upstreamMessage: "Provider rate limited",
					retryAfterSec: 3,
				}),
			)
			.mockResolvedValueOnce(chatReply(buildDualResponse()));

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const promise = provider.generateDualContentPacks(dualInput);

		await vi.waitFor(() => expect(mockChatFn).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(FIRST_RETRY_BACKOFF_MS);
		expect(mockChatFn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2_000);
		await promise;

		expect(mockChatFn).toHaveBeenCalledTimes(2);
	});

	it("Test 4 — budget exhaustion bubbles the last ContentPackError", async () => {
		const mockChatFn = vi.fn().mockResolvedValue(
			chatReply(
				dualResponseWithPackAObject((object) => {
					delete object.useOutcome;
				}),
			),
		);

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });

		await expect(provider.generateDualContentPacks(dualInput)).rejects.toThrow(
			/exhausted retry budget/,
		);
		expect(mockChatFn).toHaveBeenCalledTimes(OUTER_ATTEMPT_BUDGET);
	});

	it("Test 5 — JSON-parse failure on first call → backoff via fake timers → success", async () => {
		vi.useFakeTimers();
		const mockChatFn = vi
			.fn()
			.mockResolvedValueOnce(chatReply("{not valid json"))
			.mockResolvedValueOnce(chatReply(buildDualResponse()));

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const promise = provider.generateDualContentPacks(dualInput);

		await vi.waitFor(() => expect(mockChatFn).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(FIRST_RETRY_BACKOFF_MS);
		const result = await promise;

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.phases[0]?.rawPackA.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
	});
});

describe("BrowserContentPackProvider — corrective feedback strengthening", () => {
	function asDualResponse(response: unknown): unknown {
		const pack = (response as { pack: unknown }).pack;
		return {
			phases: [{ packA: pack, packB: structuredClone(pack) }],
		};
	}

	const carryInput = dualInputFor(
		[{ type: "carry", objectId: "carry-0-obj", spaceId: "carry-0-space" }],
		1,
	);

	const useSpaceInput = dualInputFor(
		[{ type: "use_space", spaceId: "useSpace-0-space" }],
		1,
	);

	function buildValidCarryPack() {
		return {
			pack: {
				setting: "abandoned subway station",
				wallName: "concrete barrier",
				bindings: [
					{
						id: "carry-0",
						type: "carry",
						object: {
							id: "carry-0-obj",
							name: "Iron Key",
							examineDescription:
								"An iron key. It looks like it belongs on the brass pedestal.",
							useOutcome: "You turn the key over in your hands.",
							placementFlavor: "{actor} sets the key on its mount.",
							proximityFlavor: "The key hums faintly near the pedestal.",
						} as Record<string, unknown>,
						space: {
							id: "carry-0-space",
							name: "Brass Pedestal",
							examineDescription:
								"A sturdy brass mount with a subtle indentation on its surface.",
							proximityFlavor: "The pedestal thrums softly nearby.",
						},
					},
				],
				decoys: [
					{
						id: "decoy-0",
						name: "Brass Disc",
						examineDescription: "A small decorative disc of tarnished brass.",
						proximityFlavor: "The disc gleams faintly.",
						useOutcome: "Nothing happens.",
					},
					{
						id: "decoy-1",
						name: "Old Coin",
						examineDescription: "A weathered coin from a past era.",
						proximityFlavor: "The coin catches the light.",
						useOutcome: "Nothing happens.",
					},
				],
				obstacles: [
					{
						id: "obstacle-0",
						name: "Rusted Gate",
						examineDescription: "An old rusted gate blocking the path.",
						shiftFlavor:
							"The rusted gate scrapes along the floor with a grinding shriek.",
					},
				],
			},
		};
	}

	function buildValidUseSpacePack() {
		return {
			pack: {
				setting: "abandoned subway station",
				wallName: "concrete barrier",
				bindings: [
					{
						id: "useSpace-0",
						type: "use_space",
						space: {
							id: "useSpace-0-space",
							name: "Control Panel",
							examineDescription:
								"A panel with buttons and levers you can press.",
							proximityFlavor: "The panel hums faintly.",
							activationFlavor: "The panel lights up.",
							satisfactionFlavor: "The panel fires a burst of light.",
							postExamineDescription: "The panel is now active.",
							postLookFlavor: "The panel glows.",
						},
					},
				],
				decoys: [
					{
						id: "decoy-0",
						name: "Old Disc",
						examineDescription: "A small tarnished disc.",
						proximityFlavor: "The disc gleams.",
						useOutcome: "Nothing.",
					},
					{
						id: "decoy-1",
						name: "Plain Coin",
						examineDescription: "A coin from another era.",
						proximityFlavor: "The coin catches light.",
						useOutcome: "Nothing.",
					},
				],
				obstacles: [
					{
						id: "obstacle-0",
						name: "Rusted Gate",
						examineDescription: "An old rusted gate blocking the path.",
						shiftFlavor: "The gate grinds across the floor.",
					},
				],
			},
		};
	}

	function carryPackWithSwitchDecoy() {
		const pack = buildValidCarryPack();
		const [decoy] = pack.pack.decoys;
		if (decoy) {
			decoy.examineDescription =
				"An old switch you might find in a forgotten panel.";
		}
		return pack;
	}

	async function retryAfterOneBrokenReply(
		input: DualBindingContentPackInput,
		brokenDualResponse: unknown,
		validPack: unknown,
	): Promise<ChatMessage[]> {
		const mockChatFn = vi
			.fn()
			.mockResolvedValueOnce(chatReply(brokenDualResponse))
			.mockResolvedValueOnce(chatReply(asDualResponse(validPack)));

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		await provider.generateDualContentPacks(input);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		return messagesOfCall(mockChatFn, 1);
	}

	it("includes the previous raw JSON as an assistant turn on the corrective retry", async () => {
		const brokenDualResponse = asDualResponse(carryPackWithSwitchDecoy());
		const call2Messages = await retryAfterOneBrokenReply(
			carryInput,
			brokenDualResponse,
			buildValidCarryPack(),
		);

		const assistantIdx = call2Messages.findIndex((m) => m.role === "assistant");
		const correctiveIdx = call2Messages.findIndex((m) =>
			m.content.includes(CORRECTIVE_FEEDBACK_MARKER),
		);
		expect(assistantIdx).toBeGreaterThanOrEqual(0);
		expect(call2Messages[assistantIdx]?.content).toBe(
			JSON.stringify(brokenDualResponse),
		);
		expect(correctiveIdx).toBeGreaterThan(assistantIdx);
	});

	it("groups identical errors from packA and packB under separate pack labels", () => {
		const brokenPack = buildValidCarryPack();
		delete brokenPack.pack.bindings[0]?.object.name;
		const result = validateBoundDualContentPack(asDualResponse(brokenPack), {
			skeletons: carryInput.phases[0]?.bindings ?? [],
			decoys: [{ id: "decoy-0" }, { id: "decoy-1" }],
			obstacleCount: 1,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;

		const feedback = buildCorrectiveFeedback(result.errors);
		expect(feedback).toContain("For packA carry binding carry-0:");
		expect(feedback).toContain("For packB carry binding carry-0:");
		const missingName = /missing required field "name"/g;
		expect(feedback.match(missingName)).toHaveLength(2);
	});

	it("names the offending keyword in the corrective feedback for a forbidden-use-cue decoy", async () => {
		const call2Messages = await retryAfterOneBrokenReply(
			carryInput,
			asDualResponse(carryPackWithSwitchDecoy()),
			buildValidCarryPack(),
		);

		const correctionTurn = correctionTurnOf(call2Messages);
		expect(correctionTurn).toBeDefined();
		expect(correctionTurn?.content).toMatch(/"switch"/);
		expect(correctionTurn?.content).toMatch(/decoy-0/);
	});

	it("includes the use-cue keyword hint list for a missing-use-cue UseSpace error", async () => {
		const brokenPack = buildValidUseSpacePack();
		const [binding] = brokenPack.pack.bindings;
		if (binding) {
			binding.space.examineDescription =
				"A featureless surface set into the wall.";
		}
		const call2Messages = await retryAfterOneBrokenReply(
			useSpaceInput,
			asDualResponse(brokenPack),
			buildValidUseSpacePack(),
		);

		const correctionTurn = correctionTurnOf(call2Messages);
		expect(correctionTurn).toBeDefined();
		expect(correctionTurn?.content).toMatch(/"use"/);
		expect(correctionTurn?.content).toMatch(/"activate"/);
		expect(correctionTurn?.content).toMatch(/"press"/);
		expect(correctionTurn?.content).toMatch(/use-space binding/);
	});
});
