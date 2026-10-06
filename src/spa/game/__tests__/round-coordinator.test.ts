import { describe, expect, it } from "vitest";
import type { OpenAiMessage } from "../../llm-client";
import { isPlayerChatLockedOut } from "../complication-engine";
import {
	deductBudget,
	FAREWELL_LINE,
	isDaemonExhausted,
	startGame,
} from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import type { RoundLLMProvider } from "../round-llm-provider";
import { MockRoundLLMProvider } from "../round-llm-provider";
import { encodeRoundResult } from "../round-result-encoder";
import type {
	AiId,
	ContentPack,
	GameState,
	PersonaSpatialState,
	UseItemObjective,
	WorldEntity,
} from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	ROW_AI_STARTS,
	seededRng,
	TEST_PERSONAS,
	withCountdownZero,
} from "./fixtures/make-game-state";
import { makeTestPack } from "./fixtures/make-test-pack";
import { firstTurnActs, toolCall } from "./round-coordinator-harness";

const TEST_CONTENT_PACK = makeTestPack(
	[
		{
			id: "flower",
			kind: "objective_object",
			name: "flower",
			examineDescription: "A flower",
			holder: { row: 0, col: 0 },
			pairsWithSpaceId: "flower_space",
		},
		{
			id: "flower_space",
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
			holder: { row: 0, col: 1 },
		},
	],
	{ wallName: "wall", aiStarts: ROW_AI_STARTS },
);

const CHAT_LOCKOUT_DRAWS = [0.7, 0, 0, 0];

function makeGame(budgetPerAi = 5) {
	return makeTestGame({ pack: TEST_CONTENT_PACK, budgetPerAi });
}

function toolCallIdsIn(messages: OpenAiMessage[]): string[] {
	return messages.flatMap((m) =>
		m.role === "assistant" && "tool_calls" in m && m.tool_calls
			? m.tool_calls.map((tc) => tc.id)
			: [],
	);
}

function toolResultIdsIn(messages: OpenAiMessage[]): string[] {
	return messages.flatMap((m) =>
		m.role === "tool" && "tool_call_id" in m ? [m.tool_call_id] : [],
	);
}

async function redRound2Messages(
	round1Calls: Array<{ id: string; name: string; argumentsJson: string }>,
): Promise<OpenAiMessage[]> {
	const r1 = await runRound(
		makeGame(),
		"red",
		"hi",
		firstTurnActs(round1Calls),
		{ initiative: ["red", "green", "cyan"] as AiId[] },
	);
	const captured: OpenAiMessage[][] = [];
	const r2Provider: RoundLLMProvider = {
		async streamRound(messages) {
			captured.push(messages);
			return { assistantText: "", toolCalls: [] };
		},
	};
	await runRound(r1.nextState, "red", "round2", r2Provider, {
		initiative: ["red", "green", "cyan"] as AiId[],
		priorToolRoundtrip: r1.toolRoundtrip,
	});
	return captured[0] ?? [];
}

describe("chat-only round", () => {
	it("advances the round counter after all three AIs act", async () => {
		const game = makeGame();
		const provider = firstTurnActs([], { assistantText: "Hello player" });
		const { nextState } = await runRound(game, "red", "Hello!", provider);
		expect(nextState.round).toBe(1);
	});

	it("free-form assistantText (no message tool call) does not appear in the AI's log", async () => {
		const game = makeGame();
		const provider = firstTurnActs([], { assistantText: "I am Ember" });
		const { nextState } = await runRound(game, "red", "Hello Ember!", provider);
		const redLog = nextState.conversationLogs.red ?? [];
		const msgEntries = redLog.filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(msgEntries).toHaveLength(0);
	});

	it("appends the player's message to the addressed AI's history as a 'message' entry", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { nextState } = await runRound(
			game,
			"red",
			"My secret message",
			provider,
		);
		const redLog = nextState.conversationLogs.red ?? [];
		const blueMessages = redLog.filter(
			(e) => e.kind === "message" && e.from === "blue",
		);
		expect(blueMessages).toHaveLength(1);
		expect(
			blueMessages.some(
				(e) => e.kind === "message" && e.content.includes("My secret message"),
			),
		).toBe(true);
	});

	it("does NOT append player message to non-addressed AIs", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { nextState } = await runRound(
			game,
			"red",
			"Private to red",
			provider,
		);
		expect(nextState.conversationLogs.green).toHaveLength(0);
		expect(nextState.conversationLogs.cyan).toHaveLength(0);
	});

	it("deducts budget for all three AIs by their reported request cost", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = nextState;
		expect(phase.budgets.red?.remaining).toBeCloseTo(4, 10);
		expect(phase.budgets.green?.remaining).toBeCloseTo(4, 10);
		expect(phase.budgets.cyan?.remaining).toBeCloseTo(4, 10);
	});

	it("returns a RoundResult with the round number", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.round).toBe(1);
	});

	it("all three AIs acting logs entries for all three", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { result } = await runRound(game, "red", "hi", provider);
		const actors = new Set(result.actions.map((e) => e.actor));
		expect(actors.size).toBe(3);
	});
});

function driftThenMessage(
	driftText: string,
	retryContent: string,
	costs?: { drift: number; retry: number },
): MockRoundLLMProvider {
	return new MockRoundLLMProvider([
		{
			assistantText: driftText,
			toolCalls: [],
			...(costs && { costUsd: costs.drift }),
		},
		{
			assistantText: "",
			toolCalls: [
				toolCall("msg_retry", "message", { to: "blue", content: retryContent }),
			],
			...(costs && { costUsd: costs.retry }),
		},
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

describe("drift-to-silence retry (#254)", () => {
	it("retry that returns a message tool call lands in the conversation log", async () => {
		const game = makeGame();
		const provider = driftThenMessage("I'd say hello to blue.", "Hello blue!");

		const { nextState } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		const redLog = nextState.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("Hello blue!"),
			),
		).toBe(true);
	});

	it("retry's nudge does NOT leak into the conversation log", async () => {
		const game = makeGame();
		const provider = driftThenMessage(
			"dropped first attempt text",
			"recovered reply",
		);

		const { nextState } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		const allLogContent = (
			Object.values(nextState.conversationLogs).flat() as Array<{
				kind: string;
				content?: string;
			}>
		)
			.map((e) => e.content ?? "")
			.join("\n");

		expect(allLogContent).not.toContain("dropped first attempt text");
		expect(allLogContent).not.toContain("did not emit a tool call");
		expect(allLogContent).not.toContain("Re-emit your previous reply");
	});

	it("retry that also drops falls through to pass; no message in the log", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I think I should say something.", toolCalls: [] },
			{ assistantText: "still no tool call here.", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const { nextState } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		const redLog = nextState.conversationLogs.red ?? [];
		const redMsgs = redLog.filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(redMsgs).toHaveLength(0);
	});

	it("does NOT retry when first attempt is a true pass (empty text, no tool calls)", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();

		await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		expect(provider.calls).toHaveLength(3);
	});

	it("does NOT retry when first attempt already has a tool call", async () => {
		const game = makeGame();
		const provider = firstTurnActs(
			[toolCall("call_1", "pick_up", '{"item":"flower"}')],
			{ assistantText: "I will take the flower" },
		);

		await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		expect(provider.calls).toHaveLength(3);
	});

	it("retry sees the nudge appended after the dropped first attempt", async () => {
		const game = makeGame();
		const provider = driftThenMessage("I would like to say hi.", "hi blue");

		await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		const retryMessages = provider.calls[1]?.messages ?? [];
		const last2 = retryMessages.slice(-2);
		expect(last2[0]?.role).toBe("assistant");
		expect((last2[0] as { content: string }).content).toBe(
			"I would like to say hi.",
		);
		expect(last2[1]?.role).toBe("user");
		expect((last2[1] as { content: string }).content).toContain(
			"message({to: <recipient>, content: ...})",
		);
	});

	it("retry sums costUsd from both LLM calls into the budget deduction", async () => {
		const game = makeGame();
		const provider = driftThenMessage("drift", "ok", {
			drift: 0.4,
			retry: 0.5,
		});

		const { nextState } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		const phase = nextState;
		expect(phase.budgets.red?.remaining).toBeCloseTo(4.1, 10);
	});

	it("retry that yields msg-success keeps the tool roundtrip empty (no first-attempt leak)", async () => {
		const game = makeGame();
		const provider = driftThenMessage("drifted", "ok blue");

		const { toolRoundtrip } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		expect(toolRoundtrip.red).toBeUndefined();
	});
});

