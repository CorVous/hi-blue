import { describe, expect, it } from "vitest";
import type { ValidationSchedule } from "../binding-aware-validator.js";
import { validateBoundDualContentPack } from "../binding-aware-validator.js";

function makeSchedule(
	overrides?: Partial<ValidationSchedule>,
): ValidationSchedule {
	return {
		skeletons: [],
		decoys: [{ id: "decoy-0" }, { id: "decoy-1" }],
		obstacleCount: 0,
		...overrides,
	};
}

function makeCarrySchedule(i = 0): ValidationSchedule {
	return makeSchedule({
		skeletons: [
			{
				type: "carry",
				objectId: `carry-${i}-obj`,
				spaceId: `carry-${i}-space`,
			},
		],
	});
}

function makeUseSpaceSchedule(i = 0): ValidationSchedule {
	return makeSchedule({
		skeletons: [{ type: "use_space", spaceId: `useSpace-${i}-space` }],
	});
}

function makeUseItemSchedule(i = 0): ValidationSchedule {
	return makeSchedule({
		skeletons: [{ type: "use_item", itemId: `useItem-${i}-item` }],
	});
}

function makeConvergenceSchedule(i = 0): ValidationSchedule {
	return makeSchedule({
		skeletons: [{ type: "convergence", spaceId: `convergence-${i}-space` }],
	});
}

function validateAsBothPacks(
	response: { pack: unknown },
	schedule: ValidationSchedule,
) {
	return validateBoundDualContentPack(
		{ phases: [{ packA: response.pack, packB: response.pack }] },
		schedule,
	);
}

function makeGoodDecoys() {
	return [
		{
			id: "decoy-0",
			name: "old coin",
			examineDescription: "A worn coin with a faded face.",
			proximityFlavor: "Something glints nearby.",
			useOutcome: "You flip it. Nothing happens.",
		},
		{
			id: "decoy-1",
			name: "crumpled note",
			examineDescription: "A scrap of paper covered in faded writing.",
			proximityFlavor: "Paper crinkles in the air.",
			useOutcome: "You unfold it carefully.",
		},
	];
}

function makeGoodCarryPack(i = 0) {
	return {
		pack: {
			setting: "lab",
			wallName: "wall",
			bindings: [
				{
					id: `carry-${i}`,
					type: "carry",
					object: {
						id: `carry-${i}-obj`,
						name: "test object",
						examineDescription: `Place it on the carry-${i}-space.`,
						useOutcome: "Nothing changes.",
						placementFlavor: "{actor} places it down.",
						proximityFlavor: "It feels warm.",
					},
					space: {
						id: `carry-${i}-space`,
						name: "test space",
						examineDescription: "A designated surface.",
						proximityFlavor: "Something draws you near.",
					},
				},
			],
			decoys: makeGoodDecoys(),
			obstacles: [],
		},
	};
}

function makeGoodUseSpacePack(i = 0) {
	return {
		pack: {
			setting: "lab",
			wallName: "wall",
			bindings: [
				{
					id: `useSpace-${i}`,
					type: "use_space",
					space: {
						id: `useSpace-${i}-space`,
						name: "control panel",
						examineDescription: "A panel with buttons and levers to activate.",
						proximityFlavor: "The panel hums faintly.",
						activationFlavor: "The panel lights up.",
						satisfactionFlavor: "The panel fires a burst of light.",
						postExamineDescription: "The panel is now active.",
						postLookFlavor: "The panel glows.",
					},
				},
			],
			decoys: makeGoodDecoys(),
			obstacles: [],
		},
	};
}

function makeGoodUseItemPack(i = 0) {
	return {
		pack: {
			setting: "lab",
			wallName: "wall",
			bindings: [
				{
					id: `useItem-${i}`,
					type: "use_item",
					item: {
						id: `useItem-${i}-item`,
						name: "strange device",
						examineDescription: "A device with a button on top.",
						proximityFlavor: "It emits a low hum.",
						useOutcome: "Nothing.",
						activationFlavor: "The device clicks.",
						postExamineDescription: "The device is now dark.",
						postLookFlavor: "It rests quietly.",
					},
				},
			],
			decoys: makeGoodDecoys(),
			obstacles: [],
		},
	};
}

