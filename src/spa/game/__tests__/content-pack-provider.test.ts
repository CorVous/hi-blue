/**
 * Tests for content-pack prose-tell rule and helpers.
 *
 * Issue #253: examineDescription of each objective_object MUST name its paired
 * objective_space — that prose tell is the only AI-discoverable channel for the
 * pairing (objective_spaces are filtered out of the cone projection in
 * prompt-builder.ts:481, so the pairsWithSpaceId field is invisible to daemons).
 */

import { describe, expect, it } from "vitest";
import {
	CONTENT_PACK_SYSTEM_PROMPT,
	examineMentionsPairedSpace,
	validateContentPacks,
	validateDualContentPacks,
} from "../content-pack-provider.js";

describe("examineMentionsPairedSpace", () => {
	it("matches the literal space name (case-insensitive)", () => {
		expect(
			examineMentionsPairedSpace(
				"A heavy iron key, weathered by time. It looks like it belongs on the Brass Pedestal.",
				"Brass Pedestal",
			),
		).toBe(true);
	});

	it("matches via the head noun when the full literal name is absent", () => {
		expect(
			examineMentionsPairedSpace(
				"A weathered iron key. The teeth are worn smooth. It would slot into the pedestal at the room's center.",
				"Brass Pedestal",
			),
		).toBe(true);
	});

	it("is case-insensitive on the examine side", () => {
		expect(
			examineMentionsPairedSpace(
				"IT BELONGS ON THE BRASS PEDESTAL.",
				"brass pedestal",
			),
		).toBe(true);
	});

	// Verbatim playtest 0007 quotes — these are the exact examineDescriptions
	// that surfaced zero tells. They MUST be rejected by the prose-tell check.
	it("rejects the playtest-0007 'rusted iron key' examine for a Brass Pedestal", () => {
		expect(
			examineMentionsPairedSpace(
				"rusted iron key, heavily corroded but still intact. The teeth are worn smooth from use",
				"Brass Pedestal",
			),
		).toBe(false);
	});

	it("rejects the playtest-0007 'flimsy container' examine for a Crystal Altar", () => {
		expect(
			examineMentionsPairedSpace(
				"flimsy container, dented and scratched—water remains sealed within its plastic walls—label faded beyond recognition",
				"Crystal Altar",
			),
		).toBe(false);
	});

	it("rejects an examine that shares only a stopword-length token with the space", () => {
		// "of" is a stopword (length 2) — must not count as a match.
		expect(
			examineMentionsPairedSpace("an of-the-earth artifact", "Cup of Light"),
		).toBe(false);
	});

	it("returns false for an empty space name", () => {
		expect(examineMentionsPairedSpace("anything goes here", "")).toBe(false);
	});
});

describe("CONTENT_PACK_SYSTEM_PROMPT", () => {
	it("requires the prose tell at MUST strength (issue #253)", () => {
		// The exact wording is allowed to drift, but the rule must be MUST-level
		// and reference both examineDescription and the paired space.
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/examineDescription[\s\S]*MUST[\s\S]*paired objective_space/,
		);
	});

	it("includes a worked example so the model knows what a tell looks like", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT.toLowerCase()).toContain(
			"brass pedestal",
		);
	});
});