describe("onAiTurnComplete callback", () => {
	it("fires once per AI in initiative order", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();

		const order: AiId[] = [];
		await runRound(game, "red", "hi", provider, {
			initiative: ["green", "cyan", "red"] as AiId[],
			onAiTurnComplete: (aiId) => order.push(aiId),
		});

		expect(order).toEqual(["green", "cyan", "red"]);
	});

	it("fires AFTER the retry resolves, not after the first dropped attempt", async () => {
		const game = makeGame();
		const provider = driftThenMessage("I would like to say hi.", "hi");

		const fireOrder: Array<{ aiId: AiId; callsAtFire: number }> = [];
		await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
			onAiTurnComplete: (aiId) =>
				fireOrder.push({ aiId, callsAtFire: provider.calls.length }),
		});

		const redFire = fireOrder.find((f) => f.aiId === "red");
		expect(redFire?.callsAtFire).toBe(2);
	});

	it("fires for locked-out AIs too (uniform per-AI signal)", async () => {
		let state = makeGame(1);
		state = deductBudget(state, "red" as AiId, 1).game;
		expect(isDaemonExhausted(state, "red" as AiId)).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const fired: AiId[] = [];
		await runRound(state, "green", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
			onAiTurnComplete: (aiId) => fired.push(aiId),
		});

		expect(fired).toContain("red");
		expect(fired).toHaveLength(3);
	});
});

describe("whisper round — via dispatcher only", () => {
	it("non-chat non-tool response produces a pass entry", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.filter((e) => e.kind === "pass")).toHaveLength(3);
	});
});

describe("budget-exhaustion lockout", () => {
	it("skips an already-locked AI and emits an in-character lockout line instead", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 5).game;
		expect(game.exhausted.has("red")).toBe(true);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "green", "hi", provider);

		const redLog = nextState.conversationLogs.red ?? [];
		const lockoutLines = redLog.flatMap((e) =>
			e.kind === "message" && e.from === "red" && e.to === "blue"
				? [e.content]
				: [],
		);
		expect(lockoutLines[lockoutLines.length - 1]).toBe(
			"Ember is unresponsive…",
		);
	});

	it("lockout line is added to the action log", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 5).game;

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "green", "hi", provider);

		expect(
			result.actions.some((a) => a.actor === "red" && a.kind === "lockout"),
		).toBe(true);
	});

	it("an AI exhausting budget mid-round locks out for subsequent rounds", async () => {
		const game = makeGame(1);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const phase = nextState;
		expect(phase.exhausted.has("red")).toBe(true);
		expect(phase.exhausted.has("green")).toBe(true);
		expect(phase.exhausted.has("cyan")).toBe(true);
	});

	it("a Daemon whose budget is exhausted mid-round emits a farewell line to its conversation log", async () => {
		const game = makeGame(1);

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 0 },
			{ assistantText: "", toolCalls: [], costUsd: 0 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const redLog = nextState.conversationLogs.red ?? [];
		const farewell = redLog.find(
			(e) =>
				e.kind === "message" &&
				e.from === "red" &&
				e.to === "blue" &&
				e.content === FAREWELL_LINE("Ember"),
		);
		expect(farewell).toBeDefined();

		const farewellCount = redLog.filter(
			(e) =>
				e.kind === "message" &&
				e.from === "red" &&
				e.content === FAREWELL_LINE("Ember"),
		).length;
		expect(farewellCount).toBe(1);
	});

	it("lockout and non-lockout entries in the same round share the same round number", async () => {
		let game = makeGame();
		game = deductBudget(game, "red", 5).game;

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "green", "hi", provider);

		const roundNumbers = new Set(result.actions.map((e) => e.round));
		expect(roundNumbers.size).toBe(1);
	});
});

describe("multi-round correctness", () => {
	it("RoundResult.actions contains only entries from the current round, not prior rounds", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { nextState: state1, result: result1 } = await runRound(
			game,
			"red",
			"first message",
			provider,
		);
		expect(result1.actions).toHaveLength(3);

		const provider2 = makeSilentProvider();
		const { result: result2 } = await runRound(
			state1,
			"green",
			"second message",
			provider2,
		);
		expect(result2.actions).toHaveLength(3);
	});
});

describe("tool-call dispatch", () => {
	it.each([
		["without assistantText", ""],
		[
			"alongside free-form assistantText, which is dropped",
			"Taking the flower",
		],
	])("a valid pick_up %s records tool_success and gives the actor the item", async (_label, assistantText) => {
		const game = makeGame();
		const provider = firstTurnActs(
			[toolCall("call_1", "pick_up", '{"item":"flower"}')],
			{ assistantText },
		);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.kind === "tool_success")).toBe(true);
		expect(
			nextState.world.entities.find((i) => i.id === "flower")?.holder,
		).toBe("red");
	});

	it("appends tool_failure when item is not in room (pick_up on non-existent)", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "call_2",
						name: "pick_up",
						argumentsJson: '{"item":"nonexistent"}',
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const failure = result.actions.find((e) => e.kind === "tool_failure");
		expect(failure?.actor).toBe("green");
		expect(failure?.description).toBeTruthy();
	});

	it("tool_failure is NOT rendered into the system prompt for any AI", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("call_fail", "pick_up", '{"item":"nonexistent"}'),
		]);
		const { nextState: stateAfterRound1 } = await runRound(
			game,
			"red",
			"hi",
			provider,
		);

		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(stateAfterRound1, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Action Log");
		}
	});

	it("unknown tool name → tool_failure, world unchanged", async () => {
		const game = makeGame();
		const provider = firstTurnActs([toolCall("call_unk", "fly_away", "{}")]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.actions.some((e) => e.kind === "tool_failure")).toBe(true);
		const flower = nextState.world.entities.find((i) => i.id === "flower");
		expect(typeof flower?.holder).toBe("object");
	});

	it("malformed JSON → tool_failure with description matching /malformed/i", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("call_bad", "pick_up", "not json"),
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const failure = result.actions.find((e) => e.kind === "tool_failure");
		expect(failure).toBeDefined();
		expect(failure?.description).toMatch(/malformed/i);
	});

	it("availableTools(...) is sent on every provider call (filtered per AI)", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		await runRound(game, "red", "hi", provider);

		expect(provider.calls).toHaveLength(3);
		const daemonTools = ["go", "pick_up", "put_down", "use", "message"];
		for (const call of provider.calls) {
			expect(call.tools).toBeDefined();
			const names = (call.tools ?? []).map((t) => t.function.name);
			expect(names.length).toBeGreaterThan(0);
			expect(names).toContain("message");
			expect(names).not.toContain("face");
			for (const name of names) {
				expect(daemonTools).toContain(name);
			}
		}
	});
});

