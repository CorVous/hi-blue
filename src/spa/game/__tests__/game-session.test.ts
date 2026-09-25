import { describe, expect, it } from "vitest";
import type { OpenAiMessage } from "../../llm-client";
import { GameSession } from "../game-session";
import type { RoundLLMProvider } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import {
	makeSilentProvider,
	ROW_AI_STARTS,
	TEST_PERSONAS,
} from "./fixtures/make-game-state";
import { makeTestPack } from "./fixtures/make-test-pack";

const MINIMAL_CONTENT_PACK = makeTestPack([], {
	setting: "test station",
	wallName: "wall",
	aiStarts: ROW_AI_STARTS,
});

const CONTENT_PACK_WITH_ITEMS = makeTestPack(
	[
		{
			id: "carry-0-obj",
			kind: "objective_object",
			name: "flower",
			examineDescription: "A flower",
			holder: { row: 0, col: 0 },
			pairsWithSpaceId: "carry-0-space",
		},
		{
			id: "carry-0-space",
			kind: "objective_space",
			name: "flower space",
			examineDescription: "A designated space",
			holder: { row: 4, col: 4 },
		},
		{
			id: "key",
			kind: "interesting_object",
			name: "key",
			examineDescription: "A key",
			holder: { row: 1, col: 1 },
		},
	],
	{
		setting: "test setting",
		wallName: "wall",
		aiStarts: ROW_AI_STARTS,
	},
);

const CONTENT_PACK_OBJECTIVE_TYPES: import("../types.js").ObjectiveType[] = [
	"carry",
];

describe("GameSession construction", () => {
	it("creates a session with flat game state", () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);
		const state = session.getState();
		expect(state.isComplete).toBe(false);
		expect(state.round).toBe(0);
		expect(state.personas).toEqual(TEST_PERSONAS);
	});

	it("initial budgets are set from the default per-AI budget ($0.50)", () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);
		const phase = session.getState();
		expect(phase.budgets.red?.remaining).toBeCloseTo(0.5, 10);
		expect(phase.budgets.green?.remaining).toBeCloseTo(0.5, 10);
		expect(phase.budgets.cyan?.remaining).toBeCloseTo(0.5, 10);
	});
});

describe("GameSession — message routing", () => {
	it("player message appears in only the addressed AI's message log", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		await session.submitMessage(
			"red",
			"Secret message for Ember",
			makeSilentProvider(),
		);

		const phase = session.getState();
		expect(
			phase.conversationLogs.red?.some(
				(e) =>
					e.kind === "message" &&
					e.from === "blue" &&
					e.content.includes("Secret message for Ember"),
			),
		).toBe(true);
		expect(
			phase.conversationLogs.green?.some(
				(e) => e.kind === "message" && e.from === "blue",
			),
		).toBe(false);
		expect(
			phase.conversationLogs.cyan?.some(
				(e) => e.kind === "message" && e.from === "blue",
			),
		).toBe(false);
	});

	it("routing changes per round — second message goes to different AI", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		await session.submitMessage("red", "for red", makeSilentProvider());
		await session.submitMessage("green", "for green", makeSilentProvider());

		const phase = session.getState();
		expect(
			phase.conversationLogs.green?.some(
				(e) =>
					e.kind === "message" &&
					e.from === "blue" &&
					e.content.includes("for green"),
			),
		).toBe(true);
		expect(
			phase.conversationLogs.red?.filter(
				(e) => e.kind === "message" && e.from === "blue",
			),
		).toHaveLength(1);
	});
});

describe("GameSession — state mutation across rounds", () => {
	it("round counter advances after each submitMessage call", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		await session.submitMessage("red", "hi", makeSilentProvider());
		expect(session.getState().round).toBe(1);

		await session.submitMessage("green", "hi", makeSilentProvider());
		expect(session.getState().round).toBe(2);
	});

	it("budget decrements for all AIs by the round's request cost", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
			{ assistantText: "", toolCalls: [], costUsd: 0.1 },
		]);
		await session.submitMessage("red", "hi", provider);

		const phase = session.getState();
		expect(phase.budgets.red?.remaining).toBeCloseTo(0.4, 10);
		expect(phase.budgets.green?.remaining).toBeCloseTo(0.4, 10);
		expect(phase.budgets.cyan?.remaining).toBeCloseTo(0.4, 10);
	});

	it("second round builds on first round's state", async () => {
		const session = new GameSession(CONTENT_PACK_WITH_ITEMS, TEST_PERSONAS);

		const provider1 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_1",
						name: "pick_up",
						argumentsJson: '{"item":"carry-0-obj"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		await session.submitMessage("red", "hi", provider1);

		await session.submitMessage("green", "hi", makeSilentProvider());

		const phase = session.getState();
		const flower = phase.world.entities.find((i) => i.id === "carry-0-obj");
		expect(flower?.holder).toBe("red");
	});
});

