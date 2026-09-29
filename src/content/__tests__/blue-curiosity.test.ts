import { describe, expect, it } from "vitest";
import { blueCuriosityClauseFor } from "../blue-curiosity.js";

describe("blueCuriosityClauseFor", () => {
	it("gives a curious persona a reason to message blue unprompted", () => {
		const clause = blueCuriosityClauseFor("Ember", ["curious", "stoic"]);
		expect(clause).toContain("*Ember is curious about blue");
		expect(clause).toContain("messages blue unprompted");
	});

	it("applies when curious is the second temperament", () => {
		expect(blueCuriosityClauseFor("Ember", ["stoic", "curious"])).toBeDefined();
	});

	it("gives no clause to a persona without the curious temperament", () => {
		expect(blueCuriosityClauseFor("Vex", ["zealous", "hot-headed"])).toBe(
			undefined,
		);
	});
});