describe("validateContentPacks — prose tell contract", () => {
	const input = {
		phases: [
			{
				phaseNumber: 1 as const,
				setting: "abandoned subway station",
				theme: "mundane",
				k: 1,
				n: 0,
				m: 0,
			},
		],
	};

	function buildResponse(
		objectExamine: string,
		spaceName = "Brass Pedestal",
		proximityFlavor = "The key hums faintly, resonating with the pedestal nearby.",
		convergenceTier1Flavor = "A lone figure stands at the pedestal, silhouetted against the dim light.",
		convergenceTier2Flavor = "Two figures converge at the pedestal, their presences mingling in the shadow.",
	): unknown {
		return {
			packs: [
				{
					phaseNumber: 1,
					setting: "abandoned subway station",
					objectivePairs: [
						{
							object: {
								id: "obj1",
								kind: "objective_object",
								name: "Iron Key",
								examineDescription: objectExamine,
								useOutcome: "You turn the key over in your hands.",
								pairsWithSpaceId: "space1",
								placementFlavor: "{actor} sets the key on its mount.",
								proximityFlavor,
							},
							space: {
								id: "space1",
								kind: "objective_space",
								name: spaceName,
								examineDescription: "A sturdy mount for a small relic.",
								convergenceTier1Flavor,
								convergenceTier2Flavor,
							},
						},
					],
					interestingObjects: [],
					obstacles: [],
					landmarks: {
						north: {
							shortName: "the signal tower",
							horizonPhrase: "rises above the platform",
						},
						south: {
							shortName: "the collapsed entrance",
							horizonPhrase: "gapes like a wound in the dark",
						},
						east: {
							shortName: "the rusted fan shaft",
							horizonPhrase: "spins slowly in the stale air",
						},
						west: {
							shortName: "the flooded tunnel",
							horizonPhrase: "disappears into still black water",
						},
					},
				},
			],
		};
	}

	it("accepts a content pack whose objective_object examine names the paired space", () => {
		const result = validateContentPacks(
			buildResponse(
				"An iron key. It looks like it belongs on the brass pedestal across the room.",
			),
			input,
		);
		const pair = result.packs[0]?.objectivePairs[0];
		expect(pair).toBeDefined();
		if (!pair) return;
		expect(
			examineMentionsPairedSpace(
				pair.object.examineDescription,
				pair.space.name,
			),
		).toBe(true);
	});

	it("rejects a content pack whose objective_object examine does not mention the paired space", () => {
		expect(() =>
			validateContentPacks(
				buildResponse(
					"rusted iron key, heavily corroded but still intact. The teeth are worn smooth from use",
				),
				input,
			),
		).toThrow(/examineDescription does not mention paired space/);
	});

	it("rejects a content pack whose objective_object is missing proximityFlavor", () => {
		expect(() =>
			validateContentPacks(
				buildResponse(
					"An iron key. It looks like it belongs on the brass pedestal.",
					"Brass Pedestal",
					"",
				),
				input,
			),
		).toThrow(/proximityFlavor/);
	});

	it("persists proximityFlavor onto the returned WorldEntity", () => {
		const result = validateContentPacks(
			buildResponse(
				"An iron key. It looks like it belongs on the brass pedestal.",
				"Brass Pedestal",
				"The key hums faintly near the pedestal.",
			),
			input,
		);
		const pair = result.packs[0]?.objectivePairs[0];
		expect(pair?.object.proximityFlavor).toBe(
			"The key hums faintly near the pedestal.",
		);
	});
});

// ── shiftFlavor validation for obstacles ─────────────────────────────────────

