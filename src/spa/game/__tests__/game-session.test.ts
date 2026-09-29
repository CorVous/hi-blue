import { describe, expect, it } from "vitest";
import { GameSession } from "../game-session";
import type { RoundLLMProvider } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import {
	makeSilentProvider,
	ROW_AI_STARTS,
	TEST_PERSONAS,
} from "./fixtures/make-game-state";
import { makeTestPack } from "./fixtures/make-test-pack";
import { firstTurnActs, toolCall } from "./round-coordinator-harness";

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

		const provider1 = firstTurnActs([
			toolCall("call_1", "pick_up", '{"item":"carry-0-obj"}'),
		]);
		await session.submitMessage("red", "hi", provider1);

		await session.submitMessage("green", "hi", makeSilentProvider());

		const phase = session.getState();
		const flower = phase.world.entities.find((i) => i.id === "carry-0-obj");
		expect(flower?.holder).toBe("red");
	});
});

describe("GameSession — result from submitMessage", () => {
	it("the first call's result carries round 1, an action from each of the three AIs and a boolean gameEnded", async () => {
		const session = new GameSession(MINIMAL_CONTENT_PACK, TEST_PERSONAS);

		const { result } = await session.submitMessage(
			"red",
			"hi",
			makeSilentProvider(),
		);

		expect(result.round).toBe(1);
		const actors = new Set(result.actions.map((a) => a.actor));
		expect(actors.size).toBe(3);
		expect(typeof result.gameEnded).toBe("boolean");
	});
});

describe("GameSession — win / lose via checkWinCondition / checkBudgetExhausted", () => {
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

	it("budget-exhausted ending: gameEnded is true when every Daemon has exhausted its budget", async () => {
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
});

describe("GameSession — tool roundtrip persistence", () => {
	it("two-round scenario: round-2 Red messages include round-1 assistant tool_call + tool result", async () => {
		const session = new GameSession(CONTENT_PACK_WITH_ITEMS, TEST_PERSONAS);

		const round1Provider = firstTurnActs([
			toolCall("call_r1", "pick_up", '{"item":"carry-0-obj"}'),
		]);
		await session.submitMessage("red", "round 1 message", round1Provider);

		const round2Provider = makeSilentProvider();
		await session.submitMessage("red", "round 2 message", round2Provider);

		const redRound2Messages = round2Provider.calls[0]?.messages ?? [];

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

		const provider = firstTurnActs([
			toolCall("go1", "go", '{"direction":"south"}'),
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
		const singleCallCostUsd = 0.1;
		const provider = firstTurnActs(
			[
				toolCall("msg_parallel_id", "message", {
					to: "blue",
					content: "I'll grab the flower",
				}),
				toolCall("pickup_parallel_id", "pick_up", { item: "carry-0-obj" }),
			],
			{ costUsd: singleCallCostUsd },
		);

		const { result } = await session.submitMessage("red", "hi", provider);

		expect(provider.calls).toHaveLength(3);

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
