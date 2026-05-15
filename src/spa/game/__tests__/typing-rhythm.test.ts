import { describe, expect, it } from "vitest";
import { AI_TYPING_SPEED } from "../typing-rhythm";

describe("AI_TYPING_SPEED", () => {
	it("is a number", () => {
		expect(typeof AI_TYPING_SPEED).toBe("number");
	});
});
