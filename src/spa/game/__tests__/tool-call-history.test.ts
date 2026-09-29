import { describe, expect, it } from "vitest";
import { appendMessage } from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import type { AiPersona } from "../types";
import { makeTestGame, TEST_PERSONAS } from "./fixtures/make-game-state";

const BLUE_PERSONA: AiPersona = {
	id: "blue",
	name: "Blue",
	color: "#5fa8d3",
	temperaments: ["curious", "thoughtful"],
	personaGoal: "Explore.",
	typingQuirks: ["You ask questions.", "You type clearly and precisely."],
	blurb: "Blue is curious.",
	voiceExamples: ["ex1-blue", "ex2-blue", "ex3-blue"],
};

function makeGame() {
	return makeTestGame({
		personas: { red: TEST_PERSONAS.red as AiPersona, blue: BLUE_PERSONA },
	});
}

describe("appendMessage with tool call data", () => {
	it("stores toolCallId and toolArgumentsJson when provided", () => {
		const argsJson = '{"to":"blue","content":"Hello"}';
		const game = appendMessage(makeGame(), "red", "blue", "Hello", {
			toolCallId: "call_test123",
			toolArgumentsJson: argsJson,
		});

		const redLog = game.conversationLogs.red ?? [];
		expect(redLog).toHaveLength(1);
		expect(redLog[0]).toMatchObject({
			kind: "message",
			toolCallId: "call_test123",
			toolArgumentsJson: argsJson,
		});
	});

	it("works without tool call data (backward compatibility)", () => {
		let game = makeGame();
		game = appendMessage(game, "red", "blue", "Hello");

		// biome-ignore lint/style/noNonNullAssertion: test guarantees red log exists
		const redLog = game.conversationLogs.red!;
		expect(redLog).toHaveLength(1);
		expect((redLog[0] as { toolCallId?: string }).toolCallId).toBeUndefined();
	});
});

describe("buildOpenAiMessages — outgoing messages rendered as tool calls", () => {
	it("renders outgoing message as a tool call immediately followed by its tool result when toolCallId exists", () => {
		let game = makeGame();
		game = appendMessage(game, "red", "blue", "Hello there", {
			toolCallId: "call_msg123",
			toolArgumentsJson: '{"to":"blue","content":"Hello there"}',
		});

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		const assistantWithToolCalls = messages.find(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		expect(assistantWithToolCalls).toBeDefined();
		if (assistantWithToolCalls?.role === "assistant") {
			expect(assistantWithToolCalls.tool_calls).toHaveLength(1);
			expect(assistantWithToolCalls.tool_calls?.[0]?.id).toBe("call_msg123");
			expect(assistantWithToolCalls.tool_calls?.[0]?.function.name).toBe(
				"message",
			);
			expect(assistantWithToolCalls.tool_calls?.[0]?.function.arguments).toBe(
				'{"to":"blue","content":"Hello there"}',
			);
		}

		const assistantIdx = messages.findIndex(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		const toolMsg = messages[assistantIdx + 1];
		expect(toolMsg?.role).toBe("tool");
		if (toolMsg?.role === "tool") {
			expect(toolMsg.tool_call_id).toBe("call_msg123");
			expect(toolMsg.content).toContain("Hello there");
		}
	});

	it("renders outgoing message as free text when no toolCallId (backward compat)", () => {
		let game = makeGame();
		game = appendMessage(game, "red", "blue", "Hello there");

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		const assistantWithToolCalls = messages.find(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		expect(assistantWithToolCalls).toBeUndefined();

		const assistantWithContent = messages.find(
			(m) => m.role === "assistant" && "content" in m && m.content !== null,
		);
		expect(assistantWithContent).toBeDefined();
		expect((assistantWithContent as { content: string }).content).toContain(
			"you dm blue",
		);
	});
});