describe("GameSession — completions map", () => {
	it("completions map contains the completion text for each AI", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "I am Ember",
				toolCalls: [
					{
						id: "msg_r",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "I am Ember",
						}),
					},
				],
			},
			{
				assistantText: "I am Sage",
				toolCalls: [
					{
						id: "msg_g",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "I am Sage",
						}),
					},
				],
			},
			{
				assistantText: "I am Frost",
				toolCalls: [
					{
						id: "msg_c",
						name: "message",
						argumentsJson: JSON.stringify({
							to: "blue",
							content: "I am Frost",
						}),
					},
				],
			},
		]);

		const { completions } = await session.submitMessage("red", "hi", provider);

		expect(completions.red).toContain("Ember");
		expect(completions.green).toContain("Sage");
		expect(completions.cyan).toContain("Frost");
	});

	it("completions map has empty string for a budget-locked AI", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		const exhaustProvider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		await session.submitMessage("red", "round 1", exhaustProvider);

		const { completions } = await session.submitMessage(
			"red",
			"round 2",
			makeSilentProvider(),
		);

		expect(completions.red).toBe("");
		expect(completions.green).toBe("");
		expect(completions.cyan).toBe("");
	});

	it("completions only for non-locked AIs are non-empty", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "red says", toolCalls: [] },
			{ assistantText: "green says", toolCalls: [] },
			{ assistantText: "cyan says", toolCalls: [] },
		]);

		const { completions } = await session.submitMessage("red", "hi", provider);

		expect(completions.red).not.toBe("");
		expect(completions.green).not.toBe("");
		expect(completions.cyan).not.toBe("");
	});
});

describe("GameSession — result from submitMessage", () => {
	it("result.round is 1 after the first call", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makeSilentProvider(),
		);
		expect(result.round).toBe(1);
	});

	it("result.actions contains entries from all three AIs", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makeSilentProvider(),
		);

		const actors = new Set(result.actions.map((a) => a.actor));
		expect(actors.size).toBe(3);
	});

	it("result object from submitMessage is always well-formed", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);
		const { result } = await session.submitMessage(
			"red",
			"hi",
			makeSilentProvider(),
		);
		expect(typeof result.round).toBe("number");
		expect(Array.isArray(result.actions)).toBe(true);
		expect(typeof result.gameEnded).toBe("boolean");
	});
});

describe("GameSession — win / lose via checkWinCondition / checkLoseCondition", () => {
	it("gameEnded is false when objective pairs are not satisfied", async () => {
		const session = new GameSession(
			CONTENT_PACK_WITH_ITEMS,
			TEST_PERSONAS,
			undefined,
			undefined,
			undefined,
			CONTENT_PACK_OBJECTIVE_TYPES,
		);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makeSilentProvider(),
		);
		expect(result.gameEnded).toBe(false);
	});

	it("gameEnded is true when all objective pairs are satisfied (vacuous K=0)", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makeSilentProvider(),
		);
		expect(result.gameEnded).toBe(true);
	});

	it("lose condition: gameEnded is true when all AIs are locked out", async () => {
		const session = new GameSession(CONTENT_PACK_WITH_ITEMS, TEST_PERSONAS);
		const exhaustProvider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			exhaustProvider,
		);
		expect(result.gameEnded).toBe(true);
	});
});

describe("GameSession — onAiDelta propagation", () => {
	it("fires onAiDelta for each delta emitted by a live provider", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		let callIdx = 0;
		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("chunk1 ");
				onDelta?.("chunk2");
				const id = `msg_${callIdx++}`;
				return {
					assistantText: "chunk1 chunk2",
					toolCalls: [
						{
							id,
							name: "message",
							argumentsJson: JSON.stringify({
								to: "blue",
								content: "chunk1 chunk2",
							}),
						},
					],
				};
			},
		};

		const received: Array<[string, string]> = [];
		await session.submitMessage(
			"red",
			"hi",
			liveProvider,
			["red", "green", "cyan"],
			(aiId, text) => {
				received.push([aiId, text]);
			},
		);

		expect(received).toHaveLength(6);
		expect(received[0]).toEqual(["red", "chunk1 "]);
		expect(received[1]).toEqual(["red", "chunk2"]);
		expect(received[2]).toEqual(["green", "chunk1 "]);
		expect(received[3]).toEqual(["green", "chunk2"]);
		expect(received[4]).toEqual(["cyan", "chunk1 "]);
		expect(received[5]).toEqual(["cyan", "chunk2"]);
	});

	it("does not invoke onAiDelta when MockRoundLLMProvider is used", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "hello", toolCalls: [] },
			{ assistantText: "world", toolCalls: [] },
			{ assistantText: "foo", toolCalls: [] },
		]);

		const received: Array<[string, string]> = [];
		await session.submitMessage(
			"red",
			"hi",
			provider,
			undefined,
			(aiId, text) => {
				received.push([aiId, text]);
			},
		);

		expect(received).toHaveLength(0);
	});
});

