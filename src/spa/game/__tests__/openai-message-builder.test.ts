import { describe, expect, it } from "vitest";
import { advanceRound, appendMessage, createGame, startPhase } from "../engine";
import {
	buildOpenAiMessages,
	buildSilentTurn,
} from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import type { AiPersona, PhaseConfig, ToolRoundtripMessage } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
		],
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

const PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [0, 0],
	mRange: [0, 0],
	aiGoalPool: ["Hold the flower", "Balance items", "Hold the key"],
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

	it("single player+AI message turn → [system, user, assistant]", () => {
		let game = makeGame();
		game = appendMessage(game, "blue", "red", "Hello Ember!");
		game = appendMessage(game, "red", "blue", "Hello, player!");

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		expect(messages).toHaveLength(3);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]).toEqual({
			role: "user",
			content: "blue: Hello Ember!",
		});
		expect(messages[2]).toEqual({
			role: "assistant",
			content: "Hello, player!",
		});
	});

	it("message history of length N → N pairs after system", () => {
		let game = makeGame();
		for (let i = 0; i < 3; i++) {
			game = appendMessage(game, "blue", "red", `Player msg ${i}`);
			game = appendMessage(game, "red", "blue", `AI msg ${i}`);
		}

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		// 1 system + 6 messages (3 player + 3 AI)
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
		game = appendMessage(game, "blue", "red", "Pick it up!");

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
					argumentsJson: '{"item":"flower","to":"cyan"}',
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

	// Case (a): blue addresses a peer — this Daemon received no messages this round → anchor fires
	it("(a) blue addresses peer, no incoming message for this daemon → silent-turn anchor fires", () => {
		let game = makeGame();
		// Prior round (round 0): red was addressed and replied
		game = appendMessage(game, "blue", "red", "Hi Ember");
		game = appendMessage(game, "red", "blue", "Hi player");

		// Advance to round 1 — now blue addresses green; red gets nothing this round
		game = advanceRound(game);
		const phase = game.phases[game.phases.length - 1]!;
		const currentRound = phase.round; // = 1

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor must fire: no messages for red in round 1
		const last = messages[messages.length - 1];
		expect(last?.role).toBe("user");
		expect((last as { content: string }).content).toBe(buildSilentTurn(ctx));
	});

	// Case (b): peer messages this Daemon, blue silent → no anchor; last user msg is `*<sender>: <content>`
	it("(b) peer messages this daemon this round → no silent-turn anchor, last user msg is peer message", () => {
		let game = makeGame();
		// red receives a message from green this round
		const phase = game.phases[game.phases.length - 1]!;
		const currentRound = phase.round;
		game = appendMessage(game, "green", "red", "psst red");

		const ctx = buildAiContext(game, "red");
		const silent = buildSilentTurn(ctx);
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor must NOT fire
		expect(
			messages.some(
				(m) =>
					m.role === "user" && (m as { content: string }).content === silent,
			),
		).toBe(false);

		// Last user message is the peer message
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		expect((lastUser as { content: string }).content).toBe("*green: psst red");
	});

	// Case (c): blue addresses this Daemon → no anchor; last user msg is `blue: <content>`
	it("(c) blue addresses this daemon → no silent-turn anchor, last user msg is player message", () => {
		let game = makeGame();
		const phase = game.phases[game.phases.length - 1]!;
		const currentRound = phase.round;
		game = appendMessage(game, "blue", "red", "Hi Ember");

		const ctx = buildAiContext(game, "red");
		const silent = buildSilentTurn(ctx);
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor must NOT fire
		expect(
			messages.some(
				(m) =>
					m.role === "user" && (m as { content: string }).content === silent,
			),
		).toBe(false);

		// Last user message is the player message
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		expect((lastUser as { content: string }).content).toBe("blue: Hi Ember");
	});

	it("when `currentRound` is omitted, no anchor is appended (back-compat)", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");
		const silent = buildSilentTurn(ctx);
		const messages = buildOpenAiMessages(ctx, undefined);
		expect(
			messages.some(
				(m) =>
					m.role === "user" && (m as { content: string }).content === silent,
			),
		).toBe(false);
	});

	// Defensive: incoming message stamped with a prior round → anchor still fires for currentRound
	it("incoming message from a prior round does not suppress the anchor for currentRound", () => {
		let game = makeGame();
		// Message appended in round 0
		game = appendMessage(game, "blue", "red", "Prior round message");
		game = appendMessage(game, "red", "blue", "My reply");
		// Advance round so current round is 1 (or whatever advanceRound yields)
		// We simulate this by reading the phase round before any messages in new round
		const phase = game.phases[game.phases.length - 1]!;
		const priorRound = phase.round - 1; // The round the messages above were stamped with

		// Build with priorRound + 1 (current round) — no messages stamped for that round
		const currentRound = phase.round;
		// Sanity: priorRound and currentRound differ only if advanceRound was called.
		// In this test we stay at the same phase without advancing; messages were stamped at phase.round.
		// So currentRound === priorRound + 0 here — we need to use a round number for which no
		// messages exist. We use currentRound + 1 to simulate "next round, no messages yet".
		const futureRound = currentRound + 1;

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined, futureRound);

		// Anchor must fire because no messages are stamped for futureRound
		const last = messages[messages.length - 1];
		expect(last?.role).toBe("user");
		expect((last as { content: string }).content).toBe(buildSilentTurn(ctx));
	});
});
