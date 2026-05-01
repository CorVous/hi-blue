import { describe, expect, it } from "vitest";
import { parseAiTurnAction } from "../action-parser";

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