function makeGoodConvergencePack(i = 0) {
	return {
		pack: {
			setting: "lab",
			wallName: "wall",
			bindings: [
				{
					id: `convergence-${i}`,
					type: "convergence",
					space: {
						id: `convergence-${i}-space`,
						name: "meeting point",
						examineDescription: "A convergence of pathways.",
						proximityFlavor: "The air feels charged.",
						convergenceTier1Flavor: "One figure stands here.",
						convergenceTier2Flavor: "Two figures share this space.",
						convergenceTier1ActorFlavor: "You feel the pull of convergence.",
						convergenceTier2ActorFlavor: "You share this space with another.",
					},
				},
			],
			decoys: makeGoodDecoys(),
			obstacles: [],
		},
	};
}

describe("validateBoundDualContentPack (same pack as A and B) — well-formed packs pass", () => {
	it("carry binding passes with correct fields", () => {
		const result = validateAsBothPacks(
			makeGoodCarryPack(),
			makeCarrySchedule(),
		);
		expect(result.ok).toBe(true);
	});

	it("use_space binding passes with correct fields", () => {
		const result = validateAsBothPacks(
			makeGoodUseSpacePack(),
			makeUseSpaceSchedule(),
		);
		expect(result.ok).toBe(true);
	});

	it("use_item binding passes with correct fields", () => {
		const result = validateAsBothPacks(
			makeGoodUseItemPack(),
			makeUseItemSchedule(),
		);
		expect(result.ok).toBe(true);
	});

	it("convergence binding passes with correct fields", () => {
		const result = validateAsBothPacks(
			makeGoodConvergencePack(),
			makeConvergenceSchedule(),
		);
		expect(result.ok).toBe(true);
	});
});

describe("validateBoundDualContentPack (same pack as A and B) — forbidden fields", () => {
	it("carry space with activationFlavor raises binding-forbidden-field", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		(pack.pack.bindings[0]!.space as Record<string, unknown>).activationFlavor =
			"fires!";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.field === "activationFlavor");
			expect(err?.rule).toBe("binding-forbidden-field");
		}
	});

	it("carry space with convergenceTier1Flavor raises binding-forbidden-field", () => {
		const pack = makeGoodCarryPack();
		(
			pack.pack.bindings[0]?.space as Record<string, unknown>
		).convergenceTier1Flavor = "someone stands here";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find(
				(e) => e.field === "convergenceTier1Flavor",
			);
			expect(err?.rule).toBe("binding-forbidden-field");
		}
	});

	it("use_space space with convergenceTier1Flavor raises binding-forbidden-field", () => {
		const pack = makeGoodUseSpacePack();
		(
			pack.pack.bindings[0]?.space as Record<string, unknown>
		).convergenceTier1Flavor = "someone";
		const result = validateAsBothPacks(pack, makeUseSpaceSchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find(
				(e) => e.field === "convergenceTier1Flavor",
			);
			expect(err?.rule).toBe("binding-forbidden-field");
		}
	});

	it("convergence space with activationFlavor raises binding-forbidden-field", () => {
		const pack = makeGoodConvergencePack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		(pack.pack.bindings[0]!.space as Record<string, unknown>).activationFlavor =
			"fires!";
		const result = validateAsBothPacks(pack, makeConvergenceSchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.field === "activationFlavor");
			expect(err?.rule).toBe("binding-forbidden-field");
		}
	});
});

describe("validateBoundDualContentPack (same pack as A and B) — use-cue rules", () => {
	it("carry space examineDescription with use-cue = warning, not error", () => {
		const pack = makeGoodCarryPack();
		(
			pack.pack.bindings[0]?.space as Record<string, unknown>
		).examineDescription = "Press the button here.";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(true);
	});

	it("use_space without use-cue in examineDescription = hard error", () => {
		const pack = makeGoodUseSpacePack();
		(
			pack.pack.bindings[0]?.space as Record<string, unknown>
		).examineDescription = "A plain surface with no features.";
		const result = validateAsBothPacks(pack, makeUseSpaceSchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find(
				(e) =>
					e.field === "examineDescription" && e.rule === "verb-of-activation",
			);
			expect(err).toBeDefined();
		}
	});

	it("use_item without use-cue in examineDescription = hard error", () => {
		const pack = makeGoodUseItemPack();
		(
			pack.pack.bindings[0]?.item as Record<string, unknown>
		).examineDescription = "A strange cylindrical object.";
		const result = validateAsBothPacks(pack, makeUseItemSchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find(
				(e) =>
					e.field === "examineDescription" && e.rule === "verb-of-activation",
			);
			expect(err).toBeDefined();
		}
	});

	it("decoy with use-cue in examineDescription = hard error", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		pack.pack.decoys[0]!.examineDescription =
			"You can press this button to activate something.";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.rule === "verb-of-activation");
			expect(err).toBeDefined();
		}
	});

	it("convergence space with use-cue in examineDescription = warning only", () => {
		const pack = makeGoodConvergencePack();
		(
			pack.pack.bindings[0]?.space as Record<string, unknown>
		).examineDescription =
			"A convergence point where you can press the button.";
		const result = validateAsBothPacks(pack, makeConvergenceSchedule());
		expect(result.ok).toBe(true);
	});
});

