import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import {
	advanceRound,
	appendActionFailure,
	appendMessage,
	startGame,
} from "../engine";
import {
	buildOpenAiMessages,
	buildSilentTurn,
} from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import type { AiPersona, ContentPack, ToolRoundtripMessage } from "../types";

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
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
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
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
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
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

const TEST_CONTENT_PACK: ContentPack = {
	setting: "",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	wallName: "wall",
	aiStarts: {},
};

function makeGame() {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
}

describe("buildOpenAiMessages", () => {
	it("empty chat history + no roundtrip → [system, current-state user turn]", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		// system + trailing current-state user turn (always last)
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.role).toBe("user");
		expect((messages[1] as { content: string }).content).toBe(
			ctx.toCurrentStateUserMessage(),
		);
	});

	it("single player+AI message turn → [system, user, assistant, current-state]", () => {
		let game = makeGame();
		game = appendMessage(game, "blue", "red", "Hello Ember!");
		game = appendMessage(game, "red", "blue", "Hello, player!");

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		expect(messages).toHaveLength(4);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]).toEqual({
			role: "user",
			content: "[Round 0] blue dms you: Hello Ember!",
		});
		// Outgoing assistant turn is prefixed with "[Round N] you dm <toLabel>:"
		// so the Daemon can track who it addressed across the whole game (not
		// just on the round immediately after).
		expect(messages[2]).toEqual({
			role: "assistant",
			content: "[Round 0] you dm blue: Hello, player!",
		});
		// Trailing current-state turn
		expect(messages[3]?.role).toBe("user");
		expect((messages[3] as { content: string }).content).toBe(
			ctx.toCurrentStateUserMessage(),
		);
	});

	it("message history of length N → N pairs after system, then current-state", () => {
		let game = makeGame();
		for (let i = 0; i < 3; i++) {
			game = appendMessage(game, "blue", "red", `Player msg ${i}`);
			game = appendMessage(game, "red", "blue", `AI msg ${i}`);
		}

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		// 1 system + 6 messages (3 player + 3 AI) + 1 trailing current-state
		expect(messages).toHaveLength(8);
		expect(messages[0]?.role).toBe("system");
		// Pairs alternate user/assistant
		for (let i = 0; i < 3; i++) {
			expect(messages[1 + i * 2]?.role).toBe("user");
			expect(messages[2 + i * 2]?.role).toBe("assistant");
		}
		// Last message is the current-state user turn
		expect(messages[7]?.role).toBe("user");
		expect((messages[7] as { content: string }).content).toBe(
			ctx.toCurrentStateUserMessage(),
		);
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

		// system + user(blue msg) + assistant{tool_calls} + tool result + trailing current-state
		expect(messages).toHaveLength(5);
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

		// Trailing current-state turn
		expect(messages[4]?.role).toBe("user");
		expect((messages[4] as { content: string }).content).toBe(
			ctx.toCurrentStateUserMessage(),
		);
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
		// system + trailing current-state user turn (always emitted)
		expect(messages).toHaveLength(2);
		expect(messages[0]?.role).toBe("system");
		expect(messages[1]?.role).toBe("user");
		expect(messages.every((m) => m.role !== "tool")).toBe(true);
	});

	// The current-state user turn is always last (carries <where_you_are> +
	// <what_you_see>). The silent-turn anchor, when it fires, sits immediately
	// before that — i.e. second-to-last.

	// Case (a): blue addresses a peer — this Daemon received no messages this round → anchor fires
	it("(a) blue addresses peer, no incoming message for this daemon → silent-turn anchor fires (second-to-last)", () => {
		let game = makeGame();
		// Prior round (round 0): red was addressed and replied
		game = appendMessage(game, "blue", "red", "Hi Ember");
		game = appendMessage(game, "red", "blue", "Hi player");

		// Advance to round 1 — now blue addresses green; red gets nothing this round
		game = advanceRound(game);
		const currentRound = game.round; // = 1

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor sits immediately before the trailing current-state turn
		const anchor = messages[messages.length - 2];
		expect(anchor?.role).toBe("user");
		expect((anchor as { content: string }).content).toBe(buildSilentTurn());

		// Last is the current-state turn
		const last = messages[messages.length - 1];
		expect((last as { content: string }).content).toBe(
			ctx.toCurrentStateUserMessage(),
		);
	});

	// Case (b): peer messages this Daemon, blue silent → no anchor; last *non-state* user msg is the peer message
	it("(b) peer messages this daemon this round → no silent-turn anchor, last conversational user msg is peer message", () => {
		let game = makeGame();
		// red receives a message from green this round
		const currentRound = game.round;
		game = appendMessage(game, "green", "red", "psst red");

		const ctx = buildAiContext(game, "red");
		const silent = buildSilentTurn();
		const stateContent = ctx.toCurrentStateUserMessage();
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor must NOT fire
		expect(
			messages.some(
				(m) =>
					m.role === "user" && (m as { content: string }).content === silent,
			),
		).toBe(false);

		// The last non-state user turn is the peer message (state turn is at the very end)
		const conversationalUserTurns = messages.filter(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content !== stateContent,
		);
		const lastConversational =
			conversationalUserTurns[conversationalUserTurns.length - 1];
		expect((lastConversational as { content: string }).content).toBe(
			"[Round 0] *green dms you: psst red",
		);
	});

	// Case (c): blue addresses this Daemon → no anchor; last *non-state* user msg is `blue: <content>`
	it("(c) blue addresses this daemon → no silent-turn anchor, last conversational user msg is player message", () => {
		let game = makeGame();
		const currentRound = game.round;
		game = appendMessage(game, "blue", "red", "Hi Ember");

		const ctx = buildAiContext(game, "red");
		const silent = buildSilentTurn();
		const stateContent = ctx.toCurrentStateUserMessage();
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor must NOT fire
		expect(
			messages.some(
				(m) =>
					m.role === "user" && (m as { content: string }).content === silent,
			),
		).toBe(false);

		const conversationalUserTurns = messages.filter(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content !== stateContent,
		);
		const lastConversational =
			conversationalUserTurns[conversationalUserTurns.length - 1];
		expect((lastConversational as { content: string }).content).toBe(
			"[Round 0] blue dms you: Hi Ember",
		);
	});

	it("when `currentRound` is omitted, no anchor is appended (back-compat)", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");
		const silent = buildSilentTurn();
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
		// Round 0: red receives a message from blue
		game = appendMessage(game, "blue", "red", "Prior round message");
		game = appendMessage(game, "red", "blue", "My reply");

		// Advance to round 1 — red gets nothing this round
		game = advanceRound(game);
		const currentRound = game.round;

		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined, currentRound);

		// Anchor sits immediately before the trailing current-state turn
		const anchor = messages[messages.length - 2];
		expect(anchor?.role).toBe("user");
		expect((anchor as { content: string }).content).toBe(buildSilentTurn());
	});

	// Pinned regression: rendering the same context twice must produce
	// byte-identical output. This proves `buildOpenAiMessages` itself is
	// pure (Array.sort is stable, the renderEntry path has no
	// nondeterminism), but it does NOT defend against the upstream concern
	// — `ctx.conversationLog` arriving in different orders on different
	// requests. That risk would require a per-entry sequence number on
	// ConversationEntry to fix properly (so within-round ties have a
	// stable key beyond array insertion order); the engine currently
	// constructs the array deterministically via `appendMessage`, so the
	// risk is latent. Tracked alongside the prompt-cache cleanup work.
	it("buildOpenAiMessages is pure: same context → byte-identical output", () => {
		let game = makeGame();
		// A non-trivial mix: incoming, outgoing, peer, and multiple rounds.
		game = appendMessage(game, "blue", "red", "hi");
		game = appendMessage(game, "red", "blue", "hi back");
		game = appendMessage(game, "green", "red", "psst");
		game = advanceRound(game);
		game = appendMessage(game, "blue", "red", "round two");
		game = appendMessage(game, "red", "cyan", "side channel");

		const ctx = buildAiContext(game, "red");
		const a = buildOpenAiMessages(ctx, undefined, 1);
		const b = buildOpenAiMessages(ctx, undefined, 1);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	// Cache-correctness invariant: the system prompt for a (persona × phase)
	// must be byte-identical across rounds, since OpenRouter's prefix cache
	// hashes the literal request bytes. Any drift here silently busts caching.
	it("system prompt is byte-stable across rounds within a phase", () => {
		let game = makeGame();
		const round0Prompt = buildAiContext(game, "red").toSystemPrompt();

		// Advance through a few rounds, with messages and no spatial moves.
		// Spatial moves don't matter for the system prompt (where_you_are
		// lives in the trailing user turn now), but they would have busted
		// the prefix in the pre-restructure code path.
		game = appendMessage(game, "blue", "red", "round 0 chatter");
		game = advanceRound(game);
		game = appendMessage(game, "blue", "red", "round 1 chatter");
		game = advanceRound(game);
		const round2Prompt = buildAiContext(game, "red").toSystemPrompt();

		expect(round2Prompt).toBe(round0Prompt);
	});
});

