import { describe, expect, it } from "vitest";
import { buildDualBindingPrompt } from "../binding-prompt-builder.js";
import type { ObjectiveType } from "../types.js";

function promptForSettingA(
	types: ObjectiveType[],
	settingA: string,
	theme: string,
	weatherA: string,
	timeOfDayA: string,
	obstacleCount: number,
) {
	return buildDualBindingPrompt(
		types,
		settingA,
		"forest clearing",
		theme,
		weatherA,
		"clear",
		timeOfDayA,
		"dusk",
		obstacleCount,
	);
}

describe("buildDualBindingPrompt — ID minting", () => {
	it("carry: mints objectId and spaceId with correct pattern", () => {
		const { skeletons } = promptForSettingA(
			["carry"],
			"lab",
			"mundane",
			"foggy",
			"dawn",
			0,
		);
		expect(skeletons).toHaveLength(1);
		expect(skeletons[0]).toEqual({
			type: "carry",
			objectId: "carry-0-obj",
			spaceId: "carry-0-space",
		});
	});

	it("use_space: mints spaceId with correct pattern", () => {
		const { skeletons } = promptForSettingA(
			["use_space"],
			"lab",
			"mundane",
			"foggy",
			"dawn",
			0,
		);
		expect(skeletons[0]).toEqual({
			type: "use_space",
			spaceId: "useSpace-0-space",
		});
	});

	it("use_item: mints itemId with correct pattern", () => {
		const { skeletons } = promptForSettingA(
			["use_item"],
			"lab",
			"mundane",
			"foggy",
			"dawn",
			0,
		);
		expect(skeletons[0]).toEqual({
			type: "use_item",
			itemId: "useItem-0-item",
		});
	});

	it("convergence: mints spaceId with correct pattern", () => {
		const { skeletons } = promptForSettingA(
			["convergence"],
			"lab",
			"mundane",
			"foggy",
			"dawn",
			0,
		);
		expect(skeletons[0]).toEqual({
			type: "convergence",
			spaceId: "convergence-0-space",
		});
	});

	it("IDs are stable/deterministic given the same types array", () => {
		const types: ObjectiveType[] = ["carry", "use_item", "convergence"];
		const r1 = promptForSettingA(types, "s", "t", "w", "tod", 0);
		const r2 = promptForSettingA(types, "s", "t", "w", "tod", 0);
		expect(r1.skeletons).toEqual(r2.skeletons);
	});

	it("3-carry: 3 pairs (6 inner ids) plus 2 decoys", () => {
		const { skeletons, decoys } = promptForSettingA(
			["carry", "carry", "carry"],
			"s",
			"t",
			"w",
			"tod",
			0,
		);
		expect(skeletons).toHaveLength(3);
		expect(decoys).toHaveLength(2);
		const innerIds = skeletons.flatMap((sk) => [sk.objectId, sk.spaceId]);
		expect(innerIds.filter(Boolean)).toHaveLength(6);
		expect(skeletons[0]?.objectId).toBe("carry-0-obj");
		expect(skeletons[0]?.spaceId).toBe("carry-0-space");
		expect(skeletons[1]?.objectId).toBe("carry-1-obj");
		expect(skeletons[2]?.objectId).toBe("carry-2-obj");
	});

	it("3-use_item: 3 useItem entities plus 2 decoys", () => {
		const { skeletons, decoys } = promptForSettingA(
			["use_item", "use_item", "use_item"],
			"s",
			"t",
			"w",
			"tod",
			0,
		);
		expect(skeletons).toHaveLength(3);
		expect(decoys).toHaveLength(2);
		expect(skeletons[0]?.itemId).toBe("useItem-0-item");
		expect(skeletons[1]?.itemId).toBe("useItem-1-item");
		expect(skeletons[2]?.itemId).toBe("useItem-2-item");
	});
});

describe("buildDualBindingPrompt — decoys", () => {
	it("always returns exactly 2 decoys", () => {
		const types: ObjectiveType[] = ["carry", "use_space", "use_item"];
		const { decoys } = promptForSettingA(types, "s", "t", "w", "tod", 0);
		expect(decoys).toHaveLength(2);
		expect(decoys[0]?.id).toBe("decoy-0");
		expect(decoys[1]?.id).toBe("decoy-1");
	});
});

describe("buildDualBindingPrompt — userMessage", () => {
	it("mentions every minted entity id", () => {
		const types: ObjectiveType[] = ["carry", "use_item", "convergence"];
		const { skeletons, decoys, userMessage } = promptForSettingA(
			types,
			"abandoned lab",
			"mundane",
			"overcast",
			"afternoon",
			2,
		);
		for (const sk of skeletons) {
			if (sk.objectId) expect(userMessage).toContain(sk.objectId);
			if (sk.spaceId) expect(userMessage).toContain(sk.spaceId);
			if (sk.itemId) expect(userMessage).toContain(sk.itemId);
		}
		for (const d of decoys) {
			expect(userMessage).toContain(d.id);
		}
	});

	it("mentions obstacle ids when obstacleCount > 0", () => {
		const { userMessage } = promptForSettingA(
			["carry"],
			"s",
			"t",
			"w",
			"tod",
			3,
		);
		expect(userMessage).toContain("obstacle-0");
		expect(userMessage).toContain("obstacle-1");
		expect(userMessage).toContain("obstacle-2");
	});

	it("includes setting, theme, weather, timeOfDay in message", () => {
		const { userMessage } = promptForSettingA(
			["use_space"],
			"abandoned station",
			"technological",
			"heavy rain",
			"midnight",
			0,
		);
		expect(userMessage).toContain("abandoned station");
		expect(userMessage).toContain("technological");
		expect(userMessage).toContain("heavy rain");
		expect(userMessage).toContain("midnight");
	});
});

describe("buildDualBindingPrompt", () => {
	it("produces a single userMessage referencing both settings", () => {
		const types: ObjectiveType[] = ["carry", "use_item"];
		const { userMessage } = buildDualBindingPrompt(
			types,
			"subway station",
			"forest clearing",
			"magical",
			"foggy",
			"clear",
			"dawn",
			"dusk",
			2,
		);
		expect(userMessage).toContain("subway station");
		expect(userMessage).toContain("forest clearing");
	});

	it("mentions every minted entity id in the message", () => {
		const types: ObjectiveType[] = ["carry", "use_item"];
		const { skeletons, decoys, userMessage } = buildDualBindingPrompt(
			types,
			"sA",
			"sB",
			"t",
			"wA",
			"wB",
			"todA",
			"todB",
			1,
		);
		for (const sk of skeletons) {
			if (sk.objectId) expect(userMessage).toContain(sk.objectId);
			if (sk.spaceId) expect(userMessage).toContain(sk.spaceId);
			if (sk.itemId) expect(userMessage).toContain(sk.itemId);
		}
		for (const d of decoys) {
			expect(userMessage).toContain(d.id);
		}
	});
});

describe("buildDualBindingPrompt — carry prose tell", () => {
	it("asks for the paired space's name, not its id", () => {
		const { userMessage } = promptForSettingA(
			["carry"],
			"lab",
			"mundane",
			"foggy",
			"dawn",
			0,
		);
		const objectExamineLine = userMessage
			.split("\n")
			.find((line) => line.includes('"examineDescription"'));
		expect(objectExamineLine).toContain("space.name");
		expect(objectExamineLine).toContain("never by its id");
		expect(objectExamineLine).not.toContain("carry-0-space");
	});
});
