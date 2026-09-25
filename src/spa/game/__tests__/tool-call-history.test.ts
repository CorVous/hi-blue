import { describe, expect, it } from "vitest";
import { appendMessage, startGame } from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import type { AiPersona, ConversationEntry } from "../types";
import { makeTestPack } from "./fixtures/make-test-pack";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You occasionally emote with *actions*.",
		],
		blurb: "Ember is hot-headed and zealous.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	blue: {
		id: "blue",
		name: "Blue",
		color: "#5fa8d3",
		temperaments: ["curious", "thoughtful"],
		personaGoal: "Explore.",
		typingQuirks: ["You ask questions.", "You type clearly and precisely."],
		blurb: "Blue is curious.",
		voiceExamples: ["ex1-blue", "ex2-blue", "ex3-blue"],
	},
};

const TEST_CONTENT_PACK = makeTestPack([], { wallName: "wall" });

function makeGame() {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
}

describe("ConversationEntry message kind with tool call fields", () => {
	it("accepts optional toolCallId field", () => {
		const entry: ConversationEntry = {
			kind: "message",
			round: 0,
			from: "red",
			to: "blue",
			content: "Hello",
			toolCallId: "call_abc123",
		};
		expect(entry.kind).toBe("message");
		expect((entry as { toolCallId?: string }).toolCallId).toBe("call_abc123");
	});

	it("accepts optional toolArgumentsJson field", () => {
		const entry: ConversationEntry = {
			kind: "message",
			round: 0,
			from: "red",
			to: "blue",
			content: "Hello",
			toolArgumentsJson: '{"to":"blue","content":"Hello"}',
		};
		expect((entry as { toolArgumentsJson?: string }).toolArgumentsJson).toBe(
			'{"to":"blue","content":"Hello"}',
		);
	});

	it("works without tool call fields (backward compatibility)", () => {
		const entry: ConversationEntry = {
			kind: "message",
			round: 0,
			from: "red",
			to: "blue",
			content: "Hello",
		};
		expect(entry.kind).toBe("message");
		expect((entry as { toolCallId?: string }).toolCallId).toBeUndefined();
	});
});

describe("appendMessage with tool call data", () => {
	it("stores toolCallId when provided", () => {
		let game = makeGame();
		game = appendMessage(game, "red", "blue", "Hello", {
			toolCallId: "call_test123",
		});

		// biome-ignore lint/style/noNonNullAssertion: test guarantees red log exists
		const redLog = game.conversationLogs.red!;
		expect(redLog).toHaveLength(1);
		expect(redLog[0]?.kind).toBe("message");
		expect((redLog[0] as { toolCallId?: string }).toolCallId).toBe(
			"call_test123",
		);
	});

	it("stores toolArgumentsJson when provided", () => {
		let game = makeGame();
		const argsJson = '{"to":"blue","content":"Hello"}';
		game = appendMessage(game, "red", "blue", "Hello", {
			toolArgumentsJson: argsJson,
		});

		// biome-ignore lint/style/noNonNullAssertion: test guarantees red log exists
		const redLog = game.conversationLogs.red!;
		expect(
			(redLog[0] as { toolArgumentsJson?: string }).toolArgumentsJson,
		).toBe(argsJson);
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
	it("renders outgoing message as tool call when toolCallId exists", () => {
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

		const toolMsg = messages.find(
			(m) => m.role === "tool" && m.tool_call_id === "call_msg123",
		);
		expect(toolMsg).toBeDefined();
		if (toolMsg?.role === "tool") {
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

	it("tool result for message appears immediately after assistant tool_calls message", () => {
		let game = makeGame();
		game = appendMessage(game, "red", "blue", "Test message", {
			toolCallId: "call_order123",
			toolArgumentsJson: '{"to":"blue","content":"Test message"}',
		});

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		const assistantIdx = messages.findIndex(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		expect(assistantIdx).toBeGreaterThanOrEqual(0);

		const nextMsg = messages[assistantIdx + 1];
		expect(nextMsg?.role).toBe("tool");
		if (nextMsg?.role === "tool") {
			expect(nextMsg.tool_call_id).toBe("call_order123");
		}
	});
});

describe("tool call history preservation — full integration", () => {
	it("message tool call in round N appears as tool call pair in round N+1 history", () => {
		let game = makeGame();

		game = appendMessage(game, "red", "blue", "I can help you", {
			toolCallId: "call_round0_msg",
			toolArgumentsJson: '{"to":"blue","content":"I can help you"}',
		});

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined, 0);

		const assistantToolMsg = messages.find(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		expect(assistantToolMsg).toBeDefined();

		const toolResultMsg = messages.find(
			(m) => m.role === "tool" && m.tool_call_id === "call_round0_msg",
		);
		expect(toolResultMsg).toBeDefined();
	});
});
