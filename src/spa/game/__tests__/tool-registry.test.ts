import { describe, expect, it } from "vitest";
import { parseToolCallArguments, TOOL_DEFINITIONS } from "../tool-registry";
import type { ToolName } from "../types";

describe("TOOL_DEFINITIONS", () => {
	it("lists exactly five tools, and no `face` tool: pick_up, put_down, use, go, message", () => {
		const names = TOOL_DEFINITIONS.map((t) => t.function.name);
		expect(names).toEqual(["pick_up", "put_down", "use", "go", "message"]);
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
		expect(description).not.toMatch(/facing/i);
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
			expect(description).not.toMatch(/facing/i);
			expect(description).not.toMatch(/behind you|to your left|to your right/i);
		}
	});
});

describe("parseToolCallArguments", () => {
	it.each<[ToolName, string, Record<string, string>]>([
		["pick_up", '{"item":"flower"}', { item: "flower" }],
		["put_down", '{"item":"key"}', { item: "key" }],
		["use", '{"item":"wand"}', { item: "wand" }],
		["message", '{"to":"cyan","content":"hi"}', { to: "cyan", content: "hi" }],
		["message", '{"to":"*6nho","content":"hi"}', { to: "6nho", content: "hi" }],
		["message", '{"to":"**foo","content":"hi"}', { to: "*foo", content: "hi" }],
		["go", '{"direction":"north"}', { direction: "north" }],
	])("parses valid %s arguments %s (a single leading '*' on message.to is stripped)", (tool, json, args) => {
		const result = parseToolCallArguments(tool, json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.args).toEqual(args);
		}
	});

	it.each<[ToolName, string, RegExp]>([
		["pick_up", "not json", /malformed/i],
		["pick_up", '["item","flower"]', /malformed/i],
		["pick_up", "{}", /required/i],
		["message", '{"to":"*","content":"hi"}', /required/i],
		["message", '{"content":"hi"}', /required/i],
		["message", '{"to":"cyan"}', /required/i],
		["go", "{}", /required/i],
	])("rejects %s arguments %s with a reason matching %s", (tool, json, reason) => {
		const result = parseToolCallArguments(tool, json);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(reason);
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

	it("pick_up description states that pick_up must come before use", () => {
		const pickUp = TOOL_DEFINITIONS.find((t) => t.function.name === "pick_up");
		expect(pickUp?.function.description).toMatch(/before.*use|must pick_up/i);
	});

	it("use description covers a held item or a reachable place", () => {
		const use = TOOL_DEFINITIONS.find((t) => t.function.name === "use");
		const description = use?.function.description ?? "";
		expect(description).toMatch(/item you are holding/i);
		expect(description).toMatch(/activate a place/i);
		expect(description).toMatch(/must be picked up first/i);
		expect(description).not.toMatch(/must be holding/i);
	});

	it("item arguments ask for the name the Daemon sees, not an id", () => {
		for (const tool of ["pick_up", "put_down", "use"]) {
			const def = TOOL_DEFINITIONS.find((t) => t.function.name === tool);
			const item = def?.function.parameters.properties.item;
			expect(item?.description, tool).toMatch(/name/i);
			expect(item?.description, tool).not.toMatch(/\bid\b/i);
		}
	});
});