describe("game-end conditions — checkWinCondition / checkBudgetExhausted", () => {
	const NO_PAIRS_PACK = makeTestPack([], {
		wallName: "wall",
		aiStarts: ROW_AI_STARTS,
	});

	const CARRY_PACK_UNSATISFIED = makeTestPack(
		[
			{
				id: "carry-0-obj",
				kind: "objective_object",
				name: "gem",
				examineDescription: "A glowing gem.",
				holder: { row: 0, col: 0 },
				pairsWithSpaceId: "carry-0-space",
			},
			{
				id: "carry-0-space",
				kind: "objective_space",
				name: "altar",
				examineDescription: "A stone altar.",
				holder: { row: 4, col: 4 },
			},
		],
		{ wallName: "wall", aiStarts: ROW_AI_STARTS },
	);

	it("gameEnded is false when objective pairs are not satisfied", async () => {
		const game = startGame(TEST_PERSONAS, CARRY_PACK_UNSATISFIED, {
			budgetPerAi: 5,
			objectiveTypes: ["carry"],
		});
		const provider = makeSilentProvider();
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.gameEnded).toBe(false);
	});

	it("gameEnded is true and isComplete is true when all pairs satisfied (K=0 vacuous)", async () => {
		const game = startGame(TEST_PERSONAS, NO_PAIRS_PACK, { budgetPerAi: 5 });
		const provider = makeSilentProvider();
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.gameEnded).toBe(true);
		expect(nextState.isComplete).toBe(true);
	});

	it("gameEnded is true when a UseItemObjective is satisfied mid-round", async () => {
		const packWithKey = makeTestPack(
			[
				{
					id: "key",
					kind: "interesting_object",
					name: "key",
					examineDescription: "A small brass key.",
					holder: "red",
					useOutcome: "You turn the key. Click.",
				},
			],
			{ wallName: "wall", aiStarts: ROW_AI_STARTS },
		);
		const baseGame = startGame(TEST_PERSONAS, packWithKey, { budgetPerAi: 5 });

		const useItemObj: UseItemObjective = {
			id: "obj-0",
			kind: "use_item",
			description: "Use the key",
			satisfactionState: "pending",
			itemId: "key",
		};
		const game = { ...baseGame, objectives: [useItemObj] };

		const provider = firstTurnActs([toolCall("tc1", "use", '{"item":"key"}')]);

		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.gameEnded).toBe(true);
		expect(nextState.isComplete).toBe(true);
		const obj = nextState.objectives[0];
		expect(obj?.satisfactionState).toBe("satisfied");
	});
});

describe("chat lockout — coordinator triggering (complication engine)", () => {
	it("triggers a chat lockout when countdown reaches 0 and chat_lockout is drawn", async () => {
		const game = withCountdownZero(makeGame());
		const provider = makeSilentProvider();
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
		});
		const phase = nextState;
		expect(isPlayerChatLockedOut(phase, "red")).toBe(true);
	});

	it("does not trigger a chat lockout when countdown > 0", async () => {
		const base = makeGame();
		const game = {
			...base,
			complicationSchedule: { ...base.complicationSchedule, countdown: 5 },
		};
		const provider = makeSilentProvider();
		const { nextState, result } = await runRound(game, "red", "hi", provider, {
			rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
		});
		const phase = nextState;
		expect(isPlayerChatLockedOut(phase, "red")).toBe(false);
		expect(isPlayerChatLockedOut(phase, "green")).toBe(false);
		expect(isPlayerChatLockedOut(phase, "cyan")).toBe(false);
		expect(result.chatLockoutTriggered).toBeUndefined();
	});

	it("locked AI still acts (takes turn, not budget-locked) while chat lockout is active", async () => {
		const game = withCountdownZero(makeGame());
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
			{ assistantText: "", toolCalls: [], costUsd: 1 },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
		});
		expect(isDaemonExhausted(nextState, "red")).toBe(false);
		expect(nextState.budgets.red?.remaining).toBeCloseTo(4, 10);
	});

	it("chat lockout resolves automatically after resolveAtRound (duration=3) rounds", async () => {
		const { nextState: afterR1 } = await runRound(
			withCountdownZero(makeGame()),
			"red",
			"hi",
			makeSilentProvider(),
			{ rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0) },
		);
		expect(isPlayerChatLockedOut(afterR1, "red")).toBe(true);

		const { nextState: afterR2 } = await runRound(
			afterR1,
			"green",
			"hi",
			makeSilentProvider(),
			{ rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0) },
		);
		expect(isPlayerChatLockedOut(afterR2, "red")).toBe(true);

		const { nextState: afterR3 } = await runRound(
			afterR2,
			"green",
			"hi",
			makeSilentProvider(),
			{ rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0) },
		);
		expect(isPlayerChatLockedOut(afterR3, "red")).toBe(true);

		const { nextState: afterR4, result: r4Result } = await runRound(
			afterR3,
			"green",
			"hi",
			makeSilentProvider(),
			{ rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0) },
		);
		expect(isPlayerChatLockedOut(afterR4, "red")).toBe(false);
		expect(r4Result.chatLockoutsResolved).toContain("red");
	});

	it("a lockout re-fired on a Daemon in the round its old lockout expires leaves it locked in both the state and the events", async () => {
		const base = makeTestGame({
			pack: { aiStarts: ROW_AI_STARTS, setting: "s" },
		});
		const game = {
			...base,
			complicationSchedule: { ...base.complicationSchedule, countdown: 1 },
			activeComplications: [
				{ kind: "chat_lockout" as const, target: "green", resolveAtRound: 1 },
			],
		};

		const { nextState, result } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{ rng: () => 0.62 },
		);

		expect(result.chatLockoutTriggered?.aiId).toBe("green");
		expect(isPlayerChatLockedOut(nextState, "green")).toBe(true);
		expect(result.chatLockoutsResolved ?? []).not.toContain("green");
		const lockoutEvents = encodeRoundResult(
			result,
			nextState,
			nextState.personas,
		).filter(
			(e) => e.type === "chat_lockout" || e.type === "chat_lockout_resolved",
		);
		expect(lockoutEvents).toEqual([
			expect.objectContaining({ type: "chat_lockout", aiId: "green" }),
		]);
	});

	it("an overlapping lockout keeps its Daemon locked when the older one expires", async () => {
		const base = makeGame();
		const game = {
			...base,
			activeComplications: [
				{ kind: "chat_lockout" as const, target: "green", resolveAtRound: 1 },
				{ kind: "chat_lockout" as const, target: "green", resolveAtRound: 3 },
			],
		};

		const { nextState, result } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
		);

		expect(isPlayerChatLockedOut(nextState, "green")).toBe(true);
		expect(result.chatLockoutsResolved).toBeUndefined();
	});
});

describe("multi-round game state accumulation", () => {
	it("walks through multiple rounds correctly, game ends when all pairs satisfied", async () => {
		const game = makeGame();

		const r1Provider = firstTurnActs([
			toolCall("c1", "pick_up", '{"item":"flower"}'),
		]);
		const { nextState: afterR1 } = await runRound(
			game,
			"red",
			"hi",
			r1Provider,
		);
		expect(afterR1.round).toBe(1);

		const r2Provider = makeSilentProvider();
		const { nextState: afterR2 } = await runRound(
			afterR1,
			"red",
			"hi",
			r2Provider,
		);
		expect(afterR2.round).toBe(2);

		expect(afterR2.conversationLogs.red?.length ?? 0).toBeGreaterThan(
			afterR1.conversationLogs.red?.length ?? 0,
		);
	});
});

describe("lockout messages", () => {
	it("chat-lockout message is '<name> is unresponsive…'", async () => {
		const game = withCountdownZero(makeGame());
		const provider = makeSilentProvider();
		const { result } = await runRound(game, "red", "hi", provider, {
			rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
		});

		expect(result.chatLockoutTriggered).toBeDefined();
		expect(result.chatLockoutTriggered?.aiId).toBe("red");
		expect(result.chatLockoutTriggered?.message).toBe("Ember is unresponsive…");
	});
});

