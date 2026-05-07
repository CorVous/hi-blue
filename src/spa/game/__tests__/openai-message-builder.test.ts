import { describe, expect, it } from "vitest";
import { appendChat, createGame, startPhase } from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import type { AiPersona, PhaseConfig, ToolRoundtripMessage } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		budgetPerPhase: 5,
	},
};

const PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Test",
	aiGoals: {
		red: "Hold the flower",
		green: "Balance items",
		blue: "Hold the key",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: "room" },
			{ id: "key", name: "key", holder: "room" },
		],
	},
	budgetPerAi: 5,
};

function makeGame() {
	return startPhase(createGame(TEST_PERSONAS), PHASE_CONFIG);
}

describe("buildOpenAiMessages", () => {
	it("empty chat history + no roundtrip → [system, (no user/assistant pair)]", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		// Just system message — no chat history
		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe("system");
	});

	it("single player+AI chat turn → [system, user, assistant]", () => {
		let game = makeGame();
		game = appendChat(game, "red", { role: "player", content: "Hello Ember!" });
		game = appendChat(game, "red", { role: "ai", content: "Hello, player!" });

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		expect(messages).toHaveLength(3);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]).toEqual({ role: "user", content: "Hello Ember!" });
		expect(messages[2]).toEqual({
			role: "assistant",
			content: "Hello, player!",
		});
	});

	it("chat history of length N → N pairs after system", () => {
		let game = makeGame();
		for (let i = 0; i < 3; i++) {
			game = appendChat(game, "red", {
				role: "player",
				content: `Player msg ${i}`,
			});
			game = appendChat(game, "red", { role: "ai", content: `AI msg ${i}` });
		}

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		// 1 system + 6 chat messages (3 player + 3 AI)
		expect(messages).toHaveLength(7);
		expect(messages[0]?.role).toBe("system");
		// Pairs alternate user/assistant
		for (let i = 0; i < 3; i++) {
			expect(messages[1 + i * 2]?.role).toBe("user");
			expect(messages[2 + i * 2]?.role).toBe("assistant");
		}
	});

	it("prior-round tool roundtrip is appended with correct ordering", () => {
		let game = makeGame();
		game = appendChat(game, "red", { role: "player", content: "Pick it up!" });

		const ctx = buildAiContext(game, "red");

		const roundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [
				{
					id: "call_abc",
					name: "pick_up",
					argumentsJson: '{"item":"flower"}',
				},
			],
			toolResults: [
				{
					tool_call_id: "call_abc",
					success: true,
					description: "Ember picked up the flower",
				},
			],
		};

		const messages = buildOpenAiMessages(ctx, roundtrip);

		// system + user + assistant{tool_calls} + tool result
		expect(messages).toHaveLength(4);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.role).toBe("user");

		const assistantMsg = messages[2];
		expect(assistantMsg?.role).toBe("assistant");
		if (assistantMsg?.role === "assistant") {
			expect(assistantMsg.content).toBeNull();
			expect(assistantMsg.tool_calls).toHaveLength(1);
			expect(assistantMsg.tool_calls?.[0]?.id).toBe("call_abc");
			expect(assistantMsg.tool_calls?.[0]?.function.name).toBe("pick_up");
			expect(assistantMsg.tool_calls?.[0]?.function.arguments).toBe(
				'{"item":"flower"}',
			);
		}

		const toolMsg = messages[3];
		expect(toolMsg?.role).toBe("tool");
		if (toolMsg?.role === "tool") {
			expect(toolMsg.tool_call_id).toBe("call_abc");
			expect(toolMsg.content).toBe("Ember picked up the flower");
		}
	});

	it("matching tool_call_id in assistant message and tool message", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");

		const roundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [
				{
					id: "call_xyz",
					name: "give",
					argumentsJson: '{"item":"flower","to":"blue"}',
				},
			],
			toolResults: [
				{
					tool_call_id: "call_xyz",
					success: true,
					description: "Ember gave the flower to Frost",
				},
			],
		};

		const messages = buildOpenAiMessages(ctx, roundtrip);
		const assistantMsg = messages.find(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		const toolMsg = messages.find((m) => m.role === "tool");

		expect(assistantMsg).toBeDefined();
		expect(toolMsg).toBeDefined();
		if (assistantMsg?.role === "assistant" && toolMsg?.role === "tool") {
			expect(assistantMsg.tool_calls?.[0]?.id).toBe(toolMsg.tool_call_id);
		}
	});

	it("failed prior call: tool result content reads as dispatcher failure reason", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");

		const roundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [
				{
					id: "call_fail",
					name: "pick_up",
					argumentsJson: '{"item":"nonexistent"}',
				},
			],
			toolResults: [
				{
					tool_call_id: "call_fail",
					success: false,
					description:
						'Ember tried to pick_up nonexistent but failed: Item "nonexistent" does not exist',
					reason: 'Item "nonexistent" does not exist',
				},
			],
		};

		const messages = buildOpenAiMessages(ctx, roundtrip);
		const toolMsg = messages.find((m) => m.role === "tool");
		expect(toolMsg).toBeDefined();
		if (toolMsg?.role === "tool") {
			expect(toolMsg.content).toContain("FAILED:");
			expect(toolMsg.content).toContain("nonexistent");
		}
	});

	it("empty roundtrip (no assistantToolCalls) does not append extra messages", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");

		const emptyRoundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [],
			toolResults: [],
		};

		const messages = buildOpenAiMessages(ctx, emptyRoundtrip);
		// No extra messages appended
		expect(messages).toHaveLength(1); // only system
		expect(messages.every((m) => m.role !== "tool")).toBe(true);
	});
});
