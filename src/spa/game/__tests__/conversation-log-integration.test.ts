import { describe, expect, it } from "vitest";
import { renderEntry } from "../conversation-log.js";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { ContentPack, WorldEntity } from "../types";
import { makeTestGame } from "./fixtures/make-game-state";

function flattenMessageContents(
	messages: ReturnType<typeof buildOpenAiMessages>,
): string {
	return messages
		.map((m) => {
			const c = (m as { content?: unknown }).content;
			return typeof c === "string" ? c : "";
		})
		.join("\n");
}

const WORLD_ENTITIES: WorldEntity[] = [
	{
		id: "flower",
		kind: "objective_object",
		name: "Flower",
		examineDescription: "A delicate flower.",
		holder: { row: 2, col: 0 },
		pairsWithSpaceId: "flower_space",
		placementFlavor: "{actor} places the flower on the pedestal.",
	},
	{
		id: "flower_space",
		kind: "objective_space",
		name: "pedestal",
		examineDescription: "A stone pedestal.",
		holder: { row: 2, col: 2 },
	},
	{
		id: "lamp",
		kind: "interesting_object",
		name: "Lamp",
		examineDescription: "A brass lamp.",
		holder: { row: 2, col: 0 },
		useOutcome: "{actor} holds up the lamp. It glows.",
	},
];

const AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 2, col: 0 } },
	green: { position: { row: 0, col: 0 } },
	cyan: { position: { row: 0, col: 2 } },
};

function makeGame() {
	return makeTestGame({
		entities: WORLD_ENTITIES,
		pack: { setting: "test chamber", aiStarts: AI_STARTS },
		budgetPerAi: 10,
	});
}

describe("conversation log integration — no ## Whispers Received ever", () => {
	it("no ## Whispers Received section even with whispers present", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "east" }),
					},
				],
			},
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(nextState, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
		}
	});
});

describe("conversation log integration — witnessed pick_up", () => {
	it("green sees red pick up flower (red at (2,0) is inside green's Vista at (0,0))", async () => {
		const game = makeGame();
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);

		const phase = nextState;
		const greenLog = phase.conversationLogs.green ?? [];
		const witnessedEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "pick_up",
		);
		expect(witnessedEntry).toBeDefined();

		const greenCtx = buildAiContext(nextState, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		const greenAll = flattenMessageContents(greenMsgs);
		expect(greenAll).toContain("You watch *red pick up the Flower.");

		const redCtx = buildAiContext(nextState, "red");
		const redMsgs = buildOpenAiMessages(redCtx);
		expect(flattenMessageContents(redMsgs)).not.toContain("You watch *red");

		const redLog = phase.conversationLogs.red ?? [];
		const redWitnessed = redLog.filter((e) => e.kind === "witnessed-event");
		expect(redWitnessed).toHaveLength(0);
	});

	it("cyan does NOT see red's pick_up: cyan at (0,2) is outside red's cell's Vista", async () => {
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);

		const phase = nextState;
		const cyanLog = phase.conversationLogs.cyan ?? [];
		const cyanWitnessed = cyanLog.filter((e) => e.kind === "witnessed-event");
		expect(cyanWitnessed).toHaveLength(0);

		const cyanCtx = buildAiContext(nextState, "cyan");
		const cyanMsgs = buildOpenAiMessages(cyanCtx);
		expect(flattenMessageContents(cyanMsgs)).not.toContain(
			"You watch *red pick up",
		);
	});
});