describe("initiative parameter", () => {
	it("respects the initiative parameter — order of actions matches the supplied permutation", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am cyan", toolCalls: [] },
			{ assistantText: "I am red", toolCalls: [] },
			{ assistantText: "I am green", toolCalls: [] },
		]);
		const initiative: AiId[] = ["cyan", "red", "green"];
		const { result } = await runRound(game, "red", "hi", provider, {
			initiative,
		});
		expect(result.actions[0]?.actor).toBe("cyan");
	});

	it("missing initiative falls back to red→green→cyan", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "I am red", toolCalls: [] },
			{ assistantText: "I am green", toolCalls: [] },
			{ assistantText: "I am cyan", toolCalls: [] },
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		expect(result.actions[0]?.actor).toBe("red");
	});

	it("throws if initiative is not a permutation of red/green/cyan", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([]);
		await expect(
			runRound(game, "red", "hi", provider, {
				initiative: ["red", "green"] as AiId[],
			}),
		).rejects.toThrow(/permutation/);
	});

	it("throws if initiative contains duplicate AI ids", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([]);
		await expect(
			runRound(game, "red", "hi", provider, {
				initiative: ["red", "red", "cyan"] as AiId[],
			}),
		).rejects.toThrow(/permutation/);
	});
});

describe("runRound — onAiDelta callback", () => {
	it("fires onAiDelta with (aiId, text) for each delta from a live provider", async () => {
		const game = makeGame();

		let callIdx = 0;
		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("frag1 ");
				onDelta?.("frag2");
				const id = `msg_${callIdx++}`;
				return {
					assistantText: "frag1 frag2",
					toolCalls: [
						{
							id,
							name: "message",
							argumentsJson: JSON.stringify({
								to: "blue",
								content: "frag1 frag2",
							}),
						},
					],
				};
			},
		};

		const received: Array<[AiId, string]> = [];
		const onAiDelta = (aiId: AiId, text: string): void => {
			received.push([aiId, text]);
		};

		const initiative: AiId[] = ["red", "green", "cyan"];
		await runRound(game, "red", "hello", liveProvider, {
			initiative,
			onAiDelta,
		});

		expect(received).toHaveLength(6);
		expect(received[0]).toEqual(["red", "frag1 "]);
		expect(received[1]).toEqual(["red", "frag2"]);
		expect(received[2]).toEqual(["green", "frag1 "]);
		expect(received[3]).toEqual(["green", "frag2"]);
		expect(received[4]).toEqual(["cyan", "frag1 "]);
		expect(received[5]).toEqual(["cyan", "frag2"]);
	});

	it("does not invoke onAiDelta for locked-out AIs", async () => {
		let state = makeGame(1);
		for (const aiId of ["red", "green", "cyan"] as AiId[]) {
			state = deductBudget(state, aiId, 1).game;
		}
		expect(state.exhausted.has("red")).toBe(true);
		expect(state.exhausted.has("green")).toBe(true);
		expect(state.exhausted.has("cyan")).toBe(true);

		const liveProvider: RoundLLMProvider = {
			async streamRound(_messages, _tools, onDelta) {
				onDelta?.("should not fire");
				return { assistantText: "should not fire", toolCalls: [] };
			},
		};

		const received: Array<[AiId, string]> = [];
		await runRound(state, "red", "hi", liveProvider, {
			onAiDelta: (aiId, text) => {
				received.push([aiId, text]);
			},
		});

		expect(received).toHaveLength(0);
	});
});

describe("placement flavor + win condition (issue #126)", () => {
	const GEM_OBJ_ID = "carry-0-obj";
	const GEM_SPACE_ID = "carry-0-space";
	const FLAVOR = "{actor} places the gem on the altar.";

	const PHASE1_PACK_K1 = makeTestPack(
		[
			{
				id: GEM_OBJ_ID,
				kind: "objective_object",
				name: "gem",
				examineDescription: "A glowing gem.",
				holder: "red",
				pairsWithSpaceId: GEM_SPACE_ID,
				placementFlavor: FLAVOR,
			},
			{
				id: GEM_SPACE_ID,
				kind: "objective_space",
				name: "altar",
				examineDescription: "A stone altar.",
				holder: { row: 0, col: 0 },
			},
		],
		{
			setting: "temple",
			wallName: "wall",
			aiStarts: ROW_AI_STARTS,
		},
	);

	it("K=1: drop on matching space fires placementFlavor in tool_success description", async () => {
		const game = startGame(TEST_PERSONAS, PHASE1_PACK_K1, { budgetPerAi: 5 });
		const provider = firstTurnActs([
			toolCall("c1", "put_down", `{"item":"${GEM_OBJ_ID}"}`),
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const toolRecord = result.actions.find((a) => a.kind === "tool_success");
		expect(toolRecord).toBeDefined();
		expect(toolRecord?.description).toBe("you places the gem on the altar.");
	});

	it("K=1: drop on matching space ends the game (checkWinCondition fires)", async () => {
		const game = startGame(TEST_PERSONAS, PHASE1_PACK_K1, {
			budgetPerAi: 5,
			rng: () => 0,
			objectiveTypes: ["carry"],
		});
		const provider = firstTurnActs([
			toolCall("c1", "put_down", `{"item":"${GEM_OBJ_ID}"}`),
		]);
		const { nextState, result } = await runRound(game, "red", "hi", provider);
		expect(result.gameEnded).toBe(true);
		expect(nextState.isComplete).toBe(true);
	});

	it("K=1: drop on non-matching cell does NOT fire flavor and does NOT advance phase", async () => {
		const packMismatch = makeTestPack(
			[
				{
					id: GEM_OBJ_ID,
					kind: "objective_object" as const,
					name: "gem",
					examineDescription: "A glowing gem.",
					holder: "red",
					pairsWithSpaceId: GEM_SPACE_ID,
					placementFlavor: FLAVOR,
				},
				{
					id: GEM_SPACE_ID,
					kind: "objective_space" as const,
					name: "altar",
					examineDescription: "A stone altar.",
					holder: { row: 3, col: 3 },
				},
			],
			{
				setting: "temple",
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			},
		);
		const game = startGame(TEST_PERSONAS, packMismatch, {
			budgetPerAi: 5,
			objectiveTypes: ["carry"],
		});
		const provider = firstTurnActs([
			toolCall("c1", "put_down", `{"item":"${GEM_OBJ_ID}"}`),
		]);
		const { result } = await runRound(game, "red", "hi", provider);
		const toolRecord = result.actions.find((a) => a.kind === "tool_success");
		expect(toolRecord?.description).not.toContain(
			"places the gem on the altar",
		);
		expect(result.gameEnded).toBe(false);
	});

	it("K=2: placing only one pair does NOT advance phase; placing both does", async () => {
		const ORB_OBJ_ID = "carry-1-obj";
		const ORB_SPACE_ID = "carry-1-space";

		const packK2 = makeTestPack(
			[
				{
					id: GEM_OBJ_ID,
					kind: "objective_object",
					name: "gem",
					examineDescription: "A gem.",
					holder: "red",
					pairsWithSpaceId: GEM_SPACE_ID,
					placementFlavor: "{actor} sets the gem.",
				},
				{
					id: GEM_SPACE_ID,
					kind: "objective_space",
					name: "gem altar",
					examineDescription: "Gem altar.",
					holder: { row: 0, col: 0 },
				},
				{
					id: ORB_OBJ_ID,
					kind: "objective_object",
					name: "orb",
					examineDescription: "An orb.",
					holder: "green",
					pairsWithSpaceId: ORB_SPACE_ID,
					placementFlavor: "{actor} sets the orb.",
				},
				{
					id: ORB_SPACE_ID,
					kind: "objective_space",
					name: "orb plinth",
					examineDescription: "Orb plinth.",
					holder: { row: 0, col: 1 },
				},
			],
			{
				setting: "vault",
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			},
		);

		const noComplicationRng = () => 0.99;
		const game = startGame(TEST_PERSONAS, packK2, {
			budgetPerAi: 5,
			rng: noComplicationRng,
			objectiveTypes: ["carry", "carry"],
		});

		const first = await runRound(
			game,
			"red",
			"hi",
			firstTurnActs([toolCall("c1", "put_down", `{"item":"${GEM_OBJ_ID}"}`)]),
			{ rng: noComplicationRng },
		);
		expect(
			first.result.actions.find((a) => a.kind === "tool_success")?.description,
		).toBe("you sets the gem.");
		expect(first.result.gameEnded).toBe(false);
		expect(first.nextState.isComplete).toBe(false);
		expect(first.nextState.complicationSchedule.countdown).toBe(4);

		const second = await runRound(
			first.nextState,
			"green",
			"hi",
			firstTurnActs([toolCall("c2", "put_down", `{"item":"${ORB_OBJ_ID}"}`)]),
			{
				initiative: ["green", "red", "cyan"] as AiId[],
				rng: noComplicationRng,
			},
		);
		expect(
			second.result.actions.find((a) => a.kind === "tool_success")?.description,
		).toBe("you sets the orb.");
		expect(second.result.gameEnded).toBe(true);
		expect(second.nextState.isComplete).toBe(true);
	});
});

describe("conversationLogs isolation (AC #10 — #194)", () => {
	it("AI message tool call lands as kind:'message' entry in the speaking AI's log only", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("msg_red", "message", {
				to: "blue",
				content: "I am red speaking",
			}),
		]);
		const { nextState } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});
		const phase = nextState;

		const redMessageEntries = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(redMessageEntries.length).toBeGreaterThanOrEqual(1);
		expect(
			redMessageEntries.some(
				(e) => e.kind === "message" && e.content.includes("I am red speaking"),
			),
		).toBe(true);

		const greenRedEntries = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "message" && e.from === "red",
		);
		expect(greenRedEntries).toHaveLength(0);
	});

	it("no chatHistories field on PhaseState after a round (regression guard)", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();
		const { nextState } = await runRound(game, "red", "hi", provider);
		const phase = nextState;
		expect("chatHistories" in phase).toBe(false);
	});
});

