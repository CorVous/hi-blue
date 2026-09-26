import { describe, expect, it, vi } from "vitest";
import { CapHitError } from "../../llm-client.js";
import {
	BrowserContentPackProvider,
	CONTENT_PACK_SYSTEM_PROMPT,
	DUAL_CONTENT_PACK_SYSTEM_PROMPT,
} from "../content-pack-provider.js";

const OUTER_ATTEMPT_BUDGET = 3;
const FIRST_RETRY_BACKOFF_MS = 1_000;

describe("CONTENT_PACK_SYSTEM_PROMPT", () => {
	it("requires the prose tell at MUST strength (issue #253)", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/examineDescription[\s\S]*MUST[\s\S]*paired space/,
		);
	});

	it("includes a worked example so the model knows what a tell looks like", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT.toLowerCase()).toContain("carry-0");
	});
});

describe("CONTENT_PACK_SYSTEM_PROMPT — convergence actor + prose-tell rules", () => {
	it("documents the new convergenceTier1ActorFlavor and convergenceTier2ActorFlavor fields", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toContain("convergenceTier1ActorFlavor");
		expect(CONTENT_PACK_SYSTEM_PROMPT).toContain("convergenceTier2ActorFlavor");
	});

	it("requires the convergence shared-presence prose-tell hint on examineDescription", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/MUST[\s\S]*(shared occupancy|another presence)/,
		);
	});
});

describe("CONTENT_PACK_SYSTEM_PROMPT — issue #335 rules", () => {
	it("describes activationFlavor as a field on objective_space", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(/activationFlavor/);
	});

	it("requires the objective_space prose tell at MUST strength", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/use_space[\s\S]*examineDescription[\s\S]*MUST/i,
		);
	});

	it("forbids {actor} in activationFlavor at MUST strength", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/activationFlavor[\s\S]*no.*\{actor\}/i,
		);
	});
});

describe("DUAL_CONTENT_PACK_SYSTEM_PROMPT — issue #335 rules", () => {
	it("describes activationFlavor as a field on objective_space", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(/activationFlavor/);
	});

	it("includes activationFlavor in the MUST-differ delta list", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(/activationFlavor/);
	});

	it("requires the objective_space prose tell at MUST strength", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/use_space[\s\S]*examineDescription[\s\S]*MUST/i,
		);
	});
});