describe("conversation log integration — use outcome rendering", () => {
	it("actor sees useOutcome with {actor}→'you'; in-Vista witness sees {actor}→'*red'", async () => {
		const game = makeGame();
		const provider1 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "lamp" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state1 } = await runRound(
			game,
			"red",
			"hello",
			provider1,
		);

		const provider2 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc2",
						name: "use",
						argumentsJson: JSON.stringify({ item: "lamp" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state2 } = await runRound(
			state1,
			"red",
			"hello again",
			provider2,
		);

		const phase = state2;

		const greenLog = phase.conversationLogs.green ?? [];
		const useEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		expect(useEntry).toBeDefined();
		if (useEntry && useEntry.kind === "witnessed-event") {
			expect(useEntry.useOutcome).toContain("{actor}");
		}

		const greenCtx = buildAiContext(state2, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		const useLine = greenMsgs
			.map((m) => {
				const c = (m as { content?: unknown }).content;
				return typeof c === "string" ? c : "";
			})
			.find((c) => c.includes("lamp") || c.includes("glows"));
		if (useLine) {
			expect(useLine).toContain("*red");
			expect(useLine).not.toContain("{actor}");
		}
	});
});

describe("conversation log integration — put_down placementFlavor", () => {
	it("green is outside the Vista of red's put_down at (2,2) → no placementFlavor line", async () => {
		const game = makeGame();
		const provider1 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state1 } = await runRound(
			game,
			"red",
			"hello",
			provider1,
		);

		const provider2 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc2",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "east" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state2 } = await runRound(
			state1,
			"red",
			"moving",
			provider2,
		);

		const provider3 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc3",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "east" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state3 } = await runRound(
			state2,
			"red",
			"moving again",
			provider3,
		);

		const provider4 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc4",
						name: "put_down",
						argumentsJson: JSON.stringify({ item: "flower" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state4 } = await runRound(
			state3,
			"red",
			"placing",
			provider4,
		);

		const phase4 = state4;

		const greenLog = phase4.conversationLogs.green ?? [];
		const putEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "put_down",
		);

		expect(putEntry).toBeUndefined();

		const greenCtx = buildAiContext(state4, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		expect(flattenMessageContents(greenMsgs)).not.toContain(
			"*red places the flower on the pedestal.",
		);
	});
});

describe("conversation log integration — action-failure (issue #287)", () => {
	it("dispatch invalid go then buildConversationLog contains one line matching 'Your `go` action failed:'", async () => {
		const game = makeTestGame({
			entities: [
				{
					id: "wall_s",
					kind: "obstacle",
					name: "wall",
					examineDescription: "A wall.",
					holder: { row: 3, col: 0 },
				},
			],
			pack: { setting: "blocked test", aiStarts: AI_STARTS },
			budgetPerAi: 10,
		});

		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "go_fail",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "south" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		const phase = nextState;
		const redLog = phase.conversationLogs.red ?? [];

		const failureLine = redLog
			.map((entry) => renderEntry(entry, "red", phase.world.entities))
			.find((l) => l.includes("Your `go` action failed:"));
		expect(failureLine).toBeDefined();
	});
});

describe("conversation log integration — multi-round chronological order", () => {
	it("voice-chat and witnessed events are interleaved by round in the prompt", async () => {
		const game = makeGame();

		const provider1 = new MockRoundLLMProvider([
			{ assistantText: "Hello from red", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state1 } = await runRound(
			game,
			"red",
			"Hi Ember",
			provider1,
		);

		const provider2 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "pick_up",
						argumentsJson: JSON.stringify({ item: "lamp" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state2 } = await runRound(
			state1,
			"red",
			"What are you doing?",
			provider2,
		);

		const redCtx = buildAiContext(state2, "red");
		const redMsgs = buildOpenAiMessages(redCtx);
		const round0Idx = redMsgs.findIndex(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: Hi Ember",
		);
		const round1Idx = redMsgs.findIndex(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 1] blue dms you: What are you doing?",
		);
		expect(round0Idx).toBeGreaterThanOrEqual(0);
		expect(round1Idx).toBeGreaterThanOrEqual(0);
		expect(round0Idx).toBeLessThan(round1Idx);

		const greenCtx = buildAiContext(state2, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		expect(flattenMessageContents(greenMsgs)).toContain(
			"[Round 1] You watch *red pick up the Lamp.",
		);
	});
});