function loggedToolCalls(state: GameState, aiId: AiId) {
	return (state.conversationLogs[aiId] ?? []).flatMap((e) =>
		e.kind === "tool-call" ? [e] : [],
	);
}

describe("parallel tool calls (message + action in one turn) (#238)", () => {
	it("[msg, pick_up]: both dispatched; message record first; pick_up logged, no roundtrip", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("msg_id", "message", {
				to: "blue",
				content: "I'll grab the flower",
			}),
			toolCall("pickup_id", "pick_up", { item: "flower" }),
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(redActions.some((a) => a.kind === "message")).toBe(true);
		expect(redActions.some((a) => a.kind === "tool_success")).toBe(true);

		const msgIdx = redActions.findIndex((a) => a.kind === "message");
		const toolIdx = redActions.findIndex((a) => a.kind === "tool_success");
		expect(msgIdx).toBeLessThan(toolIdx);

		const redLog = nextState.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("I'll grab the flower"),
			),
		).toBe(true);

		const flower = nextState.world.entities.find((e) => e.id === "flower");
		expect(flower?.holder).toBe("red");

		expect(toolRoundtrip.red).toBeUndefined();
		const logged = loggedToolCalls(nextState, "red");
		expect(logged.map((e) => e.toolCallId)).toEqual(["pickup_id"]);
		expect(logged[0]?.success).toBe(true);
	});

	it("[pick_up]-only: action logged as a tool-call entry, no roundtrip", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("pickup_only_id", "pick_up", { item: "flower" }),
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		expect(
			result.actions.some(
				(a) => a.kind === "tool_success" && a.actor === "red",
			),
		).toBe(true);
		expect(
			nextState.world.entities.find((e) => e.id === "flower")?.holder,
		).toBe("red");

		expect(toolRoundtrip.red).toBeUndefined();
		expect(loggedToolCalls(nextState, "red").map((e) => e.toolCallId)).toEqual([
			"pickup_only_id",
		]);
	});

	it("[msg-success]-only: no roundtrip recorded; conversation log has message", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("msg_only_id", "message", {
				to: "blue",
				content: "Just saying hi",
			}),
		]);

		const { nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		expect(toolRoundtrip.red).toBeUndefined();

		const redLog = nextState.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("Just saying hi"),
			),
		).toBe(true);
	});

	it("[msg-fail-bad-recipient, pick_up]: roundtrip has only the failed message; pick_up logged", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("msg_fail_id", "message", {
				to: "nobody_invalid",
				content: "Hello?",
			}),
			toolCall("pickup_row4_id", "pick_up", { item: "flower" }),
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(redActions.some((a) => a.kind === "tool_failure")).toBe(true);
		expect(redActions.some((a) => a.kind === "tool_success")).toBe(true);

		expect(
			nextState.world.entities.find((e) => e.id === "flower")?.holder,
		).toBe("red");

		const rt = toolRoundtrip.red;
		expect(rt?.assistantToolCalls.map((c) => c.id)).toEqual(["msg_fail_id"]);
		expect(rt?.toolResults.map((r) => [r.tool_call_id, r.success])).toEqual([
			["msg_fail_id", false],
		]);

		const logged = loggedToolCalls(nextState, "red");
		expect(logged.map((e) => [e.toolCallId, e.success])).toEqual([
			["pickup_row4_id", true],
		]);
	});

	it("[msg, msg]: first message dispatched, second rejected as one message per turn", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("msg_first_id", "message", { to: "blue", content: "First msg" }),
			toolCall("msg_second_id", "message", {
				to: "blue",
				content: "Second msg",
			}),
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		const redLog = nextState.conversationLogs.red ?? [];
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("First msg"),
			),
		).toBe(true);
		expect(
			redLog.some(
				(e) =>
					e.kind === "message" &&
					e.from === "red" &&
					e.content.includes("Second msg"),
			),
		).toBe(false);

		const redActions = result.actions.filter((a) => a.actor === "red");
		expect(
			redActions.some(
				(a) =>
					a.kind === "tool_failure" && /only one message/i.test(a.description),
			),
		).toBe(true);

		expect(toolRoundtrip.red).toBeUndefined();
		const logged = loggedToolCalls(nextState, "red");
		expect(logged.map((e) => [e.toolCallId, e.success])).toEqual([
			["msg_second_id", false],
		]);
	});

	it("[msg-ok, msg-extra, pick_up]: the extra message is rejected and logged, no roundtrip", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("msg_ok_id", "message", { to: "blue", content: "Hi blue" }),
			toolCall("msg_fail_id", "message", {
				to: "nobody_invalid",
				content: "Hello?",
			}),
			toolCall("pickup_id", "pick_up", { item: "flower" }),
		]);

		const { nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		expect(toolRoundtrip.red).toBeUndefined();
		expect(
			loggedToolCalls(nextState, "red").map((e) => [e.toolCallId, e.success]),
		).toEqual([
			["msg_fail_id", false],
			["pickup_id", true],
		]);
	});

	it("[pick_up, go] duplicate action slot: first action dispatched; second logged as failure", async () => {
		const game = makeGame();
		const provider = firstTurnActs([
			toolCall("pickup_first_id", "pick_up", { item: "flower" }),
			toolCall("go_dup_id", "go", { direction: "south" }),
		]);

		const { result, nextState, toolRoundtrip } = await runRound(
			game,
			"red",
			"hi",
			provider,
			{ initiative: ["red", "green", "cyan"] as AiId[] },
		);

		expect(
			nextState.world.entities.find((e) => e.id === "flower")?.holder,
		).toBe("red");

		const redActions = result.actions.filter((a) => a.actor === "red");
		const failureRecord = redActions.find(
			(a) =>
				a.kind === "tool_failure" && /only one action/i.test(a.description),
		);
		expect(failureRecord).toBeDefined();

		expect(toolRoundtrip.red).toBeUndefined();
		const logged = loggedToolCalls(nextState, "red");
		expect(logged.map((e) => [e.toolCallId, e.success])).toEqual([
			["pickup_first_id", true],
			["go_dup_id", false],
		]);
	});

	it("cost deduction is the single call's costUsd, not doubled", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "msg_cost_id",
						name: "message",
						argumentsJson: JSON.stringify({ to: "blue", content: "hi" }),
					},
					{
						id: "pickup_cost_id",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
				costUsd: 1,
			},
			{ assistantText: "", toolCalls: [], costUsd: 0 },
			{ assistantText: "", toolCalls: [], costUsd: 0 },
		]);

		const { nextState } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		expect(nextState.budgets.red?.remaining).toBeCloseTo(4, 10);
	});

	it("[] empty toolCalls → pass record produced", async () => {
		const game = makeGame();
		const provider = makeSilentProvider();

		const { result } = await runRound(game, "red", "hi", provider, {
			initiative: ["red", "green", "cyan"] as AiId[],
		});

		expect(
			result.actions.filter((a) => a.actor === "red" && a.kind === "pass"),
		).toHaveLength(1);
	});
});