describe("BrowserContentPackProvider — outer-retry layer", () => {
	const baseInput: import("../content-pack-provider.js").BindingContentPackInput =
		{
			phases: [
				{
					setting: "abandoned subway station",
					theme: "mundane",
					weather: "overcast",
					timeOfDay: "night",
					bindings: [
						{
							type: "carry",
							objectId: "carry-0-obj",
							spaceId: "carry-0-space",
						},
					],
					decoyIds: ["decoy-0", "decoy-1"],
					obstacleCount: 1,
				},
			],
		};

	function buildValidPack(): unknown {
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
						},
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

	it("Test 1 — Invalid binding pack on first call → corrective feedback → success on second call", async () => {
		const mockChatFn = vi.fn();

		const brokenPack = buildValidPack();
		const packObj = (brokenPack as Record<string, unknown>).pack as
			| Record<string, unknown>
			| undefined;
		if (packObj) {
			const bindings = packObj.bindings as
				| Record<string, unknown>[]
				| undefined;
			if (bindings?.[0]) {
				const space = bindings[0].space as Record<string, unknown>;
				delete space.examineDescription;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(
			result.phases[0]?.rawPack.bindings?.[0]?.space?.examineDescription,
		).toBe("A sturdy brass mount with a subtle indentation on its surface.");

		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call2Messages).toBeDefined();
		const correctionTurn = call2Messages?.find((msg) =>
			msg.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();
	});

	it("Test 2 — Two consecutive invalid responses → success on third call", async () => {
		const mockChatFn = vi.fn();

		const brokenPack1 = buildValidPack();
		const packObj1 = (brokenPack1 as Record<string, unknown>).pack as
			| Record<string, unknown>
			| undefined;
		if (packObj1) {
			const bindings = packObj1.bindings as
				| Record<string, unknown>[]
				| undefined;
			if (bindings?.[0]) {
				const obj = bindings[0].object as Record<string, unknown>;
				obj.placementFlavor = "Sets the key on its mount.";
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack1),
			reasoning: null,
		});

		const brokenPack2 = buildValidPack();
		const packObj2 = (brokenPack2 as Record<string, unknown>).pack as
			| Record<string, unknown>
			| undefined;
		if (packObj2) {
			const bindings = packObj2.bindings as
				| Record<string, unknown>[]
				| undefined;
			if (bindings?.[0]) {
				const obj = bindings[0].object as Record<string, unknown>;
				delete obj.useOutcome;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack2),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(3);
		expect(result.phases[0]?.rawPack.bindings?.[0]?.object?.useOutcome).toBe(
			"You turn the key over in your hands.",
		);
	});

	it("Test 3 — Budget exhaustion after three invalid responses → throws ContentPackError", async () => {
		const mockChatFn = vi.fn();

		const brokenPack = buildValidPack();
		const packObj = (brokenPack as Record<string, unknown>).pack as
			| Record<string, unknown>
			| undefined;
		if (packObj) {
			const bindings = packObj.bindings as
				| Record<string, unknown>[]
				| undefined;
			if (bindings?.[0]) {
				const obj = bindings[0].object as Record<string, unknown>;
				delete obj.examineDescription;
			}
		}
		mockChatFn.mockResolvedValue({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });

		await expect(provider.generateContentPacks(baseInput)).rejects.toThrow(
			/exhausted retry budget/,
		);
		expect(mockChatFn).toHaveBeenCalledTimes(OUTER_ATTEMPT_BUDGET);
	});

	it("Test 4 — corrective feedback message is present on second outer attempt", async () => {
		const mockChatFn = vi.fn();

		const brokenPack = buildValidPack();
		const packObj = (brokenPack as Record<string, unknown>).pack as
			| Record<string, unknown>
			| undefined;
		if (packObj) {
			const bindings = packObj.bindings as
				| Record<string, unknown>[]
				| undefined;
			if (bindings?.[0]) {
				const obj = bindings[0].object as Record<string, unknown>;
				delete obj.name;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);

		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call2Messages).toBeDefined();
		const correctionTurn = call2Messages?.find((msg) =>
			msg.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();

		expect(result.phases[0]?.rawPack.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
	});

	it("Test 5 — JSON parse failure on initial response → backoff → success", async () => {
		vi.useFakeTimers();

		const mockChatFn = vi.fn();

		mockChatFn.mockResolvedValueOnce({
			content: "{not valid json",
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const promise = provider.generateContentPacks(baseInput);

		await vi.waitFor(() => expect(mockChatFn).toHaveBeenCalledTimes(1));

		await vi.advanceTimersByTimeAsync(FIRST_RETRY_BACKOFF_MS);

		const result = await promise;

		vi.useRealTimers();

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.phases[0]?.rawPack.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
	});

	it("Test 6 — CapHitError short-circuits", async () => {
		const mockChatFn = vi.fn();

		mockChatFn.mockRejectedValueOnce(
			new CapHitError({
				message: "rate limit exceeded",
				reason: "global-daily",
				retryAfterSec: 3600,
			}),
		);

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });

		await expect(provider.generateContentPacks(baseInput)).rejects.toThrow(
			CapHitError,
		);
		expect(mockChatFn).toHaveBeenCalledTimes(1);
	});
});

describe("BrowserContentPackProvider — dual outer-retry layer", () => {
	const dualInput: import("../content-pack-provider.js").DualBindingContentPackInput =
		{
			phases: [
				{
					settingA: "abandoned subway station",
					settingB: "sun-baked salt flat",
					theme: "mundane",
					weatherA: "overcast",
					weatherB: "clear",
					timeOfDayA: "night",
					timeOfDayB: "midday",
					bindings: [
						{
							type: "carry",
							objectId: "carry-0-obj",
							spaceId: "carry-0-space",
						},
					],
					decoyIds: ["decoy-0", "decoy-1"],
					obstacleCount: 0,
				},
			],
		};

	function buildDualResponse(
		packAObjectName = "Iron Key",
		packBObjectName = "Bone Token",
	): unknown {
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
						packAObjectName,
						"Brass Pedestal",
					),
					packB: mkPack(
						"sun-baked salt flat",
						packBObjectName,
						"Survey Marker",
					),
				},
			],
		};
	}

	it("Test 1 — retries on dual validation failure (N=1), then succeeds and includes corrective feedback", async () => {
		const mockChatFn = vi.fn();

		const invalidResponse = buildDualResponse();
		const phases = (invalidResponse as Record<string, unknown>)
			.phases as Record<string, unknown>[];
		const packA = phases[0]?.packA as Record<string, unknown>;
		const bindings = packA.bindings as Record<string, unknown>[];
		const obj = bindings[0]?.object as Record<string, unknown>;
		delete obj.examineDescription;
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(invalidResponse),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildDualResponse()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateDualContentPacks(dualInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.phases[0]?.rawPackA.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
		expect(result.phases[0]?.rawPackB.bindings?.[0]?.object?.name).toBe(
			"Bone Token",
		);

		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call2Messages).toBeDefined();
		const correctionTurn = call2Messages?.find((msg) =>
			msg.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();
	});

	it("Test 2 — retries on dual validation failure (N=2), then succeeds and includes corrective feedback", async () => {
		const mockChatFn = vi.fn();

		const invalid1 = buildDualResponse();
		const phases1 = (invalid1 as Record<string, unknown>).phases as Record<
			string,
			unknown
		>[];
		const packA1 = phases1[0]?.packA as Record<string, unknown>;
		const bindings1 = packA1.bindings as Record<string, unknown>[];
		const obj1 = bindings1[0]?.object as Record<string, unknown>;
		delete obj1.name;
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(invalid1),
			reasoning: null,
		});

		const invalid2 = buildDualResponse();
		const phases2 = (invalid2 as Record<string, unknown>).phases as Record<
			string,
			unknown
		>[];
		const packA2 = phases2[0]?.packA as Record<string, unknown>;
		const bindings2 = packA2.bindings as Record<string, unknown>[];
		const obj2 = bindings2[0]?.object as Record<string, unknown>;
		obj2.placementFlavor = "Sets it on the pedestal.";
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(invalid2),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildDualResponse()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateDualContentPacks(dualInput);

		expect(mockChatFn).toHaveBeenCalledTimes(3);
		expect(result.phases[0]?.rawPackA.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);

		const call3Messages = mockChatFn.mock.calls[2]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call3Messages).toBeDefined();
		const correctionTurn = call3Messages?.find((msg) =>
			msg.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();
	});

	it("Test 3 — CapHitError on first call short-circuits without retry", async () => {
		const mockChatFn = vi.fn();

		mockChatFn.mockRejectedValueOnce(
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

	it("Test 4 — budget exhaustion bubbles the last ContentPackError", async () => {
		const mockChatFn = vi.fn();

		const invalidResponse = buildDualResponse();
		const phases = (invalidResponse as Record<string, unknown>)
			.phases as Record<string, unknown>[];
		const packA = phases[0]?.packA as Record<string, unknown>;
		const bindings = packA.bindings as Record<string, unknown>[];
		const obj = bindings[0]?.object as Record<string, unknown>;
		delete obj.useOutcome;

		mockChatFn.mockResolvedValue({
			content: JSON.stringify(invalidResponse),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });

		await expect(provider.generateDualContentPacks(dualInput)).rejects.toThrow(
			/exhausted retry budget/,
		);
		expect(mockChatFn).toHaveBeenCalledTimes(OUTER_ATTEMPT_BUDGET);
	});

	it("Test 5 — JSON-parse failure on first call → backoff via fake timers → success", async () => {
		vi.useFakeTimers();

		const mockChatFn = vi.fn();

		mockChatFn.mockResolvedValueOnce({
			content: "{not valid json",
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildDualResponse()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const promise = provider.generateDualContentPacks(dualInput);

		await vi.waitFor(() => expect(mockChatFn).toHaveBeenCalledTimes(1));

		await vi.advanceTimersByTimeAsync(FIRST_RETRY_BACKOFF_MS);

		const result = await promise;

		vi.useRealTimers();

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.phases[0]?.rawPackA.bindings?.[0]?.object?.name).toBe(
			"Iron Key",
		);
	});
});

describe("BrowserContentPackProvider — corrective feedback strengthening", () => {
	const carryInput: import("../content-pack-provider.js").BindingContentPackInput =
		{
			phases: [
				{
					setting: "abandoned subway station",
					theme: "mundane",
					weather: "overcast",
					timeOfDay: "night",
					bindings: [
						{
							type: "carry",
							objectId: "carry-0-obj",
							spaceId: "carry-0-space",
						},
					],
					decoyIds: ["decoy-0", "decoy-1"],
					obstacleCount: 1,
				},
			],
		};

	const useSpaceInput: import("../content-pack-provider.js").BindingContentPackInput =
		{
			phases: [
				{
					setting: "abandoned subway station",
					theme: "mundane",
					weather: "overcast",
					timeOfDay: "night",
					bindings: [
						{
							type: "use_space",
							spaceId: "useSpace-0-space",
						},
					],
					decoyIds: ["decoy-0", "decoy-1"],
					obstacleCount: 1,
				},
			],
		};

	function buildValidCarryPack(): unknown {
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
						},
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

	function buildValidUseSpacePack(): unknown {
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

	it("includes the previous raw JSON as an assistant turn on the corrective retry", async () => {
		const mockChatFn = vi.fn();

		const brokenPack = buildValidCarryPack();
		const packObj = (brokenPack as Record<string, unknown>).pack as Record<
			string,
			unknown
		>;
		const decoys = packObj.decoys as [
			Record<string, unknown>,
			...Record<string, unknown>[],
		];
		decoys[0].examineDescription =
			"An old switch you might find in a forgotten panel.";
		const brokenRaw = JSON.stringify(brokenPack);
		mockChatFn.mockResolvedValueOnce({ content: brokenRaw, reasoning: null });

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidCarryPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		await provider.generateContentPacks(carryInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);

		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call2Messages).toBeDefined();

		const assistantTurn = call2Messages?.find((m) => m.role === "assistant");
		expect(assistantTurn).toBeDefined();
		expect(assistantTurn?.content).toBe(brokenRaw);

		const assistantIdx =
			call2Messages?.findIndex((m) => m.role === "assistant") ?? -1;
		const correctiveIdx =
			call2Messages?.findIndex((m) =>
				m.content.includes("Your previous attempt failed validation"),
			) ?? -1;
		expect(assistantIdx).toBeGreaterThanOrEqual(0);
		expect(correctiveIdx).toBeGreaterThan(assistantIdx);
	});

	it("names the offending keyword in the corrective feedback for a forbidden-use-cue decoy", async () => {
		const mockChatFn = vi.fn();

		const brokenPack = buildValidCarryPack();
		const packObj = (brokenPack as Record<string, unknown>).pack as Record<
			string,
			unknown
		>;
		const decoys = packObj.decoys as [
			Record<string, unknown>,
			...Record<string, unknown>[],
		];
		decoys[0].examineDescription =
			"An old switch you might find in a forgotten panel.";
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidCarryPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		await provider.generateContentPacks(carryInput);

		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		const correctionTurn = call2Messages?.find((m) =>
			m.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();

		expect(correctionTurn?.content).toMatch(/"switch"/);
		expect(correctionTurn?.content).toMatch(/decoy-0/);
	});

	it("includes the use-cue keyword hint list for a missing-use-cue UseSpace error", async () => {
		const mockChatFn = vi.fn();

		const brokenPack = buildValidUseSpacePack();
		const packObj = (brokenPack as Record<string, unknown>).pack as Record<
			string,
			unknown
		>;
		const bindings = packObj.bindings as [
			Record<string, unknown>,
			...Record<string, unknown>[],
		];
		const space = bindings[0].space as Record<string, unknown>;
		space.examineDescription = "A featureless surface set into the wall.";
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidUseSpacePack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		await provider.generateContentPacks(useSpaceInput);

		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		const correctionTurn = call2Messages?.find((m) =>
			m.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();

		expect(correctionTurn?.content).toMatch(/"use"/);
		expect(correctionTurn?.content).toMatch(/"activate"/);
		expect(correctionTurn?.content).toMatch(/"press"/);
		expect(correctionTurn?.content).toMatch(/use-space binding/);
	});
});