describe("validateContentPacks — obstacle shiftFlavor validation", () => {
	const inputWithObstacle = {
		phases: [
			{
				phaseNumber: 1 as const,
				setting: "abandoned subway station",
				theme: "mundane",
				k: 0,
				n: 0,
				m: 1,
			},
		],
	};

	function buildObstacleResponse(shiftFlavor: unknown): unknown {
		return {
			packs: [
				{
					phaseNumber: 1,
					setting: "abandoned subway station",
					objectivePairs: [],
					interestingObjects: [],
					obstacles: [
						{
							id: "obs1",
							kind: "obstacle",
							name: "Rusted Gate",
							examineDescription: "An old rusted gate blocking the path.",
							...(shiftFlavor !== undefined ? { shiftFlavor } : {}),
						},
					],
					landmarks: {
						north: {
							shortName: "the signal tower",
							horizonPhrase: "rises above the platform",
						},
						south: {
							shortName: "the collapsed entrance",
							horizonPhrase: "gapes like a wound in the dark",
						},
						east: {
							shortName: "the rusted fan shaft",
							horizonPhrase: "spins slowly in the stale air",
						},
						west: {
							shortName: "the flooded tunnel",
							horizonPhrase: "disappears into still black water",
						},
					},
				},
			],
		};
	}

	it("accepts an obstacle with a valid shiftFlavor", () => {
		const result = validateContentPacks(
			buildObstacleResponse(
				"The rusted gate scrapes along the floor with a grinding shriek.",
			),
			inputWithObstacle,
		);
		const obstacle = result.packs[0]?.obstacles[0];
		expect(obstacle?.shiftFlavor).toBe(
			"The rusted gate scrapes along the floor with a grinding shriek.",
		);
	});

	it("rejects an obstacle missing shiftFlavor", () => {
		expect(() =>
			validateContentPacks(buildObstacleResponse(undefined), inputWithObstacle),
		).toThrow(/shiftFlavor/);
	});

	it("rejects an obstacle with an empty shiftFlavor", () => {
		expect(() =>
			validateContentPacks(buildObstacleResponse(""), inputWithObstacle),
		).toThrow(/shiftFlavor/);
	});

	it("rejects an obstacle whose shiftFlavor contains {actor}", () => {
		expect(() =>
			validateContentPacks(
				buildObstacleResponse("{actor} knocks the gate aside."),
				inputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("persists shiftFlavor onto the returned WorldEntity", () => {
		const flavor = "The rusted gate groans as it slides aside.";
		const result = validateContentPacks(
			buildObstacleResponse(flavor),
			inputWithObstacle,
		);
		const obstacle = result.packs[0]?.obstacles[0];
		expect(obstacle?.shiftFlavor).toBe(flavor);
	});
});

// ── convergenceTier flavor validation for objective_space ─────────────────────

describe("validateContentPacks — convergence tier flavor validation", () => {
	const inputWithPair = {
		phases: [
			{
				phaseNumber: 1 as const,
				setting: "abandoned subway station",
				theme: "mundane",
				k: 1,
				n: 0,
				m: 0,
			},
		],
	};

	function buildConvergenceResponse(
		convergenceTier1Flavor?: unknown,
		convergenceTier2Flavor?: unknown,
	): unknown {
		const spaceFields: Record<string, unknown> = {
			id: "space1",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription: "A sturdy brass pedestal.",
		};
		if (convergenceTier1Flavor !== undefined) {
			spaceFields.convergenceTier1Flavor = convergenceTier1Flavor;
		}
		if (convergenceTier2Flavor !== undefined) {
			spaceFields.convergenceTier2Flavor = convergenceTier2Flavor;
		}
		return {
			packs: [
				{
					phaseNumber: 1,
					setting: "abandoned subway station",
					objectivePairs: [
						{
							object: {
								id: "obj1",
								kind: "objective_object",
								name: "Iron Key",
								examineDescription:
									"An iron key. It belongs on the brass pedestal.",
								useOutcome: "You turn the key over in your hands.",
								pairsWithSpaceId: "space1",
								placementFlavor: "{actor} sets the key on its mount.",
								proximityFlavor: "The key hums faintly near the pedestal.",
							},
							space: spaceFields,
						},
					],
					interestingObjects: [],
					obstacles: [],
					landmarks: {
						north: {
							shortName: "the signal tower",
							horizonPhrase: "rises above the platform",
						},
						south: {
							shortName: "the collapsed entrance",
							horizonPhrase: "gapes like a wound in the dark",
						},
						east: {
							shortName: "the rusted fan shaft",
							horizonPhrase: "spins slowly in the stale air",
						},
						west: {
							shortName: "the flooded tunnel",
							horizonPhrase: "disappears into still black water",
						},
					},
				},
			],
		};
	}

	it("accepts a content pack with valid convergence tier flavors", () => {
		const result = validateContentPacks(
			buildConvergenceResponse(
				"A lone figure stands at the pedestal.",
				"Two figures converge at the pedestal.",
			),
			inputWithPair,
		);
		const space = result.packs[0]?.objectivePairs[0]?.space;
		expect(space?.convergenceTier1Flavor).toBe(
			"A lone figure stands at the pedestal.",
		);
		expect(space?.convergenceTier2Flavor).toBe(
			"Two figures converge at the pedestal.",
		);
	});

	it("throws ContentPackError when convergenceTier1Flavor is missing", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(
					undefined,
					"Two figures converge at the pedestal.",
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	it("throws ContentPackError when convergenceTier2Flavor is missing", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(
					"A lone figure stands at the pedestal.",
					undefined,
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier2Flavor/);
	});

	it("throws ContentPackError when convergenceTier1Flavor contains {actor}", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(
					"{actor} stands at the pedestal.",
					"Two figures converge at the pedestal.",
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	it("throws ContentPackError when convergenceTier2Flavor contains {actor}", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(
					"A lone figure stands at the pedestal.",
					"{actor} and another figure converge.",
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier2Flavor/);
	});

	it("throws ContentPackError when convergenceTier1Flavor is an empty string", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse("", "Two figures converge at the pedestal."),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});
});

// ── shiftFlavor validation for dual-pack obstacles (issue #337) ──────────────

describe("validateDualContentPacks — obstacle shiftFlavor validation", () => {
	const dualInputWithObstacle = {
		phases: [
			{
				phaseNumber: 1 as const,
				settingA: "abandoned subway station",
				settingB: "overgrown ruin",
				theme: "mundane",
				k: 0,
				n: 0,
				m: 1,
			},
		],
	};

	const STUB_LANDMARKS = {
		north: { shortName: "the signal tower", horizonPhrase: "rises high" },
		south: { shortName: "the collapsed entrance", horizonPhrase: "gapes wide" },
		east: { shortName: "the rusted shaft", horizonPhrase: "spins slowly" },
		west: { shortName: "the flooded tunnel", horizonPhrase: "fades to black" },
	};

	function buildDualObstacleResponse(
		packAShift: unknown,
		packBShift: unknown,
	): unknown {
		const buildObstacle = (shiftFlavor: unknown, ab: "a" | "b") => ({
			id: "obs1",
			kind: "obstacle",
			name: `Rusted Gate ${ab}`,
			examineDescription: `An old rusted gate ${ab}.`,
			...(shiftFlavor !== undefined ? { shiftFlavor } : {}),
		});
		return {
			phases: [
				{
					phaseNumber: 1,
					packA: {
						setting: "abandoned subway station",
						objectivePairs: [],
						interestingObjects: [],
						obstacles: [buildObstacle(packAShift, "a")],
						landmarks: STUB_LANDMARKS,
					},
					packB: {
						setting: "overgrown ruin",
						objectivePairs: [],
						interestingObjects: [],
						obstacles: [buildObstacle(packBShift, "b")],
						landmarks: STUB_LANDMARKS,
					},
				},
			],
		};
	}

	it("accepts dual-pack obstacles with valid shiftFlavor on both packs", () => {
		const result = validateDualContentPacks(
			buildDualObstacleResponse(
				"The rusted gate scrapes along the floor.",
				"The mossy gate slides through wet leaves.",
			),
			dualInputWithObstacle,
		);
		expect(result.phases[0]?.packA.obstacles[0]?.shiftFlavor).toBe(
			"The rusted gate scrapes along the floor.",
		);
		expect(result.phases[0]?.packB.obstacles[0]?.shiftFlavor).toBe(
			"The mossy gate slides through wet leaves.",
		);
	});

	it("rejects a dual-pack obstacle missing shiftFlavor on packA", () => {
		expect(() =>
			validateDualContentPacks(
				buildDualObstacleResponse(undefined, "Something rustles."),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("rejects a dual-pack obstacle missing shiftFlavor on packB", () => {
		expect(() =>
			validateDualContentPacks(
				buildDualObstacleResponse("The gate scrapes.", undefined),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("rejects a dual-pack obstacle with an empty shiftFlavor", () => {
		expect(() =>
			validateDualContentPacks(
				buildDualObstacleResponse("", "Something rustles."),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("rejects a dual-pack obstacle whose shiftFlavor contains {actor}", () => {
		expect(() =>
			validateDualContentPacks(
				buildDualObstacleResponse(
					"{actor} pushes the gate.",
					"Something rustles.",
				),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});
});