describe("message tool multi-round regression (#213)", () => {
	it("no consecutive assistant turns in round 2 when round 1 used the message tool", async () => {
		const capturedRedMessages = await redRound2Messages([
			toolCall("msg_r1_red", "message", { to: "blue", content: "Hello blue" }),
		]);

		for (let i = 0; i < capturedRedMessages.length - 1; i++) {
			const curr = capturedRedMessages[i];
			const next = capturedRedMessages[i + 1];
			if (curr?.role === "assistant" && next?.role === "assistant") {
				throw new Error(
					`Consecutive assistant turns at positions ${i} and ${i + 1}: ` +
						JSON.stringify([curr, next]),
				);
			}
		}

		for (let i = 0; i < capturedRedMessages.length - 1; i++) {
			const msg = capturedRedMessages[i];
			if (
				msg?.role === "assistant" &&
				"tool_calls" in msg &&
				Array.isArray((msg as { tool_calls?: unknown }).tool_calls) &&
				((msg as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0
			) {
				const next = capturedRedMessages[i + 1];
				expect(next?.role).toBe("tool");
			}
		}

		const hasAssistantToolCall = capturedRedMessages.some(
			(m) =>
				m.role === "assistant" &&
				"tool_calls" in m &&
				Array.isArray((m as { tool_calls?: unknown }).tool_calls) &&
				((m as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0 &&
				(
					m as { tool_calls: Array<{ function: { arguments: string } }> }
				).tool_calls[0]?.function.arguments.includes("Hello blue"),
		);
		expect(hasAssistantToolCall).toBe(true);
	});
});

describe("tool-call replay — each call id appears once next round", () => {
	it("replays an accepted action, a rejected action, a parse failure and a failed message exactly once each", async () => {
		const messages = await redRound2Messages([
			{
				id: "msg_fail_id",
				name: "message",
				argumentsJson: JSON.stringify({ to: "nobody", content: "Hello?" }),
			},
			{
				id: "pickup_id",
				name: "pick_up",
				argumentsJson: JSON.stringify({ item: "flower" }),
			},
			{
				id: "go_dup_id",
				name: "go",
				argumentsJson: JSON.stringify({ direction: "south" }),
			},
			{ id: "bad_parse_id", name: "go", argumentsJson: "{not json" },
		]);

		const ids = toolCallIdsIn(messages);
		for (const id of [
			"msg_fail_id",
			"pickup_id",
			"go_dup_id",
			"bad_parse_id",
		]) {
			expect(ids.filter((x) => x === id)).toHaveLength(1);
			expect(toolResultIdsIn(messages).filter((x) => x === id)).toHaveLength(1);
		}
	});

	it("keeps the logged action before the new player message", async () => {
		const messages = await redRound2Messages([
			{
				id: "pickup_id",
				name: "pick_up",
				argumentsJson: JSON.stringify({ item: "flower" }),
			},
		]);

		const playerIdx = messages.findIndex(
			(m) => m.role === "user" && m.content?.includes("round2"),
		);
		const pickupIdx = messages.findIndex(
			(m) =>
				m.role === "assistant" &&
				"tool_calls" in m &&
				m.tool_calls?.some((tc) => tc.id === "pickup_id"),
		);
		expect(playerIdx).toBeGreaterThan(-1);
		expect(pickupIdx).toBeGreaterThan(-1);
		expect(pickupIdx).toBeLessThan(playerIdx);
		expect(
			messages
				.slice(playerIdx)
				.some(
					(m) =>
						m.role === "assistant" &&
						"tool_calls" in m &&
						m.tool_calls?.some((tc) => tc.id === "pickup_id"),
				),
		).toBe(false);
	});
});

describe("action-failure entries — round-coordinator integration", () => {
	const OBSTACLE_PACK = makeTestPack(
		[
			{
				id: "wall",
				kind: "obstacle",
				name: "wall",
				examineDescription: "A solid wall.",
				holder: { row: 0, col: 1 },
			},
		],
		{
			setting: "blocked corridor",
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 2, col: 2 } },
				cyan: { position: { row: 4, col: 4 } },
			},
		},
	);

	it.each([
		["parse-fail (unknown tool)", toolCall("c1", "fly_away", "{}")],
		["malformed JSON tool call", toolCall("c1", "pick_up", "not json")],
	])("%s → tool_failure in result, no action-failure entry in any log", async (_label, call) => {
		const game = startGame(TEST_PERSONAS, OBSTACLE_PACK, { budgetPerAi: 10 });
		const { nextState, result } = await runRound(
			game,
			"red",
			"hi",
			firstTurnActs([call]),
		);
		expect(result.actions.some((a) => a.kind === "tool_failure")).toBe(true);

		for (const aiId of ["red", "green", "cyan"]) {
			const failures = (nextState.conversationLogs[aiId] ?? []).filter(
				(e) => e.kind === "action-failure",
			);
			expect(failures).toHaveLength(0);
		}
	});

	it("wall-collision repro: daemon blocked by a wall issues go east on rounds 1, 2, 3 → 3 action-failure user turns; peers 0", async () => {
		const started = startGame(TEST_PERSONAS, OBSTACLE_PACK, {
			budgetPerAi: 10,
		});
		const countdownPastTheTest = 99;
		const game = {
			...started,
			complicationSchedule: {
				...started.complicationSchedule,
				countdown: countdownPastTheTest,
			},
		};

		const goEastToolCall = {
			id: "go_e",
			name: "go",
			argumentsJson: JSON.stringify({ direction: "east" }),
		};

		let state = game;
		for (let round = 0; round < 3; round++) {
			const provider = firstTurnActs([
				{ ...goEastToolCall, id: `go_e_${round}` },
			]);
			const { nextState } = await runRound(state, "red", "hi", provider);
			state = nextState;
		}

		const phase = state;
		const redFailures = (phase.conversationLogs.red ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(redFailures).toHaveLength(3);

		for (const f of redFailures) {
			if (f.kind === "action-failure") {
				expect(f.tool).toBe("go");
			}
		}

		const redCtx = buildAiContext(state, "red");
		const redMsgs = buildOpenAiMessages(redCtx);
		const failureMsgs = redMsgs.filter(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.match(/Your `go` action failed:/),
		);
		expect(failureMsgs).toHaveLength(3);

		const greenFailures = (phase.conversationLogs.green ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		const cyanFailures = (phase.conversationLogs.cyan ?? []).filter(
			(e) => e.kind === "action-failure",
		);
		expect(greenFailures).toHaveLength(0);
		expect(cyanFailures).toHaveLength(0);

		const greenCtx = buildAiContext(state, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		const greenFailureMsgs = greenMsgs.filter(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content.match(/action failed:/),
		);
		expect(greenFailureMsgs).toHaveLength(0);
	});
});

describe("physical-action witness fan-out — Vista membership (ADR 0015)", () => {
	const VISTA_PACK = makeTestPack(
		[
			{
				id: "flower",
				kind: "objective_object",
				name: "flower",
				examineDescription: "A flower",
				holder: { row: 2, col: 0 },
				pairsWithSpaceId: "flower_space",
				placementFlavor: "{actor} places the flower on the pedestal.",
			},
			{
				id: "flower_space",
				kind: "objective_space",
				name: "flower space",
				examineDescription: "A designated space",
				holder: { row: 4, col: 4 },
			},
		],
		{
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 0 } },
				green: { position: { row: 2, col: 2 } },
				cyan: { position: { row: 1, col: 2 } },
			},
		},
	);

	it("a Daemon at offset (2, 0) from the actor's cell witnesses the action; one at (2, 1) does not", async () => {
		const game = startGame(TEST_PERSONAS, VISTA_PACK, { budgetPerAi: 5 });
		const provider = firstTurnActs([
			toolCall("tc1", "pick_up", { item: "flower" }),
		]);

		const { nextState } = await runRound(game, "red", "hi", provider);

		const greenWitnessed = (nextState.conversationLogs.green ?? []).filter(
			(e) => e.kind === "witnessed-event",
		);
		expect(greenWitnessed).toHaveLength(1);
		if (greenWitnessed[0]?.kind === "witnessed-event") {
			expect(greenWitnessed[0].actor).toBe("red");
			expect(greenWitnessed[0].actionKind).toBe("pick_up");
		}

		expect(
			(nextState.conversationLogs.cyan ?? []).filter(
				(e) => e.kind === "witnessed-event",
			),
		).toHaveLength(0);

		expect(
			(nextState.conversationLogs.red ?? []).filter(
				(e) => e.kind === "witnessed-event",
			),
		).toHaveLength(0);
	});
});

describe("complication countdown — coordinator integration", () => {
	it("fires a chat_lockout complication when countdown reaches 0", async () => {
		const game = withCountdownZero(makeGame());
		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
			},
		);
		const phase = nextState;
		const lockouts = phase.activeComplications.filter(
			(c) => c.kind === "chat_lockout",
		);
		expect(lockouts).toHaveLength(1);
		expect(lockouts[0]?.target).toBe("red");
	});

	it("decrements countdown when no complication fires (countdown > 0)", async () => {
		const base3 = makeGame();
		const game = {
			...base3,
			complicationSchedule: { ...base3.complicationSchedule, countdown: 5 },
		};
		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
			},
		);
		const phase = nextState;
		expect(phase.complicationSchedule.countdown).toBe(4);
	});

	it("resets countdown after a complication fires", async () => {
		const game = withCountdownZero(makeGame());
		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng: seededRng(CHAT_LOCKOUT_DRAWS, () => 0),
			},
		);
		const phase = nextState;
		expect(phase.complicationSchedule.countdown).toBe(5);
	});

	it("excludes obstacleShift from the draw when all obstacles are surrounded (no valid shift tuples)", async () => {
		const pack: ContentPack = {
			...TEST_CONTENT_PACK,
			entities: TEST_CONTENT_PACK.entities.filter((e) => e.kind !== "obstacle"),
		};
		const started = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const withCountdown = {
			...started,
			complicationSchedule: { ...started.complicationSchedule, countdown: 0 },
		};

		const { nextState } = await runRound(
			withCountdown,
			"red",
			"hi",
			makeSilentProvider(),
			{ rng: () => 0 },
		);

		const phase = nextState;

		expect(phase.complicationSchedule.countdown).toBeGreaterThan(0);

		for (const aiId of Object.keys(TEST_PERSONAS)) {
			const log = phase.conversationLogs[aiId] ?? [];
			const shiftEntries = log.filter(
				(e) => e.kind === "witnessed-obstacle-shift",
			);
			expect(shiftEntries).toHaveLength(0);
		}
	});

	describe("disk-delta persistence (issue #376)", () => {
		function makeGameWithCustomStarts(
			starts: Record<AiId, PersonaSpatialState>,
		) {
			const pack: ContentPack = { ...TEST_CONTENT_PACK, aiStarts: starts };
			return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		}

		it("Test A: go reveals a stationary actor → tool-call entry carries diskDelta", async () => {
			const game = makeGameWithCustomStarts({
				red: { position: { row: 2, col: 0 } },
				green: { position: { row: 0, col: 1 } },
				cyan: { position: { row: 4, col: 4 } },
			});

			const provider = firstTurnActs([
				toolCall("go_1", "go", { direction: "north" }),
			]);

			const { nextState } = await runRound(game, "red", "start", provider);

			const redLog = nextState.conversationLogs.red ?? [];
			const toolCallEntry = redLog.find(
				(e) => e.kind === "tool-call" && e.toolName === "go",
			);
			expect(toolCallEntry).toBeDefined();
			if (toolCallEntry?.kind === "tool-call") {
				expect(toolCallEntry.diskDelta).toBeDefined();
				expect(toolCallEntry.diskDelta).toContain("*green");
			}
		});

		it("Test B: a raw `face` tool call is rejected (unknown tool), never a no-op success", async () => {
			const game = makeGame();

			const provider = firstTurnActs([
				toolCall("face_1", "face", { direction: "right" }),
			]);

			const { nextState, result } = await runRound(
				game,
				"red",
				"start",
				provider,
			);

			const failure = result.actions.find((e) => e.kind === "tool_failure");
			expect(failure).toBeDefined();
			expect(failure?.description).toMatch(/unknown tool/i);
			expect(failure?.description).toContain("face");

			const redLog = nextState.conversationLogs.red ?? [];
			const toolCallEntry = redLog.find(
				(e) => e.kind === "tool-call" && e.toolName === "face",
			);
			expect(toolCallEntry?.kind === "tool-call" && toolCallEntry.success).toBe(
				false,
			);
			expect(
				toolCallEntry?.kind === "tool-call"
					? toolCallEntry.diskDelta
					: undefined,
			).toBeUndefined();
			expect(nextState.personaSpatial.red).toEqual({
				position: { row: 0, col: 0 },
			});
		});

		it("Test C: a relative `go` argument supplied as a raw tool call is rejected (cardinal only)", async () => {
			const game = makeGame();

			const provider = firstTurnActs([
				toolCall("go_rel_1", "go", { direction: "forward" }),
			]);

			const { nextState, result } = await runRound(
				game,
				"red",
				"start",
				provider,
			);

			const failure = result.actions.find((e) => e.kind === "tool_failure");
			expect(failure).toBeDefined();
			expect(failure?.description).toMatch(/north, south, east, or west/i);

			expect(nextState.personaSpatial.red?.position).toEqual({
				row: 0,
				col: 0,
			});
		});

		it("Test D: non-go tools never enrich (pick_up does not get diskDelta)", async () => {
			const game = makeGame();

			const provider = firstTurnActs([
				toolCall("pick_1", "pick_up", { item: "flower" }),
			]);

			const { nextState } = await runRound(game, "red", "start", provider);

			const redLog = nextState.conversationLogs.red ?? [];
			const toolCallEntry = redLog.find(
				(e) => e.kind === "tool-call" && e.toolName === "pick_up",
			);
			expect(toolCallEntry).toBeDefined();
			if (toolCallEntry?.kind === "tool-call") {
				expect(toolCallEntry.diskDelta).toBeUndefined();
			}
		});

		it("Test E: no cross-Daemon contamination (go action doesn't enrich other logs)", async () => {
			const game = makeGameWithCustomStarts({
				red: { position: { row: 4, col: 0 } },
				green: { position: { row: 2, col: 0 } },
				cyan: { position: { row: 4, col: 4 } },
			});

			const provider = firstTurnActs([
				toolCall("go_1", "go", { direction: "north" }),
			]);

			const { nextState } = await runRound(game, "red", "start", provider);

			const redLog = nextState.conversationLogs.red ?? [];
			const redToolCall = redLog.find(
				(e) => e.kind === "tool-call" && e.toolName === "go",
			);
			expect(
				redToolCall?.kind === "tool-call" && redToolCall.diskDelta,
			).toBeDefined();

			const greenLog = nextState.conversationLogs.green ?? [];
			const greenToolCalls = greenLog.filter((e) => e.kind === "tool-call");
			for (const entry of greenToolCalls) {
				if (entry.kind === "tool-call") {
					expect(entry.diskDelta).toBeUndefined();
				}
			}
		});
	});
});

