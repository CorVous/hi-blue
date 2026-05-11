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
							},
							space: {
								id: "space1",
								kind: "objective_space",
								name: spaceName,
								examineDescription: "A sturdy mount for a small relic.",
							},
						},
					],
					interestingObjects: [],
					obstacles: [],
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

	it("exposes the prose-tell omission via examineMentionsPairedSpace on a validated pack", () => {
		// Today the validator accepts this — it is the very gap issue #253 documents.
		// The helper, however, must flag it, so a future #248-style validator-side
		// retry has a single source of truth to call.
		const result = validateContentPacks(
			buildResponse(
				"rusted iron key, heavily corroded but still intact. The teeth are worn smooth from use",
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
		).toBe(false);
	});
});
