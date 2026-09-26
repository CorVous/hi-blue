import { afterEach, describe, expect, it, vi } from "vitest";
import { fisherYatesShuffledCopy } from "../shuffle.js";

describe("fisherYatesShuffledCopy", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns a new array and leaves the input untouched", () => {
		const input = ["red", "green", "cyan"];
		const out = fisherYatesShuffledCopy(input);
		expect(out).not.toBe(input);
		expect(input).toEqual(["red", "green", "cyan"]);
		expect([...out].sort()).toEqual(["cyan", "green", "red"]);
	});

	it("keeps the order when Math.random always picks the current slot", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9999);
		expect(fisherYatesShuffledCopy(["a", "b", "c"])).toEqual(["a", "b", "c"]);
	});

	it("reverses a pair when Math.random picks the first slot", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		expect(fisherYatesShuffledCopy(["a", "b"])).toEqual(["b", "a"]);
	});
});