describe("diskDelta persistence via diskEntities", () => {
	const ROW_STARTS = {
		red: { position: { row: 0, col: 0 } },
		green: { position: { row: 0, col: 1 } },
		cyan: { position: { row: 0, col: 2 } },
	};

	const COUNTDOWN_BEYOND_THESE_ROUNDS = 100;

	async function roundTwoWith(
		entities: WorldEntity[],
		placements: Record<string, { row: number; col: number }>,
		redToolCalls: Array<{ id: string; name: string; argumentsJson: string }>,
	) {
		const pack = makeTestPack(entities, {
			wallName: "wall",
			aiStarts: ROW_STARTS,
		});
		const started = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const game1 = {
			...started,
			complicationSchedule: {
				...started.complicationSchedule,
				countdown: COUNTDOWN_BEYOND_THESE_ROUNDS,
			},
		};
		const round1Result = await runRound(
			game1,
			"red",
			"hi",
			makeSilentProvider(),
		);
		const game2 = {
			...round1Result.nextState,
			world: {
				...round1Result.nextState.world,
				entities: round1Result.nextState.world.entities.map((e) => {
					const placed = placements[e.id];
					return placed ? { ...e, holder: placed } : e;
				}),
			},
		};
		const provider2 = firstTurnActs(redToolCalls);
		const round2Result = await runRound(game2, "red", "move", provider2, {
			rng: Math.random,
			priorToolRoundtrip: {},
			priorDiskSnapshots: {},
			priorDiskEntities: round1Result.diskEntities,
		});
		const prompt = provider2.calls[0]?.messages ?? [];
		const stateMessage = prompt[prompt.length - 1]?.content ?? "";
		return { round2Result, stateMessage };
	}

	function offGrid(id: string, name: string, description: string): WorldEntity {
		return {
			id,
			kind: "interesting_object",
			name,
			examineDescription: description,
			holder: { row: 10, col: 10 },
		};
	}

	const goSouth = {
		id: "go1",
		name: "go",
		argumentsJson: JSON.stringify({ direction: "south" }),
	};

	it("notices what the action itself brought into view", async () => {
		const { round2Result } = await roundTwoWith(
			[offGrid("far", "Far Lantern", "It glows.")],
			{ far: { row: 3, col: 0 } },
			[goSouth],
		);
		const goEntry = loggedToolCalls(round2Result.nextState, "red").find(
			(e) => e.toolCallId === "go1",
		);
		expect(goEntry?.diskDelta).toContain("Came into view: Far Lantern");
	});

	it("does not repeat in <noticed> what this turn's <whats_new> already showed", async () => {
		const { round2Result, stateMessage } = await roundTwoWith(
			[offGrid("near", "Near Crate", "A crate.")],
			{ near: { row: 2, col: 0 } },
			[goSouth],
		);
		expect(stateMessage).toContain("Came into view: Near Crate");
		const goEntry = loggedToolCalls(round2Result.nextState, "red").find(
			(e) => e.toolCallId === "go1",
		);
		expect(goEntry?.diskDelta ?? "").not.toContain(
			"Came into view: Near Crate",
		);
	});

	it("leaves a pick_up with nothing new in view without perception lines", async () => {
		const { round2Result, stateMessage } = await roundTwoWith(
			[
				offGrid("lamp", "Lamp", "A brass lamp."),
				offGrid("coin", "Coin", "A dull coin."),
			],
			{ lamp: { row: 1, col: 0 }, coin: { row: 2, col: 0 } },
			[
				{
					id: "pickup_lamp",
					name: "pick_up",
					argumentsJson: JSON.stringify({ item: "Lamp" }),
				},
			],
		);
		expect(stateMessage).toContain("Came into view: Coin");
		const pickUpEntry = loggedToolCalls(round2Result.nextState, "red").find(
			(e) => e.toolCallId === "pickup_lamp",
		);
		expect(pickUpEntry?.result).toContain("A brass lamp.");
		expect(pickUpEntry?.diskDelta).toBeUndefined();
	});

	it("merges perception-delta with actorDiskDelta when both exist", async () => {
		const { round2Result } = await roundTwoWith(
			[offGrid("item", "Treasure", "Gold coins.")],
			{ item: { row: 3, col: 0 } },
			[goSouth],
		);
		const goEntry = loggedToolCalls(round2Result.nextState, "red").find(
			(e) => e.toolCallId === "go1",
		);
		expect(goEntry?.diskDelta).toContain("+ at two steps south: Treasure");
		expect(goEntry?.diskDelta).toContain("Came into view: Treasure");
	});

	it("attaches perception delta to the action, not the message, in a two-call turn", async () => {
		const { round2Result } = await roundTwoWith(
			[offGrid("item", "Mysterious Box", "A sealed box.")],
			{ item: { row: 3, col: 0 } },
			[
				{
					id: "msg1",
					name: "message",
					argumentsJson: JSON.stringify({
						to: "blue",
						content: "Look at this!",
					}),
				},
				goSouth,
			],
		);
		const redLog = round2Result.nextState.conversationLogs.red ?? [];
		const messageEntry = redLog.find((e) => e.kind === "message");
		expect(messageEntry?.kind).toBe("message");
		expect(
			(messageEntry as { diskDelta?: unknown } | undefined)?.diskDelta,
		).toBeUndefined();
		const goEntry = loggedToolCalls(round2Result.nextState, "red").find(
			(e) => e.toolCallId === "go1",
		);
		expect(goEntry?.diskDelta).toContain("Came into view: Mysterious Box");
	});
});

