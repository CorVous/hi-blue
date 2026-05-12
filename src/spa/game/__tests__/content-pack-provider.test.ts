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
	examineMentionsUseTell,
	validateContentPacks,
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

// ── examineMentionsUseTell helper (issue #334) ────────────────────────────────

describe("examineMentionsUseTell", () => {
	it("matches a verb-of-activation like 'press'", () => {
		expect(
			examineMentionsUseTell(
				"A small brass dial mounted on a panel. It looks like it should be pressed to open the chamber.",
			),
		).toBe(true);
	});

	it("matches the bare verb 'use'", () => {
		expect(
			examineMentionsUseTell(
				"A peculiar device. You wonder if it could be used.",
			),
		).toBe(true);
	});

	it("matches a control noun like 'lever' even without an activation verb", () => {
		expect(
			examineMentionsUseTell(
				"A heavy iron lever bolted to the wall, weathered by years of damp.",
			),
		).toBe(true);
	});

	it("rejects an examine with no verb or control-noun cue", () => {
		expect(
			examineMentionsUseTell(
				"A small porcelain figurine, chipped along one edge but otherwise intact.",
			),
		).toBe(false);
	});

	it("does not match 'use' inside a longer word like 'fuse'", () => {
		expect(
			examineMentionsUseTell(
				"A scorched copper fuse, brittle and discoloured.",
			),
		).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(examineMentionsUseTell("PRESS the BUTTON to begin.")).toBe(true);
	});
});

// ── interesting_object Use-Item flavor field validation (issue #334) ──────────

describe("validateContentPacks — interesting_object Use-Item flavor validation", () => {
	const inputWithInteresting = {
		phases: [
			{
				phaseNumber: 1 as const,
				setting: "abandoned subway station",
				theme: "mundane",
				k: 0,
				n: 1,
				m: 0,
			},
		],
	};

	function buildInterestingResponse(overrides: Record<string, unknown>) {
		const item: Record<string, unknown> = {
			id: "item1",
			kind: "interesting_object",
			name: "Brass Switch",
			examineDescription:
				"A small brass switch mounted on a panel. It looks like it should be pressed.",
			useOutcome: "The switch clicks under your finger but nothing changes.",
			activationFlavor:
				"The switch flips home with a hard mechanical thunk and a single amber light pulses on.",
			postExamineDescription:
				"The switch sits locked in its on position, the amber light steady behind it.",
			postLookFlavor: "an amber pinpoint of light glows beside the panel",
			...overrides,
		};
		return {
			packs: [
				{
					phaseNumber: 1,
					setting: "abandoned subway station",
					objectivePairs: [],
					interestingObjects: [item],
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

	it("accepts an interesting_object with all Use-Item flavor fields", () => {
		const result = validateContentPacks(
			buildInterestingResponse({}),
			inputWithInteresting,
		);
		const item = result.packs[0]?.interestingObjects[0];
		expect(item?.activationFlavor).toContain("mechanical thunk");
		expect(item?.postExamineDescription).toContain("locked in its on position");
		expect(item?.postLookFlavor).toContain("amber pinpoint");
	});

	it("rejects an examineDescription with no verb-of-activation or control-noun cue", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({
					examineDescription:
						"A small porcelain figurine, chipped along one edge but otherwise intact.",
				}),
				inputWithInteresting,
			),
		).toThrow(/verb-of-activation cue|control noun/);
	});

	it("rejects a missing activationFlavor", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({ activationFlavor: undefined }),
				inputWithInteresting,
			),
		).toThrow(/activationFlavor/);
	});

	it("rejects an empty activationFlavor", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({ activationFlavor: "" }),
				inputWithInteresting,
			),
		).toThrow(/activationFlavor/);
	});

	it("rejects an activationFlavor that contains {actor}", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({
					activationFlavor: "{actor} flips the switch home.",
				}),
				inputWithInteresting,
			),
		).toThrow(/activationFlavor/);
	});

	it("rejects a missing postExamineDescription", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({ postExamineDescription: undefined }),
				inputWithInteresting,
			),
		).toThrow(/postExamineDescription/);
	});

	it("rejects a postExamineDescription that contains {actor}", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({
					postExamineDescription: "{actor} sees the switch locked on.",
				}),
				inputWithInteresting,
			),
		).toThrow(/postExamineDescription/);
	});

	it("rejects a postLookFlavor that contains {actor}", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({
					postLookFlavor: "{actor} glances at the amber light",
				}),
				inputWithInteresting,
			),
		).toThrow(/postLookFlavor/);
	});

	it("accepts an interesting_object with postLookFlavor omitted (optional)", () => {
		const result = validateContentPacks(
			buildInterestingResponse({ postLookFlavor: undefined }),
			inputWithInteresting,
		);
		const item = result.packs[0]?.interestingObjects[0];
		expect(item?.activationFlavor).toBeDefined();
		expect(item?.postLookFlavor).toBeUndefined();
	});
});
