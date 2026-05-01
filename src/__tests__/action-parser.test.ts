import { describe, expect, it } from "vitest";
import { parseAiTurnAction, parseToolCall } from "../action-parser";

describe("parseAiTurnAction", () => {
	it("parses a plain chat message addressed to the player", () => {
		const action = parseAiTurnAction("red", "Hello, nice to meet you!");
		expect(action.aiId).toBe("red");
		expect(action.chat).toBeDefined();
		expect(action.chat?.target).toBe("player");
		expect(action.chat?.content).toBe("Hello, nice to meet you!");
		expect(action.whisper).toBeUndefined();
		expect(action.pass).toBeUndefined();
	});

	it("parses a [WHISPER:green] prefix as a whisper to green", () => {
		const action = parseAiTurnAction(
			"red",
			"[WHISPER:green] Let's work together against blue.",
		);
		expect(action.aiId).toBe("red");
		expect(action.whisper).toBeDefined();
		expect(action.whisper?.target).toBe("green");
		expect(action.whisper?.content).toBe("Let's work together against blue.");
		expect(action.chat).toBeUndefined();
		expect(action.pass).toBeUndefined();
	});

	it("parses a [WHISPER:blue] prefix as a whisper to blue", () => {
		const action = parseAiTurnAction(
			"green",
			"[WHISPER:blue] Be careful with red.",
		);
		expect(action.whisper?.target).toBe("blue");
		expect(action.whisper?.content).toBe("Be careful with red.");
	});

	it("parses a [WHISPER:red] prefix as a whisper to red", () => {
		const action = parseAiTurnAction(
			"blue",
			"[WHISPER:red] I need the flower.",
		);
		expect(action.whisper?.target).toBe("red");
		expect(action.whisper?.content).toBe("I need the flower.");
	});

	it("parses [PASS] as a pass action", () => {
		const action = parseAiTurnAction("green", "[PASS]");
		expect(action.aiId).toBe("green");
		expect(action.pass).toBe(true);
		expect(action.chat).toBeUndefined();
		expect(action.whisper).toBeUndefined();
	});

	it("parses [PASS] case-insensitively", () => {
		const action = parseAiTurnAction("blue", "[pass]");
		expect(action.pass).toBe(true);
	});

	it("treats empty string as pass", () => {
		const action = parseAiTurnAction("red", "");
		expect(action.pass).toBe(true);
	});

	it("strips whitespace from whisper content", () => {
		const action = parseAiTurnAction(
			"red",
			"[WHISPER:green]    Some secret   ",
		);
		expect(action.whisper?.content).toBe("Some secret");
	});

	it("whisper prefix is case-insensitive", () => {
		const action = parseAiTurnAction("red", "[whisper:green] hello");
		expect(action.whisper?.target).toBe("green");
		expect(action.whisper?.content).toBe("hello");
	});
});

describe("parseToolCall", () => {
	it("parses [TOOL:pick_up item=flower]", () => {
		const result = parseToolCall("[TOOL:pick_up item=flower]");
		expect(result).toBeDefined();
		expect(result?.name).toBe("pick_up");
		expect(result?.args.item).toBe("flower");
	});

	it("parses [TOOL:give item=key to=blue]", () => {
		const result = parseToolCall("[TOOL:give item=key to=blue]");
		expect(result).toBeDefined();
		expect(result?.name).toBe("give");
		expect(result?.args.item).toBe("key");
		expect(result?.args.to).toBe("blue");
	});

	it("parses [TOOL:put_down item=flower]", () => {
		const result = parseToolCall("[TOOL:put_down item=flower]");
		expect(result?.name).toBe("put_down");
		expect(result?.args.item).toBe("flower");
	});

	it("parses [TOOL:use item=key]", () => {
		const result = parseToolCall("[TOOL:use item=key]");
		expect(result?.name).toBe("use");
		expect(result?.args.item).toBe("key");
	});

	it("is case-insensitive on the tool name", () => {
		const result = parseToolCall("[tool:PICK_UP item=flower]");
		expect(result?.name).toBe("pick_up");
	});

	it("returns undefined for unknown tool names", () => {
		const result = parseToolCall("[TOOL:teleport target=mars]");
		expect(result).toBeUndefined();
	});

	it("returns undefined when no tool directive is present", () => {
		const result = parseToolCall("Just chatting here, no tools.");
		expect(result).toBeUndefined();
	});

	it("returns undefined for empty string", () => {
		const result = parseToolCall("");
		expect(result).toBeUndefined();
	});
});

describe("parseAiTurnAction – tool call variants", () => {
	it("parses a standalone tool call with no chat text", () => {
		const action = parseAiTurnAction("red", "[TOOL:pick_up item=flower]");
		expect(action.toolCall).toBeDefined();
		expect(action.toolCall?.name).toBe("pick_up");
		expect(action.toolCall?.args.item).toBe("flower");
		expect(action.chat).toBeUndefined();
		expect(action.pass).toBeUndefined();
	});

	it("parses a tool call combined with chat text (tool before chat)", () => {
		const action = parseAiTurnAction(
			"red",
			"[TOOL:pick_up item=flower] I pick up the flower!",
		);
		expect(action.toolCall?.name).toBe("pick_up");
		expect(action.chat).toBeDefined();
		expect(action.chat?.content).toBe("I pick up the flower!");
		expect(action.chat?.target).toBe("player");
	});

	it("parses a tool call combined with chat text (chat before tool)", () => {
		const action = parseAiTurnAction(
			"green",
			"I will take the key. [TOOL:pick_up item=key]",
		);
		expect(action.toolCall?.name).toBe("pick_up");
		expect(action.chat?.content).toBe("I will take the key.");
	});

	it("treats a malformed tool directive (unknown tool) as plain chat", () => {
		const action = parseAiTurnAction(
			"blue",
			"[TOOL:teleport target=moon] Let me try this.",
		);
		expect(action.toolCall).toBeUndefined();
		expect(action.chat).toBeDefined();
		expect(action.chat?.content).toContain("teleport");
	});

	it("does not parse a tool call from a WHISPER message", () => {
		const action = parseAiTurnAction(
			"red",
			"[WHISPER:green] [TOOL:pick_up item=flower]",
		);
		// WHISPER takes priority; no tool call should be extracted
		expect(action.whisper).toBeDefined();
		expect(action.toolCall).toBeUndefined();
	});

	it("does not set chat when only a tool directive is present", () => {
		const action = parseAiTurnAction("blue", "[TOOL:use item=key]");
		expect(action.toolCall?.name).toBe("use");
		expect(action.chat).toBeUndefined();
	});
});
