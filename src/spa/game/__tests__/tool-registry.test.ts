import { describe, expect, it } from "vitest";
import { parseToolCallArguments, TOOL_DEFINITIONS } from "../tool-registry";

describe("TOOL_DEFINITIONS", () => {
	it("lists exactly the six tools: pick_up, put_down, give, use, go, look", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toEqual(["pick_up", "put_down", "give", "use", "go", "look"]);
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

	it("give.to has no enum constraint (accepts any AI id string)", () => {
		const give = TOOL_DEFINITIONS.find((t) => t.function.name === "give");
		expect(give?.function.parameters.properties.to?.enum).toBeUndefined();
		expect(give?.function.parameters.properties.to?.type).toBe("string");
	});

	it("go requires 'direction'", () => {
		const go = TOOL_DEFINITIONS.find((t) => t.function.name === "go");
		expect(go?.function.parameters.required).toContain("direction");
	});

	it("go.direction has a 4-value enum of cardinal directions", () => {
		const go = TOOL_DEFINITIONS.find((t) => t.function.name === "go");
		const dirEnum = go?.function.parameters.properties.direction?.enum;
		expect(dirEnum).toHaveLength(4);
		expect(dirEnum).toContain("north");
		expect(dirEnum).toContain("south");
		expect(dirEnum).toContain("east");
		expect(dirEnum).toContain("west");
	});

	it("look requires 'direction'", () => {
		const look = TOOL_DEFINITIONS.find((t) => t.function.name === "look");
		expect(look?.function.parameters.required).toContain("direction");
	});

	it("look.direction has a 4-value enum of cardinal directions", () => {
		const look = TOOL_DEFINITIONS.find((t) => t.function.name === "look");
		const dirEnum = look?.function.parameters.properties.direction?.enum;
		expect(dirEnum).toHaveLength(4);
		expect(dirEnum).toContain("north");
		expect(dirEnum).toContain("south");
		expect(dirEnum).toContain("east");
		expect(dirEnum).toContain("west");
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
		const result = parseToolCallArguments(
			"give",
			'{"item":"flower","to":"blue"}',
		);
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
		const result = parseToolCallArguments("pick_up", "{}");
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

	it("parses valid go arguments", () => {
		const result = parseToolCallArguments("go", '{"direction":"north"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ direction: "north" });
		}
	});

	it("parses valid look arguments", () => {
		const result = parseToolCallArguments("look", '{"direction":"west"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ direction: "west" });
		}
	});

	it("returns ok:false with /required/i reason when 'direction' is missing for go", () => {
		const result = parseToolCallArguments("go", "{}");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /required/i reason when 'direction' is missing for look", () => {
		const result = parseToolCallArguments("look", "{}");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});
});