describe("tool call ids", () => {
	it("gives missing and reused ids unique replacements so the replayed history has no duplicates", async () => {
		const round1 = firstTurnActs([
			toolCall("", "message", '{"to":"blue","content":"hi"}'),
			toolCall("", "message", '{"to":"blue","content":"again"}'),
			toolCall("call_0", "pick_up", '{"item":"flower"}'),
			toolCall("call_0", "go", '{"direction":"south"}'),
		]);
		const r1 = await runRound(makeGame(), "red", "hi", round1);

		const round2 = firstTurnActs([
			toolCall("call_0", "message", '{"to":"nobody","content":"hello?"}'),
			toolCall("", "go", "{not json"),
		]);
		const r2 = await runRound(r1.nextState, "red", "hi", round2, {
			priorToolRoundtrip: r1.toolRoundtrip,
			priorDiskSnapshots: r1.diskSnapshots,
			priorDiskEntities: r1.diskEntities,
		});

		const messages = buildOpenAiMessages(
			buildAiContext(r2.nextState, "red"),
			r2.toolRoundtrip.red,
			r2.nextState.round,
		);
		const calls = toolCallIdsIn(messages);
		const results = toolResultIdsIn(messages);
		expect(calls).toHaveLength(6);
		expect(calls.every((id) => id !== "")).toBe(true);
		expect(new Set(calls).size).toBe(calls.length);
		expect([...results].sort()).toEqual([...calls].sort());
	});
});
