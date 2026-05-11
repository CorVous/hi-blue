import { describe, expect, it } from "vitest";
import { parseToolCallArguments, TOOL_DEFINITIONS } from "../tool-registry";

describe("TOOL_DEFINITIONS", () => {
	it("lists exactly the eight tools: pick_up, put_down, give, use, go, look, examine, message", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toEqual([
			"pick_up",
			"put_down",
			"give",
			"use",
			"go",
			"look",
			"examine",
			"message",
		]);
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

	it("examine requires 'item'", () => {
		const examine = TOOL_DEFINITIONS.find((t) => t.function.name === "examine");
		expect(examine?.function.parameters.required).toContain("item");
	});

	it("examine has a non-empty description mentioning 'Private'", () => {
		const examine = TOOL_DEFINITIONS.find((t) => t.function.name === "examine");
		expect(examine?.function.description).toMatch(/private/i);
	});

	it("examine.item has no enum constraint in base definition", () => {
		const examine = TOOL_DEFINITIONS.find((t) => t.function.name === "examine");
		expect(examine?.function.parameters.properties.item?.enum).toBeUndefined();
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
			'{"item":"flower","to":"cyan"}',
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "flower", to: "cyan" });
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
		const result = parseToolCallArguments("give", '{"to":"cyan"}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("strips a leading '*' from give.to (conversation log renders ids as *foo)", () => {
		const result = parseToolCallArguments(
			"give",
			'{"item":"flower","to":"*cyan"}',
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "flower", to: "cyan" });
		}
	});

	it("returns ok:false when give.to is just '*' (empty after strip)", () => {
		const result = parseToolCallArguments("give", '{"item":"flower","to":"*"}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("parses valid message arguments", () => {
		const result = parseToolCallArguments(
			"message",
			'{"to":"cyan","content":"hi"}',
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ to: "cyan", content: "hi" });
		}
	});

	it("strips a leading '*' from message.to (conversation log renders ids as *foo)", () => {
		const result = parseToolCallArguments(
			"message",
			'{"to":"*6nho","content":"hi"}',
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ to: "6nho", content: "hi" });
		}
	});

	it("only strips a single leading '*' from message.to", () => {
		const result = parseToolCallArguments(
			"message",
			'{"to":"**foo","content":"hi"}',
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ to: "*foo", content: "hi" });
		}
	});

	it("returns ok:false when message.to is just '*' (empty after strip)", () => {
		const result = parseToolCallArguments(
			"message",
			'{"to":"*","content":"hi"}',
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /required/i reason when 'to' is missing for message", () => {
		const result = parseToolCallArguments("message", '{"content":"hi"}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /required/i reason when 'content' is missing for message", () => {
		const result = parseToolCallArguments("message", '{"to":"cyan"}');
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

	it("parses valid examine arguments", () => {
		const result = parseToolCallArguments("examine", '{"item":"artifact"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ item: "artifact" });
		}
	});

	it("returns ok:false with /required/i reason when 'item' is missing for examine", () => {
		const result = parseToolCallArguments("examine", "{}");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /malformed/i reason for malformed JSON on examine", () => {
		const result = parseToolCallArguments("examine", "not json");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/malformed/i);
		}
	});
});
