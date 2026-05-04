import { describe, expect, it } from "vitest";
import {
	TOOL_DEFINITIONS,
	parseToolCallArguments,
} from "../tool-registry";

describe("TOOL_DEFINITIONS", () => {
	it("lists exactly the four tools: pick_up, put_down, give, use", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toEqual(["pick_up", "put_down", "give", "use"]);
	});

	it("each definition has type: 'function'", () => {
		for (const tool of TOOL_DEFINITIONS) {
			expect(tool.type).toBe("function");
		}
	});

	it("each definition has a non-empty description", () => {
		for (const tool of TOOL_DEFINITIONS) {
			expect(typeof tool.function.description).toBe("string");
			expect(tool.function.description.length).toBeGreaterThan(0);
		}
	});

	it("each definition has a JSON-Schema parameters object", () => {
		for (const tool of TOOL_DEFINITIONS) {
			expect(tool.function.parameters).toBeDefined();
			expect(tool.function.parameters.type).toBe("object");
			expect(typeof tool.function.parameters.properties).toBe("object");
			expect(Array.isArray(tool.function.parameters.required)).toBe(true);
		}
	});

	it("pick_up requires 'item'", () => {
		const pickUp = TOOL_DEFINITIONS.find((t) => t.function.name === "pick_up");
		expect(pickUp?.function.parameters.required).toContain("item");
	});

	it("give requires 'item' and 'to'", () => {
		const give = TOOL_DEFINITIONS.find((t) => t.function.name === "give");
		expect(give?.function.parameters.required).toContain("item");
		expect(give?.function.parameters.required).toContain("to");
	});

	it("give.to has enum ['red','green','blue']", () => {
		const give = TOOL_DEFINITIONS.find((t) => t.function.name === "give");
		expect(give?.function.parameters.properties.to?.enum).toEqual([
			"red",
			"green",
			"blue",
		]);
	});
});

describe("parseToolCallArguments", () => {
	it("parses valid pick_up arguments", () => {
		const result = parseToolCallArguments("pick_up", '{"item":"flower"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "flower" });
		}
	});

	it("parses valid give arguments", () => {
		const result = parseToolCallArguments("give", '{"item":"flower","to":"blue"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "flower", to: "blue" });
		}
	});

	it("parses valid put_down arguments", () => {
		const result = parseToolCallArguments("put_down", '{"item":"key"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "key" });
		}
	});

	it("parses valid use arguments", () => {
		const result = parseToolCallArguments("use", '{"item":"wand"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "wand" });
		}
	});

	it("returns ok:false with /malformed/i reason for invalid JSON", () => {
		const result = parseToolCallArguments("pick_up", "not json");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/malformed/i);
		}
	});

	it("returns ok:false with /malformed/i reason for JSON array", () => {
		const result = parseToolCallArguments("pick_up", '["item","flower"]');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/malformed/i);
		}
	});

	it("returns ok:false with /required/i reason when 'item' is missing for pick_up", () => {
		const result = parseToolCallArguments("pick_up", '{}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /required/i reason when 'to' is missing for give", () => {
		const result = parseToolCallArguments("give", '{"item":"flower"}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /required/i reason when 'item' is missing for give", () => {
		const result = parseToolCallArguments("give", '{"to":"blue"}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});
});
