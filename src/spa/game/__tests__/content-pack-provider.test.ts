/**
 * Tests for content-pack prose-tell rule and helpers.
 *
 * Issue #253: examineDescription of each objective_object MUST name its paired
 * objective_space — that prose tell is the only AI-discoverable channel for the
 * pairing (objective_spaces are filtered out of the cone projection in
 * prompt-builder.ts:481, so the pairsWithSpaceId field is invisible to daemons).
 */

import { describe, expect, it, vi } from "vitest";
import {
	CONTENT_PACK_SYSTEM_PROMPT,
	DUAL_CONTENT_PACK_SYSTEM_PROMPT,
	examineMentionsPairedSpace,
	examineMentionsUseTell,
	validateContentPacks,
	validateDualContentPacks,
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

	it("warns but does not throw when objective_object examine does not mention the paired space", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
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

	it("warns but does not throw when an obstacle shiftFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildObstacleResponse("{actor} knocks the gate aside."),
					inputWithObstacle,
				),
			/shiftFlavor/,
		);
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
				buildConvergenceResponse(OMIT, "Two figures converge at the pedestal."),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	it("throws ContentPackError when convergenceTier2Flavor is missing", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse("A lone figure stands at the pedestal.", OMIT),
				inputWithPair,
			),
		).toThrow(/convergenceTier2Flavor/);
	});

	it("warns but does not throw when convergenceTier1Flavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildConvergenceResponse(
						"{actor} stands at the pedestal.",
						"Two figures converge at the pedestal.",
					),
					inputWithPair,
				),
			/convergenceTier1Flavor/,
		);
	});

	it("warns but does not throw when convergenceTier2Flavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildConvergenceResponse(
						"A lone figure stands at the pedestal.",
						"{actor} and another figure converge.",
					),
					inputWithPair,
				),
			/convergenceTier2Flavor/,
		);
	});

	it("throws ContentPackError when convergenceTier1Flavor is an empty string", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse("", "Two figures converge at the pedestal."),
				inputWithPair,
			),
		).toThrow(/convergenceTier1Flavor/);
	});

	// ── actor-side tier flavors (issue #336) ────────────────────────────────────

	it("accepts a pack with all four tier flavors and persists the actor variants", () => {
		const result = validateContentPacks(
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
			validateContentPacks(
				buildConvergenceResponse(undefined, undefined, OMIT),
				inputWithPair,
			),
		).toThrow(/convergenceTier1ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier2ActorFlavor is missing", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(undefined, undefined, undefined, OMIT),
				inputWithPair,
			),
		).toThrow(/convergenceTier2ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier1ActorFlavor is empty", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(undefined, undefined, ""),
				inputWithPair,
			),
		).toThrow(/convergenceTier1ActorFlavor/);
	});

	it("throws ContentPackError when convergenceTier2ActorFlavor is empty", () => {
		expect(() =>
			validateContentPacks(
				buildConvergenceResponse(undefined, undefined, undefined, ""),
				inputWithPair,
			),
		).toThrow(/convergenceTier2ActorFlavor/);
	});

	it("warns but does not throw when convergenceTier1ActorFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildConvergenceResponse(
						undefined,
						undefined,
						"{actor} stands alone at the pedestal.",
					),
					inputWithPair,
				),
			/convergenceTier1ActorFlavor/,
		);
	});

	it("warns but does not throw when convergenceTier2ActorFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildConvergenceResponse(
						undefined,
						undefined,
						undefined,
						"{actor} and another share the pedestal.",
					),
					inputWithPair,
				),
			/convergenceTier2ActorFlavor/,
		);
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
		const result = validateContentPacks(
			buildInterestingResponse({}),
			inputWithInteresting,
		);
		const item = result.packs[0]?.interestingObjects[0];
		expect(item?.activationFlavor).toContain("mechanical thunk");
		expect(item?.postExamineDescription).toContain("locked in its on position");
		expect(item?.postLookFlavor).toContain("amber pinpoint");
	});

	it("warns but does not throw when examineDescription has no verb-of-activation or control-noun cue", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildInterestingResponse({
						examineDescription:
							"A small porcelain figurine, chipped along one edge but otherwise intact.",
					}),
					inputWithInteresting,
				),
			/verb-of-activation cue|control noun/,
		);
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

	it("warns but does not throw when an interesting_object activationFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildInterestingResponse({
						activationFlavor: "{actor} flips the switch home.",
					}),
					inputWithInteresting,
				),
			/activationFlavor/,
		);
	});

	it("rejects a missing postExamineDescription", () => {
		expect(() =>
			validateContentPacks(
				buildInterestingResponse({ postExamineDescription: undefined }),
				inputWithInteresting,
			),
		).toThrow(/postExamineDescription/);
	});

	it("warns but does not throw when a postExamineDescription contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildInterestingResponse({
						postExamineDescription: "{actor} sees the switch locked on.",
					}),
					inputWithInteresting,
				),
			/postExamineDescription/,
		);
	});

	it("warns but does not throw when a postLookFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildInterestingResponse({
						postLookFlavor: "{actor} glances at the amber light",
					}),
					inputWithInteresting,
				),
			/postLookFlavor/,
		);
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
		const result = validateContentPacks(
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
				validateContentPacks(
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
			validateContentPacks(
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
			validateContentPacks(
				buildPackWithSpaceFields({
					examineDescription:
						"A sturdy pedestal. Press an item onto it to activate.",
					activationFlavor: "",
				}),
				inputWithPair,
			),
		).toThrow(/activationFlavor/);
	});

	it("warns but does not throw when an objective_space activationFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateContentPacks(
					buildPackWithSpaceFields({
						examineDescription:
							"A sturdy pedestal. Press an item onto it to activate.",
						activationFlavor: "{actor} activates the pedestal.",
					}),
					inputWithPair,
				),
			/activationFlavor/,
		);
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
		const result = validateDualContentPacks(
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

	it("warns but does not throw when packB activationFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateDualContentPacks(
					buildDualPair(
						"The pedestal hums to life.",
						"{actor} activates the marker.",
					),
					dualInput,
				),
			/activationFlavor/,
		);
	});

	it("warns but does not throw when packA space examineDescription has no use-tell", () => {
		expectWarnNotThrow(
			() =>
				validateDualContentPacks(
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

	it("warns but does not throw when a dual-pack obstacle shiftFlavor contains {actor}", () => {
		expectWarnNotThrow(
			() =>
				validateDualContentPacks(
					buildDualObstacleResponse(
						"{actor} pushes the gate.",
						"Something rustles.",
					),
					dualInputWithObstacle,
				),
			/shiftFlavor/,
		);
	});
});