// ----------------------------------------------------------------------------
// Multi-id roundtrip shapes (issue #238 parallel tool calls)
// ----------------------------------------------------------------------------
describe("multi-id roundtrip replay shapes (#238)", () => {
	// Test: N=2 assistantToolCalls produces the correct message ordering:
	// [..., assistant{tool_calls:[a,b]}, tool{a-result}, tool{b-result}, ...]
	it("roundtrip with 2 assistantToolCalls produces assistant{tool_calls:[a,b]} + 2 tool messages", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");

		const roundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [
				{ id: "call_a", name: "pick_up", argumentsJson: '{"item":"flower"}' },
				{ id: "call_b", name: "go", argumentsJson: '{"direction":"back"}' },
			],
			toolResults: [
				{
					tool_call_id: "call_a",
					success: true,
					description: "Ember picked up the flower",
				},
				{
					tool_call_id: "call_b",
					success: false,
					description: "Ember tried to go but failed: blocked",
					reason: "blocked",
				},
			],
		};

		const messages = buildOpenAiMessages(ctx, roundtrip);

		// Find the assistant message with tool_calls
		const assistantToolMsg = messages.find(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		expect(assistantToolMsg).toBeDefined();
		if (assistantToolMsg?.role === "assistant") {
			expect(assistantToolMsg.tool_calls).toHaveLength(2);
			expect(assistantToolMsg.tool_calls?.[0]?.id).toBe("call_a");
			expect(assistantToolMsg.tool_calls?.[1]?.id).toBe("call_b");
		}

		// Both tool results follow, in order
		const toolMsgs = messages.filter((m) => m.role === "tool");
		expect(toolMsgs).toHaveLength(2);
		if (toolMsgs[0]?.role === "tool" && toolMsgs[1]?.role === "tool") {
			expect(toolMsgs[0].tool_call_id).toBe("call_a");
			expect(toolMsgs[0].content).toBe("Ember picked up the flower");
			expect(toolMsgs[1].tool_call_id).toBe("call_b");
			// Failed result is prefixed with FAILED:
			expect(toolMsgs[1].content).toMatch(/^FAILED:/);
			expect(toolMsgs[1].content).toContain("blocked");
		}

		// assistant{tool_calls} is immediately followed by the first tool message
		const assistantIdx = assistantToolMsg
			? messages.indexOf(assistantToolMsg)
			: -1;
		expect(assistantIdx).toBeGreaterThanOrEqual(0);
		const firstToolMsg = messages[assistantIdx + 1];
		expect(firstToolMsg?.role).toBe("tool");

		// The two tool messages are consecutive (assistant{tool_calls}, tool{a}, tool{b})
		expect(messages[assistantIdx + 2]?.role).toBe("tool");
	});

	// Row 4 shape: first fail + second success (msg-fail + action-success)
	it("roundtrip with [msg-fail, action-success] produces both tool messages with correct success flags", () => {
		const game = makeGame();
		const ctx = buildAiContext(game, "red");

		const roundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [
				{
					id: "msg_fail_id",
					name: "message",
					argumentsJson: '{"to":"nobody","content":"hi"}',
				},
				{
					id: "pickup_id",
					name: "pick_up",
					argumentsJson: '{"item":"flower"}',
				},
			],
			toolResults: [
				{
					tool_call_id: "msg_fail_id",
					success: false,
					description:
						"Ember tried to message nobody but failed: unknown or invalid recipient",
				},
				{
					tool_call_id: "pickup_id",
					success: true,
					description: "Ember picked up the flower",
				},
			],
		};

		const messages = buildOpenAiMessages(ctx, roundtrip);

		const toolMsgs = messages.filter((m) => m.role === "tool");
		expect(toolMsgs).toHaveLength(2);

		if (toolMsgs[0]?.role === "tool" && toolMsgs[1]?.role === "tool") {
			// Message failure comes first, prefixed with FAILED:
			expect(toolMsgs[0].tool_call_id).toBe("msg_fail_id");
			expect(toolMsgs[0].content).toMatch(/^FAILED:/);

			// Action success comes second
			expect(toolMsgs[1].tool_call_id).toBe("pickup_id");
			expect(toolMsgs[1].content).toBe("Ember picked up the flower");
		}
	});

	// Row 3 wire shape: [msg-success, action] produces two consecutive assistant turns.
	//
	// In the row-3 case, the round-coordinator EXCLUDES the successful message call
	// from the roundtrip (per ADR 0007 — it replays via conversationLog as
	// assistant{content}). The action call DOES go in the roundtrip. This means
	// the next round's message array has:
	//   assistant{content: "<msg>"} — from conversationLog
	//   assistant{tool_calls:[actionId]} — from roundtrip
	//   tool{actionId, result}
	//
	// Two consecutive assistant turns is intentional and OpenAI-spec-permitted
	// (the strict pairing rule is only that tool_calls → matching tool results
	// directly after). Do NOT generalize the #213 invariant ("no consecutive
	// assistant turns for message-only turns") to this case.
	it("row-3 wire shape: conversationLog msg + roundtrip action produces consecutive assistant turns (intentional)", () => {
		let game = makeGame();
		// Simulate a prior round where red sent a message to blue (goes in conversationLog)
		game = appendMessage(game, "red", "blue", "I'll grab the flower");

		const ctx = buildAiContext(game, "red");

		// The roundtrip carries ONLY the action call (msg-success excluded per ADR 0007)
		const roundtrip: ToolRoundtripMessage = {
			assistantToolCalls: [
				{
					id: "pickup_r3_id",
					name: "pick_up",
					argumentsJson: '{"item":"flower"}',
				},
			],
			toolResults: [
				{
					tool_call_id: "pickup_r3_id",
					success: true,
					description: "Ember picked up the flower",
				},
			],
		};

		const messages = buildOpenAiMessages(ctx, roundtrip);

		// The conversation log assistant turn (message body) appears first
		const assistantContentMsg = messages.find(
			(m) =>
				m.role === "assistant" &&
				"content" in m &&
				typeof (m as { content?: unknown }).content === "string" &&
				(m as { content: string }).content.includes("I'll grab the flower"),
		);
		expect(assistantContentMsg).toBeDefined();

		// The roundtrip assistant{tool_calls} turn appears after it
		const assistantToolMsg = messages.find(
			(m) => m.role === "assistant" && "tool_calls" in m,
		);
		expect(assistantToolMsg).toBeDefined();

		const contentIdx = assistantContentMsg
			? messages.indexOf(assistantContentMsg)
			: -1;
		const toolIdx = assistantToolMsg ? messages.indexOf(assistantToolMsg) : -1;
		expect(contentIdx).toBeLessThan(toolIdx);

		// INTENTIONAL: these two assistant turns are consecutive (no user turn between them).
		// This is correct for row-3 because the conversation log entry and the roundtrip
		// are from the same AI turn but are separate message-protocol constructs.
		// Note: the #213 invariant ("no consecutive assistant turns") applies ONLY to
		// message-only turns where no roundtrip is recorded. In the row-3 case, two
		// consecutive assistant turns are correct and expected.
		expect(messages[contentIdx + 1]).toBe(assistantToolMsg);

		// The tool result follows immediately after the assistant{tool_calls}
		const toolMsg = messages[toolIdx + 1];
		expect(toolMsg?.role).toBe("tool");
		if (toolMsg?.role === "tool") {
			expect(toolMsg.tool_call_id).toBe("pickup_r3_id");
		}
	});
});

