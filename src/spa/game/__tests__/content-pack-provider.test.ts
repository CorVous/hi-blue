/**
 * Tests for content-pack prose-tell rule and helpers.
 *
 * Issue #253: examineDescription of each objective_object MUST name its paired
 * objective_space — that prose tell is the only AI-discoverable channel for the
 * pairing (objective_spaces are filtered out of the cone projection in
 * prompt-builder.ts:481, so the pairsWithSpaceId field is invisible to daemons).
 */

import { describe, expect, it, vi } from "vitest";
import { CapHitError } from "../../llm-client.js";
import type { ContentPackRepair } from "../content-pack-provider.js";
import {
	BrowserContentPackProvider,
	CONTENT_PACK_SYSTEM_PROMPT,
	DUAL_CONTENT_PACK_SYSTEM_PROMPT,
	examineMentionsPairedSpace,
	examineMentionsUseTell,
	PARTIAL_RETRY_SYSTEM_PROMPT,
	validateContentPacks,
	validateContentPacksOrThrow,
	validateDualContentPacks,
	validateDualContentPacksOrThrow,
} from "../content-pack-provider.js";

/**
 * Run `fn` and assert it does NOT throw, but that a `console.warn` call was
 * made whose argument matches `pattern`. Used to verify the soft-validation
 * downgrade where inclusion/exclusion prose-tell mismatches log a warning
 * instead of crashing bootstrap.
 */
