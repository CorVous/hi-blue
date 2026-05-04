import { describe, expect, it } from "vitest";
import { AI_TYPING_SPEED } from "../typing-rhythm";

describe("AI_TYPING_SPEED", () => {
	it("red types faster than green (red < green)", () => {
		expect(AI_TYPING_SPEED.red).toBeLessThan(AI_TYPING_SPEED.green);
	});

	it("green types faster than blue (green < blue)", () => {
		expect(AI_TYPING_SPEED.green).toBeLessThan(AI_TYPING_SPEED.blue);
	});

	it("all three AIs have distinct typing speeds", () => {
		const speeds = [
			AI_TYPING_SPEED.red,
			AI_TYPING_SPEED.green,
			AI_TYPING_SPEED.blue,
		];
		const unique = new Set(speeds);
		expect(unique.size).toBe(3);
	});
});