describe("GameSession — tool roundtrip persistence", () => {
	it("two-round scenario: round-2 Red messages include round-1 assistant tool_call + tool result", async () => {
		const session = new GameSession(CONTENT_PACK_WITH_ITEMS, TEST_PERSONAS);

		const round1Provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_r1",
						name: "pick_up",
						argumentsJson: '{"item":"carry-0-obj"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		await session.submitMessage("red", "round 1 message", round1Provider);

		const capturedMessages: OpenAiMessage[][] = [];
		const trackingProvider: RoundLLMProvider = {
			async streamRound(messages, _tools) {
				capturedMessages.push(messages);
				return { assistantText: "", toolCalls: [] };
			},
		};
		await session.submitMessage("red", "round 2 message", trackingProvider);

		const redRound2Messages = capturedMessages[0] ?? [];

		const assistantWithToolCalls = redRound2Messages.find(
			(
				m,
			): m is Extract<
				typeof m,
				{ role: "assistant"; tool_calls?: unknown[] }
			> =>
				m.role === "assistant" &&
				"tool_calls" in m &&
				Array.isArray((m as Record<string, unknown>).tool_calls),
		);
		expect(assistantWithToolCalls).toBeDefined();
		if (
			assistantWithToolCalls?.role === "assistant" &&
			assistantWithToolCalls.tool_calls
		) {
			expect(assistantWithToolCalls.tool_calls[0]).toMatchObject({
				id: "call_r1",
				function: { name: "pick_up" },
			});
		}

		const toolResult = redRound2Messages.find((m) => m.role === "tool");
		expect(toolResult).toBeDefined();
		if (toolResult?.role === "tool") {
			expect(toolResult.tool_call_id).toBe("call_r1");
		}
	});
});

describe("GameSession — spatial mechanics", () => {
	it("go updates personaSpatial position across rounds", async () => {
		const session = new GameSession(CONTENT_PACK_WITH_ITEMS, TEST_PERSONAS);
		const phase0 = session.getState();
		expect(phase0.personaSpatial.red).toEqual({ position: { row: 0, col: 0 } });

		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{ id: "go1", name: "go", argumentsJson: '{"direction":"south"}' },
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		await session.submitMessage("red", "hi", provider);

		const phase = session.getState();
		expect(phase.personaSpatial.red).toEqual({ position: { row: 1, col: 0 } });
	});
});

describe("parallel tool calls integration (#238)", () => {
	it("Daemon emitting [msg, pick_up] in one provider call produces both outputs; cost is single-call valued", async () => {
		const session = new GameSession(CONTENT_PACK_WITH_ITEMS, TEST_PERSONAS);

		const startingBudgetUsd = 0.5;
		const singleCallCostUsd = 1;
		let providerCallCount = 0;
		const trackingProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools) {
				providerCallCount++;
				const isRedFirstInDefaultOrder = providerCallCount === 1;
				if (isRedFirstInDefaultOrder) {
					return {
						assistantText: "",
						toolCalls: [
							{
								id: "msg_parallel_id",
								name: "message",
								argumentsJson: JSON.stringify({
									to: "blue",
									content: "I'll grab the flower",
								}),
							},
							{
								id: "pickup_parallel_id",
								name: "pick_up",
								argumentsJson: JSON.stringify({ item: "carry-0-obj" }),
							},
						],
						costUsd: singleCallCostUsd,
					};
				}
				return { assistantText: "", toolCalls: [], costUsd: 0 };
			},
		};

		const { result } = await session.submitMessage(
			"red",
			"hi",
			trackingProvider,
		);

		expect(providerCallCount).toBe(3);

		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(redActions.some((a) => a.kind === "message")).toBe(true);
		expect(redActions.some((a) => a.kind === "tool_success")).toBe(true);

		const phase = session.getState();
		expect(phase.budgets.red?.remaining).toBeCloseTo(
			startingBudgetUsd - singleCallCostUsd,
			10,
		);

		const flower = phase.world.entities.find((e) => e.id === "carry-0-obj");
		expect(flower?.holder).toBe("red");

		const redLog = phase.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("I'll grab the flower"),
			),
		).toBe(true);
	});
});
