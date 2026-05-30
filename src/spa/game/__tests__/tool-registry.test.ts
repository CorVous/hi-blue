import { describe, expect, it } from "vitest";
import { parseToolCallArguments, TOOL_DEFINITIONS } from "../tool-registry";

describe("TOOL_DEFINITIONS", () => {
	it("lists exactly six tools: pick_up, put_down, use, go, face, message", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toEqual([
			"pick_up",
			"put_down",
			"use",
			"go",
			"face",
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

	it("go requires 'direction'", () => {
		const go = TOOL_DEFINITIONS.find((t) => t.function.name === "go");
		expect(go?.function.parameters.required).toContain("direction");
	});

	it("go.direction has a 4-value enum of relative directions", () => {
		const go = TOOL_DEFINITIONS.find((t) => t.function.name === "go");
		const dirEnum = go?.function.parameters.properties.direction?.enum;
		expect(dirEnum).toHaveLength(4);
		expect(dirEnum).toContain("forward");
		expect(dirEnum).toContain("back");
		expect(dirEnum).toContain("left");
		expect(dirEnum).toContain("right");
	});

	it("face requires 'direction'", () => {
		const face = TOOL_DEFINITIONS.find((t) => t.function.name === "face");
		expect(face?.function.parameters.required).toContain("direction");
	});

	it("face.direction has a 4-value enum of relative directions", () => {
		const face = TOOL_DEFINITIONS.find((t) => t.function.name === "face");
		const dirEnum = face?.function.parameters.properties.direction?.enum;
		expect(dirEnum).toHaveLength(4);
		expect(dirEnum).toContain("forward");
		expect(dirEnum).toContain("back");
		expect(dirEnum).toContain("left");
		expect(dirEnum).toContain("right");
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
		const result = parseToolCallArguments("go", '{"direction":"forward"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ direction: "forward" });
		}
	});

	it("parses valid face arguments", () => {
		const result = parseToolCallArguments("face", '{"direction":"left"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ direction: "left" });
		}
	});

	it("returns ok:false with /required/i reason when 'direction' is missing for go", () => {
		const result = parseToolCallArguments("go", "{}");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("returns ok:false with /required/i reason when 'direction' is missing for face", () => {
		const result = parseToolCallArguments("face", "{}");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/required/i);
		}
	});

	it("pick_up description states that pick_up must come before use", () => {
		const pickUp = TOOL_DEFINITIONS.find((t) => t.function.name === "pick_up");
		expect(pickUp?.function.description).toMatch(/before.*use|must pick_up/i);
	});

	it("use description states the item must be held to use it", () => {
		const use = TOOL_DEFINITIONS.find((t) => t.function.name === "use");
		expect(use?.function.description).toMatch(/must be holding/i);
	});
});
