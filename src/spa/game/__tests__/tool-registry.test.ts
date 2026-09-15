import { describe, expect, it } from "vitest";
import { parseToolCallArguments, TOOL_DEFINITIONS } from "../tool-registry";
import type { ToolName } from "../types";
import { RETIRED_ORIENTATION_KEY } from "./fixtures/retired-orientation";

const DAEMON_TOOLS: ToolName[] = [
	"pick_up",
	"put_down",
	"use",
	"go",
	"message",
];

describe("TOOL_DEFINITIONS", () => {
	it("lists exactly five tools: pick_up, put_down, use, go, message", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toEqual(["pick_up", "put_down", "use", "go", "message"]);
		expect(names).toEqual(DAEMON_TOOLS);
	});

	it("has no `face` tool", () => {
		expect(
			TOOL_DEFINITIONS.find((t) => t.function.name === "face"),
		).toBeUndefined();
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

	it("go.direction has a 4-value enum of cardinal directions", () => {
		const go = TOOL_DEFINITIONS.find((t) => t.function.name === "go");
		const dirEnum = go?.function.parameters.properties.direction?.enum;
		expect(dirEnum).toEqual(["north", "south", "east", "west"]);
		expect(dirEnum).not.toContain("forward");
		expect(dirEnum).not.toContain("back");
		expect(dirEnum).not.toContain("left");
		expect(dirEnum).not.toContain("right");
	});

	it("go's description names cardinal directions, not relative movement", () => {
		const go = TOOL_DEFINITIONS.find((t) => t.function.name === "go");
		const description = go?.function.description ?? "";
		expect(description).toMatch(/north/);
		expect(description).toMatch(/south/);
		expect(description).toMatch(/east/);
		expect(description).toMatch(/west/);
		expect(description).not.toMatch(new RegExp(RETIRED_ORIENTATION_KEY, "i"));
		expect(description).not.toMatch(/relative/i);
		expect(description).not.toMatch(/forward|backward/i);
	});

	it("describes reach without relative vocabulary (no cone, no front arc)", () => {
		for (const name of ["pick_up", "use"]) {
			const def = TOOL_DEFINITIONS.find((t) => t.function.name === name);
			const description = def?.function.description ?? "";
			expect(description.length).toBeGreaterThan(0);
			expect(description).not.toMatch(/cone/i);
			expect(description).not.toMatch(/front arc/i);
			expect(description).not.toMatch(/in front/i);
			expect(description).not.toMatch(new RegExp(RETIRED_ORIENTATION_KEY, "i"));
			expect(description).not.toMatch(/behind you|to your left|to your right/i);
		}
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

	it("parses valid go arguments with a cardinal direction", () => {
		const result = parseToolCallArguments("go", '{"direction":"north"}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual({ direction: "north" });
		}
	});

	it("rejects a raw `face` tool call as an unknown tool (retired vocabulary)", () => {
		const result = parseToolCallArguments(
			"face" as ToolName,
			'{"direction":"left"}',
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/unknown tool/i);
			expect(result.reason).toContain("face");
		}
	});

	it("returns ok:false with /required/i reason when 'direction' is missing for go", () => {
		const result = parseToolCallArguments("go", "{}");
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