// ── action-failure emission (issue #287) ──────────────────────────────────────

describe("buildOpenAiMessages — action-failure entries", () => {
	it("action-failure entry is emitted as role: 'user' with rendered content", () => {
		let game = makeGame();
		game = appendActionFailure(game, "red", {
			kind: "action-failure",
			round: 0,
			tool: "go",
			reason: "That cell is blocked by an obstacle",
		});
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		const failureMsg = messages.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.includes("action failed"),
		);
		expect(failureMsg).toBeDefined();
		expect((failureMsg as { content: string }).content).toContain(
			"Your `go` action failed",
		);
		expect((failureMsg as { content: string }).content).toContain(
			"That cell is blocked by an obstacle",
		);
	});

	it("action-failure entries interleave with message and witnessed-event entries by round (stable sort)", () => {
		let game = makeGame();
		// Round 0: action-failure
		game = appendActionFailure(game, "red", {
			kind: "action-failure",
			round: 0,
			tool: "go",
			reason: "blocked",
		});
		// Round 1: incoming message from blue
		game = advanceRound(game);
		game = appendMessage(game, "blue", "red", "round 1 msg");
		// Back to check ordering
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx, undefined);

		// The action-failure (round 0) user turn should appear before the message (round 1) user turn
		const failureIdx = messages.findIndex(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.includes("action failed"),
		);
		const messageIdx = messages.findIndex(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.includes("round 1 msg"),
		);
		expect(failureIdx).toBeGreaterThanOrEqual(0);
		expect(messageIdx).toBeGreaterThanOrEqual(0);
		expect(failureIdx).toBeLessThan(messageIdx);
	});

	it("regression: existing prior-round FAILED: tool-result tests still pass — action-failure does not replace tool result channel", () => {
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
		}
	});
});