describe("validateBoundDualContentPack (same pack as A and B) — ID checks", () => {
	it("missing pre-minted id = missing-field error", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		delete (pack.pack.bindings[0]!.object as Record<string, unknown>).id;
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.rule === "wrong-id");
			expect(err).toBeDefined();
		}
	});

	it("wrong id (LLM invented one) = wrong-id error", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		(pack.pack.bindings[0]!.object as Record<string, unknown>).id =
			"invented-id";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.rule === "wrong-id");
			expect(err).toBeDefined();
		}
	});

	it("wrong decoy id = wrong-id error", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		pack.pack.decoys[0]!.id = "wrong-decoy-id";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.rule === "wrong-id");
			expect(err).toBeDefined();
		}
	});

	it("wrong decoy count = error", () => {
		const pack = makeGoodCarryPack();
		pack.pack.decoys = makeGoodDecoys().slice(0, 1);
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.rule === "wrong-count");
			expect(err).toBeDefined();
		}
	});
});

describe("validateBoundDualContentPack (same pack as A and B) — missing required fields", () => {
	it("carry object missing name = error", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		delete (pack.pack.bindings[0]!.object as Record<string, unknown>).name;
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
	});

	it("carry object placementFlavor missing {actor} = actor-presence error", () => {
		const pack = makeGoodCarryPack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		(pack.pack.bindings[0]!.object as Record<string, unknown>).placementFlavor =
			"places it down";
		const result = validateAsBothPacks(pack, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.rule === "actor-presence");
			expect(err).toBeDefined();
		}
	});

	it("convergence missing convergenceTier1Flavor = error", () => {
		const pack = makeGoodConvergencePack();
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		delete (pack.pack.bindings[0]!.space as Record<string, unknown>)
			.convergenceTier1Flavor;
		const result = validateAsBothPacks(pack, makeConvergenceSchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find(
				(e) => e.field === "convergenceTier1Flavor",
			);
			expect(err).toBeDefined();
		}
	});
});

describe("validateBoundDualContentPack", () => {
	it("well-formed dual pack passes", () => {
		const dualResponse = {
			phases: [
				{
					packA: makeGoodCarryPack().pack,
					packB: makeGoodCarryPack().pack,
				},
			],
		};
		const result = validateBoundDualContentPack(
			dualResponse,
			makeCarrySchedule(),
		);
		expect(result.ok).toBe(true);
	});

	it("dual pack with error in packB fails", () => {
		const goodPack = makeGoodCarryPack().pack;
		const badPack = { ...makeGoodCarryPack().pack };
		// biome-ignore lint/style/noNonNullAssertion: test fixture access
		(badPack.bindings![0]!.space as Record<string, unknown>).activationFlavor =
			"forbidden!";
		const dualResponse = {
			phases: [
				{
					packA: goodPack,
					packB: badPack,
				},
			],
		};
		const result = validateBoundDualContentPack(
			dualResponse,
			makeCarrySchedule(),
		);
		expect(result.ok).toBe(false);
	});
});