function expectWarnNotThrow(fn: () => void, pattern: RegExp): void {
	const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		expect(fn).not.toThrow();
		expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(pattern));
	} finally {
		warnSpy.mockRestore();
	}
}

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

	it("matches via token-overlap when multiple content tokens appear (issue #382 motivating case)", () => {
		expect(
			examineMentionsPairedSpace(
				"A heavy brass ring that once slid along the ropes near the stage pulley.",
				"Stage Pulley System",
			),
		).toBe(true);
	});

	it("matches when the examine contains the full space name (regression guard for 'Main Console Slot')", () => {
		expect(
			examineMentionsPairedSpace(
				"fits into the main console slot",
				"Main Console Slot",
			),
		).toBe(true);
	});

	it("matches via token-overlap on a non-head-noun token (telescope vs Telescope Mounting Arm)", () => {
		expect(
			examineMentionsPairedSpace(
				"intended for the telescope mount",
				"Telescope Mounting Arm",
			),
		).toBe(true);
	});

	it("rejects an examine that shares only the stopword 'for' with the space name", () => {
		expect(
			examineMentionsPairedSpace("the cake is for you", "For The Win"),
		).toBe(false);
	});

	it("rejects an examine that shares only a 3-letter token with the space name", () => {
		expect(
			examineMentionsPairedSpace("the top of the stack", "Top Shelf"),
		).toBe(false);
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

/** Sentinel so a test can request that a field be omitted from the LLM response. */
const OMIT = Symbol("OMIT");

describe("validateContentPacks — prose tell contract", () => {
	const input = {
		phases: [
			{
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
		convergenceTier1Flavor: unknown = "A lone figure stands at the pedestal, silhouetted against the dim light.",
		convergenceTier2Flavor: unknown = "Two figures converge at the pedestal, their presences mingling in the shadow.",
		convergenceTier1ActorFlavor: unknown = "You linger at the pedestal; the place feels poised for company.",
		convergenceTier2ActorFlavor: unknown = "You share the pedestal with another presence; the runes thrum.",
	): unknown {
		const spaceFields: Record<string, unknown> = {
			id: "space1",
			kind: "objective_space",
			name: spaceName,
			examineDescription:
				"A sturdy mount. Press a relic onto it to activate the brass pedestal; the surface awaits a shared presence.",
			activationFlavor:
				"The pedestal's runes ignite and warm air rises from its surface.",
		};
		if (convergenceTier1Flavor !== OMIT)
			spaceFields.convergenceTier1Flavor = convergenceTier1Flavor;
		if (convergenceTier2Flavor !== OMIT)
			spaceFields.convergenceTier2Flavor = convergenceTier2Flavor;
		if (convergenceTier1ActorFlavor !== OMIT)
			spaceFields.convergenceTier1ActorFlavor = convergenceTier1ActorFlavor;
		if (convergenceTier2ActorFlavor !== OMIT)
			spaceFields.convergenceTier2ActorFlavor = convergenceTier2ActorFlavor;
		return {
			packs: [
				{
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

	it("accepts a content pack whose objective_object examine names the paired space", () => {
		const result = validateContentPacksOrThrow(
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

	it("warns but does not throw when objective_object examine does not mention the paired space", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacksOrThrow(
					buildResponse(
						"rusted iron key, heavily corroded but still intact. The teeth are worn smooth from use",
					),
					input,
				),
			/examineDescription does not mention paired space/,
		);
	});

	it("rejects a content pack whose objective_object is missing proximityFlavor", () => {
		expect(() =>
			validateContentPacksOrThrow(
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
		const result = validateContentPacksOrThrow(
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
		const result = validateContentPacksOrThrow(
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
			validateContentPacksOrThrow(
				buildObstacleResponse(undefined),
				inputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("rejects an obstacle with an empty shiftFlavor", () => {
		expect(() =>
			validateContentPacksOrThrow(buildObstacleResponse(""), inputWithObstacle),
		).toThrow(/shiftFlavor/);
	});

	it("throws ContentPackError when an obstacle shiftFlavor contains {actor}", () => {
		const result = validateContentPacks(
			buildObstacleResponse("{actor} knocks the gate aside."),
			inputWithObstacle,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "shiftFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("obs1");
			expect(error?.retryUnit.kind).toBe("obstacle");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildObstacleResponse("{actor} knocks the gate aside."),
				inputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("persists shiftFlavor onto the returned WorldEntity", () => {
		const flavor = "The rusted gate groans as it slides aside.";
		const result = validateContentPacksOrThrow(
			buildObstacleResponse(flavor),
			inputWithObstacle,
		);
		const obstacle = result.packs[0]?.obstacles[0];
		expect(obstacle?.shiftFlavor).toBe(flavor);
	});

	// ── Test A: placementFlavor missing {actor} ───────────────────────────────

	it("throws ContentPackError when placementFlavor is missing {actor}", () => {
		const inputWithPair = {
			phases: [
				{
					setting: "abandoned subway station",
					theme: "mundane",
					k: 1,
					n: 0,
					m: 0,
				},
			],
		};
		const badPack = {
			packs: [
				{
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
								placementFlavor: "The actor sets the key on its mount.",
								proximityFlavor: "The key hums faintly near the pedestal.",
							},
							space: {
								id: "space1",
								kind: "objective_space",
								name: "Brass Pedestal",
								examineDescription:
									"A sturdy brass pedestal. Press an item onto it to activate.",
								activationFlavor: "The pedestal hums to life.",
								satisfactionFlavor: "The pedestal glows brightly.",
								postExamineDescription: "The pedestal glows softly.",
								postLookFlavor: "the pedestal hums.",
								convergenceTier1Flavor: "A lone figure stands.",
								convergenceTier2Flavor: "Two figures converge.",
								convergenceTier1ActorFlavor: "You linger alone.",
								convergenceTier2ActorFlavor: "You share the space.",
							},
						},
					],
					interestingObjects: [],
					obstacles: [],
					landmarks: {
						north: {
							shortName: "the tower",
							horizonPhrase: "rises high",
						},
						south: {
							shortName: "the entrance",
							horizonPhrase: "gapes wide",
						},
						east: { shortName: "the shaft", horizonPhrase: "spins slowly" },
						west: { shortName: "the tunnel", horizonPhrase: "fades black" },
					},
				},
			],
		};
		const result = validateContentPacks(badPack, inputWithPair);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "placementFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-presence");
			expect(error?.entityId).toBe("obj1");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() => validateContentPacksOrThrow(badPack, inputWithPair)).toThrow(
			/placementFlavor/,
		);
	});

	// ── Test B: obstacle shiftFlavor containing {actor} (already flipped above) ─

	it("throws ContentPackError when obstacle shiftFlavor contains {actor} via new error API", () => {
		const result = validateContentPacks(
			buildObstacleResponse("{actor} shoves the gate."),
			inputWithObstacle,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "shiftFlavor");
			expect(error?.rule).toBe("actor-exclusion");
		}
	});
});

// ── convergenceTier flavor validation for objective_space ─────────────────────

describe("validateContentPacks — convergence tier flavor validation", () => {
	const inputWithPair = {
		phases: [
			{
				setting: "abandoned subway station",
				theme: "mundane",
				k: 1,
				n: 0,
				m: 0,
			},
		],
	};

	function buildConvergenceResponse(
		convergenceTier1Flavor: unknown = "A lone figure stands at the pedestal.",
		convergenceTier2Flavor: unknown = "Two figures converge at the pedestal.",
		convergenceTier1ActorFlavor: unknown = "You linger at the pedestal; the place feels poised for company.",
		convergenceTier2ActorFlavor: unknown = "You share the pedestal with another presence; the runes thrum.",
	): unknown {
		const spaceFields: Record<string, unknown> = {
			id: "space1",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription:
				"A sturdy brass pedestal. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
			activationFlavor:
				"The pedestal hums to life and its surface flushes with warmth.",
		};
		if (convergenceTier1Flavor !== OMIT)
			spaceFields.convergenceTier1Flavor = convergenceTier1Flavor;
		if (convergenceTier2Flavor !== OMIT)
			spaceFields.convergenceTier2Flavor = convergenceTier2Flavor;
		if (convergenceTier1ActorFlavor !== OMIT)
			spaceFields.convergenceTier1ActorFlavor = convergenceTier1ActorFlavor;
		if (convergenceTier2ActorFlavor !== OMIT)
			spaceFields.convergenceTier2ActorFlavor = convergenceTier2ActorFlavor;
		return {
			packs: [
				{
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
		const result = validateContentPacksOrThrow(
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
			validateContentPacksOrThrow(
				buildConvergenceResponse(OMIT, "Two figures converge at the pedestal."),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	it("throws ContentPackError when convergenceTier2Flavor is missing", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse("A lone figure stands at the pedestal.", OMIT),
				inputWithPair,
			),
		).toThrow(/convergenceTier2Flavor/);
	});

	it("throws ContentPackError when convergenceTier1Flavor contains {actor}", () => {
		const result = validateContentPacks(
			buildConvergenceResponse(
				"{actor} stands at the pedestal.",
				"Two figures converge at the pedestal.",
			),
			inputWithPair,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find(
				(e) => e.field === "convergenceTier1Flavor",
			);
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("space1");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(
					"{actor} stands at the pedestal.",
					"Two figures converge at the pedestal.",
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	it("throws ContentPackError when convergenceTier2Flavor contains {actor}", () => {
		const result = validateContentPacks(
			buildConvergenceResponse(
				"A lone figure stands at the pedestal.",
				"{actor} and another figure converge.",
			),
			inputWithPair,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find(
				(e) => e.field === "convergenceTier2Flavor",
			);
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("space1");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() =>
			validateContentPacksOrThrow(
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
			validateContentPacksOrThrow(
				buildConvergenceResponse("", "Two figures converge at the pedestal."),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	// ── actor-side tier flavors (issue #336) ────────────────────────────────────

	it("accepts a pack with all four tier flavors and persists the actor variants", () => {
		const result = validateContentPacksOrThrow(
			buildConvergenceResponse(),
			inputWithPair,
		);
		const space = result.packs[0]?.objectivePairs[0]?.space;
		expect(space?.convergenceTier1ActorFlavor).toBe(
			"You linger at the pedestal; the place feels poised for company.",
		);
		expect(space?.convergenceTier2ActorFlavor).toBe(
			"You share the pedestal with another presence; the runes thrum.",
		);
	});

	it("throws ContentPackError when convergenceTier1ActorFlavor is missing", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(undefined, undefined, OMIT),
				inputWithPair,
			),
		).toThrow(/convergenceTier1ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier2ActorFlavor is missing", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(undefined, undefined, undefined, OMIT),
				inputWithPair,
			),
		).toThrow(/convergenceTier2ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier1ActorFlavor is empty", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(undefined, undefined, ""),
				inputWithPair,
			),
		).toThrow(/convergenceTier1ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier2ActorFlavor is empty", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(undefined, undefined, undefined, ""),
				inputWithPair,
			),
		).toThrow(/convergenceTier2ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier1ActorFlavor contains {actor}", () => {
		const result = validateContentPacks(
			buildConvergenceResponse(
				undefined,
				undefined,
				"{actor} stands alone at the pedestal.",
			),
			inputWithPair,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find(
				(e) => e.field === "convergenceTier1ActorFlavor",
			);
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("space1");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(
					undefined,
					undefined,
					"{actor} stands alone at the pedestal.",
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier1ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier2ActorFlavor contains {actor}", () => {
		const result = validateContentPacks(
			buildConvergenceResponse(
				undefined,
				undefined,
				undefined,
				"{actor} and another share the pedestal.",
			),
			inputWithPair,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find(
				(e) => e.field === "convergenceTier2ActorFlavor",
			);
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("space1");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildConvergenceResponse(
					undefined,
					undefined,
					undefined,
					"{actor} and another share the pedestal.",
				),
				inputWithPair,
			),
		).toThrow(/convergenceTier2ActorFlavor/);
	});
});

// ── prompt rules (issue #336) ─────────────────────────────────────────────────

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

// ── examineMentionsUseTell helper (issues #334, #335) ─────────────────────────

describe("examineMentionsUseTell", () => {
	// — verb-of-activation matches (#334, #335 share the same cue set) —
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

	it("matches an activation verb in context", () => {
		expect(
			examineMentionsUseTell(
				"A heavy stone slab carved with runes. Press the slab to activate the chamber.",
			),
		).toBe(true);
	});

	// — control / activator nouns —
	it("matches a control noun like 'lever' even without an activation verb", () => {
		expect(
			examineMentionsUseTell(
				"A heavy iron lever bolted to the wall, weathered by years of damp.",
			),
		).toBe(true);
	});

	it("matches a single cue word in isolation", () => {
		expect(examineMentionsUseTell("A copper button on the far wall.")).toBe(
			true,
		);
	});

	// — negative cases —
	it("rejects an examine with no verb or control-noun cue", () => {
		expect(
			examineMentionsUseTell(
				"A small porcelain figurine, chipped along one edge but otherwise intact.",
			),
		).toBe(false);
	});

	it("rejects a generic descriptive examine with no activation cue", () => {
		expect(
			examineMentionsUseTell(
				"A sturdy mount carved from weathered stone, half-buried in moss.",
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

	it("rejects 'fuse' (whole-word match — 'fuse' must not match 'use')", () => {
		expect(examineMentionsUseTell("A blown fuse hangs from the ceiling.")).toBe(
			false,
		);
	});

	it("returns false for the empty string", () => {
		expect(examineMentionsUseTell("")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(examineMentionsUseTell("PRESS the BUTTON to begin.")).toBe(true);
		expect(examineMentionsUseTell("PULL THE LEVER.")).toBe(true);
	});
});

// ── interesting_object Use-Item flavor field validation (issue #334) ──────────

describe("validateContentPacks — interesting_object Use-Item flavor validation", () => {
	const inputWithInteresting = {
		phases: [
			{
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
		const result = validateContentPacksOrThrow(
			buildInterestingResponse({}),
			inputWithInteresting,
		);
		const item = result.packs[0]?.interestingObjects[0];
		expect(item?.activationFlavor).toContain("mechanical thunk");
		expect(item?.postExamineDescription).toContain("locked in its on position");
		expect(item?.postLookFlavor).toContain("amber pinpoint");
	});

	it("throws ContentPackError when examineDescription has no verb-of-activation or control-noun cue", () => {
		const result = validateContentPacks(
			buildInterestingResponse({
				examineDescription:
					"A small porcelain figurine, chipped along one edge but otherwise intact.",
			}),
			inputWithInteresting,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "examineDescription");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("verb-of-activation");
			expect(error?.entityId).toBe("item1");
			expect(error?.retryUnit.kind).toBe("interesting-object");
		}
		expect(() =>
			validateContentPacksOrThrow(
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
			validateContentPacksOrThrow(
				buildInterestingResponse({ activationFlavor: undefined }),
				inputWithInteresting,
			),
		).toThrow(/activationFlavor/);
	});

	it("rejects an empty activationFlavor", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildInterestingResponse({ activationFlavor: "" }),
				inputWithInteresting,
			),
		).toThrow(/activationFlavor/);
	});

	it("throws ContentPackError when an interesting_object activationFlavor contains {actor}", () => {
		const result = validateContentPacks(
			buildInterestingResponse({
				activationFlavor: "{actor} flips the switch home.",
			}),
			inputWithInteresting,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "activationFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("item1");
			expect(error?.retryUnit.kind).toBe("interesting-object");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildInterestingResponse({
					activationFlavor: "{actor} flips the switch home.",
				}),
				inputWithInteresting,
			),
		).toThrow(/activationFlavor/);
	});

	it("rejects a missing postExamineDescription", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildInterestingResponse({ postExamineDescription: undefined }),
				inputWithInteresting,
			),
		).toThrow(/postExamineDescription/);
	});

	it("throws ContentPackError when a postExamineDescription contains {actor}", () => {
		const result = validateContentPacks(
			buildInterestingResponse({
				postExamineDescription: "{actor} sees the switch locked on.",
			}),
			inputWithInteresting,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find(
				(e) => e.field === "postExamineDescription",
			);
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("item1");
			expect(error?.retryUnit.kind).toBe("interesting-object");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildInterestingResponse({
					postExamineDescription: "{actor} sees the switch locked on.",
				}),
				inputWithInteresting,
			),
		).toThrow(/postExamineDescription/);
	});

	it("throws ContentPackError when a postLookFlavor contains {actor}", () => {
		const result = validateContentPacks(
			buildInterestingResponse({
				postLookFlavor: "{actor} glances at the amber light",
			}),
			inputWithInteresting,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "postLookFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("item1");
			expect(error?.retryUnit.kind).toBe("interesting-object");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildInterestingResponse({
					postLookFlavor: "{actor} glances at the amber light",
				}),
				inputWithInteresting,
			),
		).toThrow(/postLookFlavor/);
	});

	it("accepts an interesting_object with postLookFlavor omitted (optional)", () => {
		const result = validateContentPacksOrThrow(
			buildInterestingResponse({ postLookFlavor: undefined }),
			inputWithInteresting,
		);
		const item = result.packs[0]?.interestingObjects[0];
		expect(item?.activationFlavor).toBeDefined();
		expect(item?.postLookFlavor).toBeUndefined();
	});
});

// ── activationFlavor + use-tell validation on objective_space (issue #335) ────

describe("validateContentPacks — objective_space activationFlavor & prose tell", () => {
	const inputWithPair = {
		phases: [
			{
				setting: "abandoned subway station",
				theme: "mundane",
				k: 1,
				n: 0,
				m: 0,
			},
		],
	};

	function buildPackWithSpaceFields(
		spaceFields: Record<string, unknown>,
	): unknown {
		return {
			packs: [
				{
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
							space: {
								id: "space1",
								kind: "objective_space",
								name: "Brass Pedestal",
								convergenceTier1Flavor: "A lone figure stands at the pedestal.",
								convergenceTier2Flavor: "Two figures converge at the pedestal.",
								convergenceTier1ActorFlavor:
									"You linger at the pedestal; the place feels poised for company.",
								convergenceTier2ActorFlavor:
									"You share the pedestal with another presence.",
								...spaceFields,
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

	it("accepts a content pack with a use-tell in the space's examineDescription and a valid activationFlavor", () => {
		const result = validateContentPacksOrThrow(
			buildPackWithSpaceFields({
				examineDescription:
					"A sturdy pedestal. Press an item onto it to activate the mechanism.",
				activationFlavor: "The pedestal hums to life and its runes glow.",
			}),
			inputWithPair,
		);
		const space = result.packs[0]?.objectivePairs[0]?.space;
		expect(space?.activationFlavor).toBe(
			"The pedestal hums to life and its runes glow.",
		);
	});

	it("warns but does not throw when objective_space examineDescription has no use/activation cue", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacksOrThrow(
					buildPackWithSpaceFields({
						examineDescription:
							"A sturdy pedestal carved from weathered brass, half-buried in moss.",
						activationFlavor: "The pedestal hums to life.",
					}),
					inputWithPair,
				),
			/use\/activation cue/,
		);
	});

	it("rejects a content pack whose objective_space is missing activationFlavor", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildPackWithSpaceFields({
					examineDescription:
						"A sturdy pedestal. Press an item onto it to activate.",
				}),
				inputWithPair,
			),
		).toThrow(/activationFlavor/);
	});

	it("rejects a content pack whose objective_space activationFlavor is empty", () => {
		expect(() =>
			validateContentPacksOrThrow(
				buildPackWithSpaceFields({
					examineDescription:
						"A sturdy pedestal. Press an item onto it to activate.",
					activationFlavor: "",
				}),
				inputWithPair,
			),
		).toThrow(/activationFlavor/);
	});

	it("throws ContentPackError when an objective_space activationFlavor contains {actor}", () => {
		const result = validateContentPacks(
			buildPackWithSpaceFields({
				examineDescription:
					"A sturdy pedestal. Press an item onto it to activate.",
				activationFlavor: "{actor} activates the pedestal.",
			}),
			inputWithPair,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "activationFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.entityId).toBe("space1");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() =>
			validateContentPacksOrThrow(
				buildPackWithSpaceFields({
					examineDescription:
						"A sturdy pedestal. Press an item onto it to activate.",
					activationFlavor: "{actor} activates the pedestal.",
				}),
				inputWithPair,
			),
		).toThrow(/activationFlavor/);
	});
});

// ── Prompt rules (issue #335) ─────────────────────────────────────────────────

describe("CONTENT_PACK_SYSTEM_PROMPT — issue #335 rules", () => {
	it("describes activationFlavor as a field on objective_space", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(/activationFlavor/);
	});

	it("requires the objective_space prose tell at MUST strength", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/objective_space[\s\S]*examineDescription[\s\S]*MUST/i,
		);
	});

	it("forbids {actor} in activationFlavor at MUST strength", () => {
		expect(CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/activationFlavor[\s\S]*MUST NOT contain[\s\S]*\{actor\}/i,
		);
	});
});

describe("DUAL_CONTENT_PACK_SYSTEM_PROMPT — issue #335 rules", () => {
	it("describes activationFlavor as a field on objective_space", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(/activationFlavor/);
	});

	it("includes activationFlavor in the MUST-differ delta list", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/MUST differ[\s\S]*activationFlavor/,
		);
	});

	it("requires the objective_space prose tell at MUST strength", () => {
		expect(DUAL_CONTENT_PACK_SYSTEM_PROMPT).toMatch(
			/objective_space[\s\S]*examineDescription[\s\S]*MUST/i,
		);
	});
});

// ── Dual-pack validator: activationFlavor parity & per-pack validation ────────

describe("validateDualContentPacks — objective_space activationFlavor", () => {
	const dualInput = {
		phases: [
			{
				settingA: "abandoned subway station",
				settingB: "sun-baked salt flat",
				theme: "mundane",
				k: 1,
				n: 0,
				m: 0,
			},
		],
	};

	function buildDualPair(
		packAActivation: string,
		packBActivation: string,
		packAExamine = "A sturdy pedestal. Press an item onto it to activate.",
		packBExamine = "A weathered marker. Press the cap to activate it.",
	): unknown {
		const landmarks = {
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
		};
		const mkPack = (
			setting: string,
			objName: string,
			spaceName: string,
			examine: string,
			activation: string,
		) => ({
			setting,
			objectivePairs: [
				{
					object: {
						id: "obj1",
						kind: "objective_object",
						name: objName,
						examineDescription: `An object. It belongs on the ${spaceName.toLowerCase()}.`,
						useOutcome: "You turn it over in your hands.",
						pairsWithSpaceId: "space1",
						placementFlavor: `{actor} sets it on the ${spaceName.toLowerCase()}.`,
						proximityFlavor: "It hums faintly nearby.",
					},
					space: {
						id: "space1",
						kind: "objective_space",
						name: spaceName,
						examineDescription: examine,
						activationFlavor: activation,
						convergenceTier1Flavor: `A lone figure stands at the ${spaceName.toLowerCase()}.`,
						convergenceTier2Flavor: `Two figures converge at the ${spaceName.toLowerCase()}.`,
						convergenceTier1ActorFlavor: `You linger at the ${spaceName.toLowerCase()}.`,
						convergenceTier2ActorFlavor: `You share the ${spaceName.toLowerCase()} with another presence.`,
					},
				},
			],
			interestingObjects: [],
			obstacles: [],
			landmarks,
		});
		return {
			phases: [
				{
					packA: mkPack(
						"abandoned subway station",
						"Iron Key",
						"Brass Pedestal",
						packAExamine,
						packAActivation,
					),
					packB: mkPack(
						"sun-baked salt flat",
						"Bone Token",
						"Survey Marker",
						packBExamine,
						packBActivation,
					),
				},
			],
		};
	}

	it("accepts both packs with distinct activationFlavor lines", () => {
		const result = validateDualContentPacksOrThrow(
			buildDualPair(
				"The pedestal hums to life and its runes glow.",
				"The marker clicks once and a column of dust spirals up.",
			),
			dualInput,
		);
		const packA = result.phases[0]?.packA.objectivePairs[0]?.space;
		const packB = result.phases[0]?.packB.objectivePairs[0]?.space;
		expect(packA?.activationFlavor).toBe(
			"The pedestal hums to life and its runes glow.",
		);
		expect(packB?.activationFlavor).toBe(
			"The marker clicks once and a column of dust spirals up.",
		);
	});

	it("throws ContentPackError when packB activationFlavor contains {actor}", () => {
		const result = validateDualContentPacks(
			buildDualPair(
				"The pedestal hums to life.",
				"{actor} activates the marker.",
			),
			dualInput,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "activationFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.retryUnit.kind).toBe("objective-pair");
		}
		expect(() =>
			validateDualContentPacksOrThrow(
				buildDualPair(
					"The pedestal hums to life.",
					"{actor} activates the marker.",
				),
				dualInput,
			),
		).toThrow(/activationFlavor/);
	});

	it("warns but does not throw when packA space examineDescription has no use-tell", () => {
		expectWarnNotThrow(
			() =>
				validateDualContentPacksOrThrow(
					buildDualPair(
						"The pedestal hums to life.",
						"The marker clicks once.",
						"A sturdy pedestal carved from weathered brass.",
					),
					dualInput,
				),
			/use\/activation cue/,
		);
	});
});

// ── shiftFlavor validation for dual-pack obstacles (issue #337) ──────────────

describe("validateDualContentPacks — obstacle shiftFlavor validation", () => {
	const dualInputWithObstacle = {
		phases: [
			{
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
		const result = validateDualContentPacksOrThrow(
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
			validateDualContentPacksOrThrow(
				buildDualObstacleResponse(undefined, "Something rustles."),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("rejects a dual-pack obstacle missing shiftFlavor on packB", () => {
		expect(() =>
			validateDualContentPacksOrThrow(
				buildDualObstacleResponse("The gate scrapes.", undefined),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("rejects a dual-pack obstacle with an empty shiftFlavor", () => {
		expect(() =>
			validateDualContentPacksOrThrow(
				buildDualObstacleResponse("", "Something rustles."),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});

	it("throws ContentPackError when a dual-pack obstacle shiftFlavor contains {actor}", () => {
		const result = validateDualContentPacks(
			buildDualObstacleResponse(
				"{actor} pushes the gate.",
				"Something rustles.",
			),
			dualInputWithObstacle,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.errors.find((e) => e.field === "shiftFlavor");
			expect(error).toBeDefined();
			expect(error?.rule).toBe("actor-exclusion");
			expect(error?.retryUnit.kind).toBe("obstacle");
		}
		expect(() =>
			validateDualContentPacksOrThrow(
				buildDualObstacleResponse(
					"{actor} pushes the gate.",
					"Something rustles.",
				),
				dualInputWithObstacle,
			),
		).toThrow(/shiftFlavor/);
	});
});

// ── Pure-result API: validateContentPacks with multiple failures ────────────────

describe("validateContentPacks — pure-result API with multiple failures", () => {
	const input = {
		phases: [
			{
				setting: "abandoned subway station",
				theme: "mundane",
				k: 0,
				n: 1,
				m: 1,
			},
		],
	};

	function buildFixtureWithMultipleErrors(): unknown {
		return {
			packs: [
				{
					setting: "abandoned subway station",
					objectivePairs: [],
					interestingObjects: [
						{
							id: "item1",
							kind: "interesting_object",
							name: "Brass Switch",
							examineDescription:
								"A small brass switch mounted on a panel. It looks like it should be pressed.",
							useOutcome: "The switch clicks under your finger.",
							// Missing activationFlavor — this is the first error
							postExamineDescription:
								"The switch sits locked in its on position.",
							postLookFlavor:
								"an amber pinpoint of light glows beside the panel",
						},
					],
					obstacles: [
						{
							id: "obs1",
							kind: "obstacle",
							name: "Rusted Gate",
							examineDescription: "An old rusted gate blocking the path.",
							// Missing shiftFlavor — this is the second error
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

	it("surfaces multiple validation errors in one pass (pure-result API)", () => {
		const result = validateContentPacks(
			buildFixtureWithMultipleErrors(),
			input,
		);

		// Assert that the result is a failure (ok === false)
		expect(result.ok).toBe(false);

		if (!result.ok) {
			// Assert that we got at least two errors
			expect(result.errors.length).toBeGreaterThanOrEqual(2);

			// Extract the two errors and verify they are for different entities
			const activationFlavorError = result.errors.find(
				(err) => err.field === "activationFlavor",
			);
			const shiftFlavorError = result.errors.find(
				(err) => err.field === "shiftFlavor",
			);

			expect(activationFlavorError).toBeDefined();
			expect(shiftFlavorError).toBeDefined();

			// Verify that they target different retry units (kinds)
			expect(activationFlavorError?.retryUnit.kind).toBe("interesting-object");
			expect(shiftFlavorError?.retryUnit.kind).toBe("obstacle");

			// Verify that the entity IDs are different (item1 vs obs1)
			expect(activationFlavorError?.entityId).toBe("item1");
			expect(shiftFlavorError?.entityId).toBe("obs1");
		}
	});
});

// ── Helper for batching repairs into partial-retry response ────────────────────

function buildBatchedRepair(repairs: ContentPackRepair[]): string {
	return JSON.stringify({ repairs });
}

// ── BrowserContentPackProvider — partial-retry layer ─────────────────────────

describe("BrowserContentPackProvider — partial-retry layer", () => {
	const baseInput = {
		phases: [
			{
				setting: "abandoned subway station",
				theme: "mundane",
				k: 1,
				n: 1,
				m: 1,
			},
		],
	};

	/** Build a valid baseline pack for comparison. */
	function buildValidPack(): unknown {
		return {
			packs: [
				{
					setting: "abandoned subway station",
					objectivePairs: [
						{
							object: {
								id: "obj1",
								kind: "objective_object",
								name: "Iron Key",
								examineDescription:
									"An iron key. It looks like it belongs on the brass pedestal.",
								useOutcome: "You turn the key over in your hands.",
								pairsWithSpaceId: "space1",
								placementFlavor: "{actor} sets the key on its mount.",
								proximityFlavor: "The key hums faintly near the pedestal.",
							},
							space: {
								id: "space1",
								kind: "objective_space",
								name: "Brass Pedestal",
								examineDescription:
									"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
								activationFlavor:
									"The pedestal hums to life and its surface flushes with warmth.",
								satisfactionFlavor:
									"The pedestal glows brightly as the objective completes.",
								postExamineDescription:
									"The pedestal glows softly after activation.",
								postLookFlavor: "the pedestal hums with residual warmth.",
								convergenceTier1Flavor: "A lone figure stands at the pedestal.",
								convergenceTier2Flavor: "Two figures converge at the pedestal.",
								convergenceTier1ActorFlavor:
									"You linger at the pedestal; the place feels poised for company.",
								convergenceTier2ActorFlavor:
									"You share the pedestal with another presence; the runes thrum.",
							},
						},
					],
					interestingObjects: [
						{
							id: "item1",
							kind: "interesting_object",
							name: "Brass Switch",
							examineDescription:
								"A small brass switch mounted on a panel. It looks like it should be pressed.",
							useOutcome: "The switch clicks under your finger.",
							activationFlavor: "The switch snaps loudly into place.",
							postExamineDescription:
								"The switch sits locked in its on position.",
							postLookFlavor:
								"an amber pinpoint of light glows beside the panel.",
						},
					],
					obstacles: [
						{
							id: "obs1",
							kind: "obstacle",
							name: "Rusted Gate",
							examineDescription: "An old rusted gate blocking the path.",
							shiftFlavor:
								"The rusted gate scrapes along the floor with a grinding shriek.",
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
					wallName: "concrete barrier",
				},
			],
		};
	}

	it("Test 1 — Single objective-pair failure repaired in round 1", async () => {
		const mockChatFn = vi.fn();

		// Call 1: broken pack (missing examineDescription on space)
		const brokenPack = buildValidPack();
		const brokenPackPacks = (brokenPack as Record<string, unknown>).packs as
			| Record<string, unknown>[]
			| undefined;
		if (brokenPackPacks?.[0]) {
			const pairs = (brokenPackPacks[0] as Record<string, unknown>)
				.objectivePairs as Record<string, unknown>[] | undefined;
			if (pairs?.[0]) {
				const pair = pairs[0] as Record<string, unknown>;
				const space = pair.space as Record<string, unknown>;
				delete space.examineDescription;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		// Call 2: repair response with valid space
		const repair: ContentPackRepair = {
			unitKind: "objective-pair",
			phaseIndex: 0,
			object: {
				id: "obj1",
				kind: "objective_object",
				name: "Iron Key",
				examineDescription:
					"An iron key. It looks like it belongs on the brass pedestal.",
				useOutcome: "You turn the key over in your hands.",
				pairsWithSpaceId: "space1",
				placementFlavor: "{actor} sets the key on its mount.",
				proximityFlavor: "The key hums faintly near the pedestal.",
			},
			space: {
				id: "space1",
				kind: "objective_space",
				name: "Brass Pedestal",
				examineDescription:
					"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
				activationFlavor:
					"The pedestal hums to life and its surface flushes with warmth.",
				satisfactionFlavor:
					"The pedestal glows brightly as the objective completes.",
				postExamineDescription: "The pedestal glows softly after activation.",
				postLookFlavor: "the pedestal hums with residual warmth.",
				convergenceTier1Flavor: "A lone figure stands at the pedestal.",
				convergenceTier2Flavor: "Two figures converge at the pedestal.",
				convergenceTier1ActorFlavor:
					"You linger at the pedestal; the place feels poised for company.",
				convergenceTier2ActorFlavor:
					"You share the pedestal with another presence; the runes thrum.",
			},
		};
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([repair]),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.packs[0]?.objectivePairs[0]?.space.examineDescription).toBe(
			"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
		);

		// Assert call 2's messages contain PARTIAL_RETRY_SYSTEM_PROMPT
		const call2Messages = mockChatFn.mock.calls[1]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call2Messages?.[0]?.content).toBe(PARTIAL_RETRY_SYSTEM_PROMPT);
	});

	it("Test 2 — Two failing retry-units (pair + interesting-object) → round 1 succeeds", async () => {
		const mockChatFn = vi.fn();

		// Call 1: broken pack (missing examineDescription on space and item)
		const brokenPack = buildValidPack();
		const brokenPackPacks = (brokenPack as Record<string, unknown>).packs as
			| Record<string, unknown>[]
			| undefined;
		if (brokenPackPacks?.[0]) {
			const pack = brokenPackPacks[0] as Record<string, unknown>;
			const pairs = pack.objectivePairs as
				| Record<string, unknown>[]
				| undefined;
			if (pairs?.[0]) {
				const pair = pairs[0] as Record<string, unknown>;
				const space = pair.space as Record<string, unknown>;
				delete space.examineDescription;
			}
			const items = pack.interestingObjects as
				| Record<string, unknown>[]
				| undefined;
			if (items?.[0]) {
				delete (items[0] as Record<string, unknown>).useOutcome;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		// Call 2: batched repair with TWO entries
		const repairs: ContentPackRepair[] = [
			{
				unitKind: "objective-pair",
				phaseIndex: 0,
				object: {
					id: "obj1",
					kind: "objective_object",
					name: "Iron Key",
					examineDescription:
						"An iron key. It looks like it belongs on the brass pedestal.",
					useOutcome: "You turn the key over in your hands.",
					pairsWithSpaceId: "space1",
					placementFlavor: "{actor} sets the key on its mount.",
					proximityFlavor: "The key hums faintly near the pedestal.",
				},
				space: {
					id: "space1",
					kind: "objective_space",
					name: "Brass Pedestal",
					examineDescription:
						"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
					activationFlavor:
						"The pedestal hums to life and its surface flushes with warmth.",
					satisfactionFlavor:
						"The pedestal glows brightly as the objective completes.",
					postExamineDescription: "The pedestal glows softly after activation.",
					postLookFlavor: "the pedestal hums with residual warmth.",
					convergenceTier1Flavor: "A lone figure stands at the pedestal.",
					convergenceTier2Flavor: "Two figures converge at the pedestal.",
					convergenceTier1ActorFlavor:
						"You linger at the pedestal; the place feels poised for company.",
					convergenceTier2ActorFlavor:
						"You share the pedestal with another presence; the runes thrum.",
				},
			},
			{
				unitKind: "interesting-object",
				phaseIndex: 0,
				entity: {
					id: "item1",
					kind: "interesting_object",
					name: "Brass Switch",
					examineDescription:
						"A small brass switch mounted on a panel. It looks like it should be pressed.",
					useOutcome: "The switch clicks under your finger.",
					activationFlavor: "The switch snaps loudly into place.",
					postExamineDescription: "The switch sits locked in its on position.",
					postLookFlavor: "an amber pinpoint of light glows beside the panel.",
				},
			},
		];
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair(repairs),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.packs[0]?.objectivePairs[0]?.space.examineDescription).toBe(
			"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
		);
		expect(result.packs[0]?.interestingObjects[0]?.examineDescription).toBe(
			"A small brass switch mounted on a panel. It looks like it should be pressed.",
		);
	});

	it("Test 3 — Round 1 still invalid → round 2 succeeds", async () => {
		const mockChatFn = vi.fn();

		// Call 1: broken pack (missing examineDescription on space)
		const brokenPack = buildValidPack();
		const brokenPackPacks = (brokenPack as Record<string, unknown>).packs as
			| Record<string, unknown>[]
			| undefined;
		if (brokenPackPacks?.[0]) {
			const pair = (
				(brokenPackPacks[0] as Record<string, unknown>)
					.objectivePairs as Record<string, unknown>[]
			)[0];
			if (pair) {
				const space = pair.space as Record<string, unknown>;
				delete space.examineDescription;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		// Call 2: repair that still leaves it broken (omits useOutcome)
		const stillBrokenRepair: ContentPackRepair = {
			unitKind: "objective-pair",
			phaseIndex: 0,
			object: {
				id: "obj1",
				kind: "objective_object",
				name: "Iron Key",
				examineDescription:
					"An iron key. It looks like it belongs on the brass pedestal.",
				// useOutcome intentionally omitted — still broken
				pairsWithSpaceId: "space1",
				placementFlavor: "{actor} sets the key on its mount.",
				proximityFlavor: "The key hums faintly near the pedestal.",
			} as Record<string, unknown>,
			space: {
				id: "space1",
				kind: "objective_space",
				name: "Brass Pedestal",
				examineDescription:
					"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
				activationFlavor:
					"The pedestal hums to life and its surface flushes with warmth.",
				satisfactionFlavor:
					"The pedestal glows brightly as the objective completes.",
				postExamineDescription: "The pedestal glows softly after activation.",
				postLookFlavor: "the pedestal hums with residual warmth.",
				convergenceTier1Flavor: "A lone figure stands at the pedestal.",
				convergenceTier2Flavor: "Two figures converge at the pedestal.",
				convergenceTier1ActorFlavor:
					"You linger at the pedestal; the place feels poised for company.",
				convergenceTier2ActorFlavor:
					"You share the pedestal with another presence; the runes thrum.",
			},
		};
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([stillBrokenRepair]),
			reasoning: null,
		});

		// Call 3: fully valid repair
		const validRepair: ContentPackRepair = {
			unitKind: "objective-pair",
			phaseIndex: 0,
			object: {
				id: "obj1",
				kind: "objective_object",
				name: "Iron Key",
				examineDescription:
					"An iron key. It looks like it belongs on the brass pedestal.",
				useOutcome: "You turn the key over in your hands.",
				pairsWithSpaceId: "space1",
				placementFlavor: "{actor} sets the key on its mount.",
				proximityFlavor: "The key hums faintly near the pedestal.",
			},
			space: {
				id: "space1",
				kind: "objective_space",
				name: "Brass Pedestal",
				examineDescription:
					"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
				activationFlavor:
					"The pedestal hums to life and its surface flushes with warmth.",
				satisfactionFlavor:
					"The pedestal glows brightly as the objective completes.",
				postExamineDescription: "The pedestal glows softly after activation.",
				postLookFlavor: "the pedestal hums with residual warmth.",
				convergenceTier1Flavor: "A lone figure stands at the pedestal.",
				convergenceTier2Flavor: "Two figures converge at the pedestal.",
				convergenceTier1ActorFlavor:
					"You linger at the pedestal; the place feels poised for company.",
				convergenceTier2ActorFlavor:
					"You share the pedestal with another presence; the runes thrum.",
			},
		};
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([validRepair]),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(3);
		expect(result.packs[0]?.objectivePairs[0]?.object.useOutcome).toBe(
			"You turn the key over in your hands.",
		);
	});

	it("Test 4 — Both partial rounds fail → outer retry with corrective feedback → succeeds", async () => {
		const mockChatFn = vi.fn();

		// Call 1: broken pack (missing examineDescription)
		const brokenPack1 = buildValidPack();
		const brokenPacks1 = (brokenPack1 as Record<string, unknown>).packs as
			| Record<string, unknown>[]
			| undefined;
		if (brokenPacks1?.[0]) {
			const pair = (
				(brokenPacks1[0] as Record<string, unknown>).objectivePairs as Record<
					string,
					unknown
				>[]
			)[0];
			if (pair) {
				const space = pair.space as Record<string, unknown>;
				delete space.examineDescription;
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack1),
			reasoning: null,
		});

		// Call 2: repair that is still broken (misses activationFlavor)
		const stillBrokenRepair: ContentPackRepair = {
			unitKind: "objective-pair",
			phaseIndex: 0,
			object: {
				id: "obj1",
				kind: "objective_object",
				name: "Iron Key",
				examineDescription:
					"An iron key. It looks like it belongs on the brass pedestal.",
				useOutcome: "You turn the key over in your hands.",
				pairsWithSpaceId: "space1",
				placementFlavor: "{actor} sets the key on its mount.",
				proximityFlavor: "The key hums faintly near the pedestal.",
			},
			space: {
				id: "space1",
				kind: "objective_space",
				name: "Brass Pedestal",
				examineDescription:
					"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
				// activationFlavor intentionally omitted
				satisfactionFlavor:
					"The pedestal glows brightly as the objective completes.",
				postExamineDescription: "The pedestal glows softly after activation.",
				postLookFlavor: "the pedestal hums with residual warmth.",
				convergenceTier1Flavor: "A lone figure stands at the pedestal.",
				convergenceTier2Flavor: "Two figures converge at the pedestal.",
				convergenceTier1ActorFlavor:
					"You linger at the pedestal; the place feels poised for company.",
				convergenceTier2ActorFlavor:
					"You share the pedestal with another presence; the runes thrum.",
			} as Record<string, unknown>,
		};
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([stillBrokenRepair]),
			reasoning: null,
		});

		// Call 3: still broken repair (same as call 2)
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([stillBrokenRepair]),
			reasoning: null,
		});

		// Call 4: full pack with corrective feedback succeeds
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(4);

		// Assert call 4's messages include corrective feedback
		const call4Messages = mockChatFn.mock.calls[3]?.[0]?.messages as
			| Array<{ role: string; content: string }>
			| undefined;
		expect(call4Messages).toBeDefined();
		const correctionTurn = call4Messages?.find((msg) =>
			msg.content.includes("Your previous attempt failed validation"),
		);
		expect(correctionTurn).toBeDefined();

		expect(result.packs[0]?.objectivePairs[0]?.space.activationFlavor).toBe(
			"The pedestal hums to life and its surface flushes with warmth.",
		);
	});

	it("Test 5 — JSON parse failure on initial response → backoff → succeeds", async () => {
		vi.useFakeTimers();

		const mockChatFn = vi.fn();

		// Call 1: invalid JSON response
		mockChatFn.mockResolvedValueOnce({
			content: "{not valid json",
			reasoning: null,
		});

		// Call 2: valid response after backoff
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(buildValidPack()),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const promise = provider.generateContentPacks(baseInput);

		// Wait for the first call to complete
		await vi.waitFor(() => expect(mockChatFn).toHaveBeenCalledTimes(1));

		// Advance timers by the backoff duration (BACKOFF_MS[0] = 1000)
		await vi.advanceTimersByTimeAsync(1000);

		// Now await the promise resolution
		const result = await promise;

		vi.useRealTimers();

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.packs[0]?.objectivePairs[0]?.object.name).toBe("Iron Key");
	});

	it("Test 6 — CapHitError short-circuits", async () => {
		const mockChatFn = vi.fn();

		// Call 1: throw CapHitError
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

	it("Test 7 — {actor} drift in convergenceTier1Flavor → repaired in round 1 (2 chatFn calls)", async () => {
		const mockChatFn = vi.fn();

		// Call 1: broken pack ({actor} in convergenceTier1Flavor)
		const brokenPack = buildValidPack();
		const brokenPackPacks = (brokenPack as Record<string, unknown>).packs as
			| Record<string, unknown>[]
			| undefined;
		if (brokenPackPacks?.[0]) {
			const pair = (
				(brokenPackPacks[0] as Record<string, unknown>)
					.objectivePairs as Record<string, unknown>[]
			)[0];
			if (pair) {
				const space = pair.space as Record<string, unknown>;
				space.convergenceTier1Flavor = "{actor} stands at the pedestal.";
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		// Call 2: repair response with valid convergenceTier1Flavor (no {actor})
		const repair: ContentPackRepair = {
			unitKind: "objective-pair",
			phaseIndex: 0,
			object: {
				id: "obj1",
				kind: "objective_object",
				name: "Iron Key",
				examineDescription:
					"An iron key. It looks like it belongs on the brass pedestal.",
				useOutcome: "You turn the key over in your hands.",
				pairsWithSpaceId: "space1",
				placementFlavor: "{actor} sets the key on its mount.",
				proximityFlavor: "The key hums faintly near the pedestal.",
			},
			space: {
				id: "space1",
				kind: "objective_space",
				name: "Brass Pedestal",
				examineDescription:
					"A sturdy brass mount. Press an item onto it to activate the mechanism; the space awaits a shared presence.",
				activationFlavor:
					"The pedestal hums to life and its surface flushes with warmth.",
				satisfactionFlavor:
					"The pedestal glows brightly as the objective completes.",
				postExamineDescription: "The pedestal glows softly after activation.",
				postLookFlavor: "the pedestal hums with residual warmth.",
				convergenceTier1Flavor: "A lone figure stands at the pedestal.",
				convergenceTier2Flavor: "Two figures converge at the pedestal.",
				convergenceTier1ActorFlavor:
					"You linger at the pedestal; the place feels poised for company.",
				convergenceTier2ActorFlavor:
					"You share the pedestal with another presence; the runes thrum.",
			},
		};
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([repair]),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(
			result.packs[0]?.objectivePairs[0]?.space.convergenceTier1Flavor,
		).toBe("A lone figure stands at the pedestal.");
		expect(
			result.packs[0]?.objectivePairs[0]?.space.convergenceTier1Flavor,
		).not.toMatch(/{actor}/);
	});

	it("Test 7 — verb-of-activation cue missing in interesting_object examineDescription → repaired in round 1 (2 chatFn calls)", async () => {
		const mockChatFn = vi.fn();

		// Call 1: broken pack (no verb-of-activation cue in examineDescription)
		const brokenPack = buildValidPack();
		const brokenPackPacks = (brokenPack as Record<string, unknown>).packs as
			| Record<string, unknown>[]
			| undefined;
		if (brokenPackPacks?.[0]) {
			const pack = brokenPackPacks[0] as Record<string, unknown>;
			const items = pack.interestingObjects as
				| Record<string, unknown>[]
				| undefined;
			if (items?.[0]) {
				(items[0] as Record<string, unknown>).examineDescription =
					"A small porcelain figurine, chipped along one edge but otherwise intact.";
			}
		}
		mockChatFn.mockResolvedValueOnce({
			content: JSON.stringify(brokenPack),
			reasoning: null,
		});

		// Call 2: repair response with valid examineDescription (has verb-of-activation cue)
		const repair: ContentPackRepair = {
			unitKind: "interesting-object",
			phaseIndex: 0,
			entity: {
				id: "item1",
				kind: "interesting_object",
				name: "Brass Switch",
				examineDescription:
					"A small brass switch mounted on a panel. It looks like it should be pressed.",
				useOutcome: "The switch clicks under your finger.",
				activationFlavor: "The switch snaps loudly into place.",
				postExamineDescription: "The switch sits locked in its on position.",
				postLookFlavor: "an amber pinpoint of light glows beside the panel.",
			},
		};
		mockChatFn.mockResolvedValueOnce({
			content: buildBatchedRepair([repair]),
			reasoning: null,
		});

		const provider = new BrowserContentPackProvider({ chatFn: mockChatFn });
		const result = await provider.generateContentPacks(baseInput);

		expect(mockChatFn).toHaveBeenCalledTimes(2);
		expect(result.packs[0]?.interestingObjects[0]?.examineDescription).toBe(
			"A small brass switch mounted on a panel. It looks like it should be pressed.",
		);
		expect(
			result.packs[0]?.interestingObjects[0]?.examineDescription,
		).not.toMatch(/porcelain figurine/);
	});
});