describe("validateBoundDualContentPack — retry unit binding ids", () => {
	it("names the retry unit after the binding index, not the phase", () => {
		const schedule = makeSchedule({
			skeletons: [
				...makeCarrySchedule(0).skeletons,
				...makeUseSpaceSchedule(1).skeletons,
			],
		});
		const carry = makeGoodCarryPack(0).pack;
		const useSpace = makeGoodUseSpacePack(1).pack;
		const pack = {
			...carry,
			bindings: [...carry.bindings, ...useSpace.bindings],
		};
		delete (pack.bindings[1]?.space as Record<string, unknown>).name;
		const result = validateAsBothPacks({ pack }, schedule);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const units = result.errors.map((e) => e.retryUnit);
			expect(units).toContainEqual(
				expect.objectContaining({
					kind: "use-space-binding",
					bindingId: "useSpace-1",
				}),
			);
			expect(units).not.toContainEqual(
				expect.objectContaining({ bindingId: "useSpace-0" }),
			);
		}
	});

	it("gives two carry bindings distinct retry units", () => {
		const schedule = makeSchedule({
			skeletons: [
				...makeCarrySchedule(0).skeletons,
				...makeCarrySchedule(1).skeletons,
			],
		});
		const pack = {
			...makeGoodCarryPack(0).pack,
			bindings: [
				...makeGoodCarryPack(0).pack.bindings,
				...makeGoodCarryPack(1).pack.bindings,
			],
		};
		delete (pack.bindings[1]?.object as Record<string, unknown>).name;
		const result = validateAsBothPacks({ pack }, schedule);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const bindingIds = result.errors.map(
				(e) => (e.retryUnit as { bindingId?: string }).bindingId,
			);
			expect(bindingIds).toContain("carry-1");
			expect(bindingIds).not.toContain("carry-0");
		}
	});
});

describe("validateBoundDualContentPack — obstacle count", () => {
	function makeObstacle(id: string) {
		return {
			id,
			name: "rubble heap",
			examineDescription: "A heap of broken stone.",
			shiftFlavor: "The rubble settles with a dry clatter.",
		};
	}

	it("rejects extra obstacles beyond the scheduled count", () => {
		const response = makeGoodCarryPack();
		const pack = {
			...response.pack,
			obstacles: [makeObstacle("obstacle-0"), makeObstacle("obstacle-1")],
		};
		const result = validateAsBothPacks(
			{ pack },
			makeSchedule({ ...makeCarrySchedule(), obstacleCount: 1 }),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find(
				(e) => e.field === "obstacles" && e.rule === "wrong-count",
			);
			expect(err?.message).toMatch(/exactly 1 obstacles/);
			expect(err?.message).toMatch(/got 2/);
		}
	});

	it("rejects obstacles when none are scheduled", () => {
		const response = makeGoodCarryPack();
		const pack = { ...response.pack, obstacles: [makeObstacle("obstacle-0")] };
		const result = validateAsBothPacks({ pack }, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.rule === "wrong-count")).toBe(true);
		}
	});

	it("accepts exactly the scheduled obstacles", () => {
		const response = makeGoodCarryPack();
		const pack = { ...response.pack, obstacles: [makeObstacle("obstacle-0")] };
		const result = validateAsBothPacks(
			{ pack },
			makeSchedule({ ...makeCarrySchedule(), obstacleCount: 1 }),
		);
		expect(result.ok).toBe(true);
	});
});

describe("validateBoundDualContentPack — pack-level fields", () => {
	it.each(["wallName", "setting"])("rejects a pack missing %s", (field) => {
		const response = makeGoodCarryPack();
		const pack: Record<string, unknown> = { ...response.pack };
		delete pack[field];
		const result = validateAsBothPacks({ pack }, makeCarrySchedule());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err = result.errors.find((e) => e.field === field);
			expect(err?.rule).toBe("missing-field");
		}
	});

	it.each([
		"wallName",
		"setting",
	])("rejects a pack with a blank %s", (field) => {
		const response = makeGoodCarryPack();
		const pack = { ...response.pack, [field]: "   " };
		const result = validateAsBothPacks({ pack }, makeCarrySchedule());
		expect(result.ok).toBe(false);
	});
});

describe("validateBoundDualContentPack — pack labels", () => {
	it("tags each error with the pack it came from", () => {
		const good = makeGoodCarryPack().pack;
		const bad = makeGoodCarryPack().pack;
		delete (bad.bindings[0]?.object as Record<string, unknown>).name;
		const result = validateBoundDualContentPack(
			{ phases: [{ packA: good, packB: bad }] },
			makeCarrySchedule(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.length).toBeGreaterThan(0);
			for (const e of result.errors) expect(e.retryUnit.pack).toBe("B");
		}
	});

	it("tags a missing pack with its own label", () => {
		const result = validateBoundDualContentPack(
			{ phases: [{ packA: makeGoodCarryPack().pack }] },
			makeCarrySchedule(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toEqual([
				expect.objectContaining({
					field: "packB",
					retryUnit: expect.objectContaining({ pack: "B" }),
				}),
			]);
		}
	});
});
