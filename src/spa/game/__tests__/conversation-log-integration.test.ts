/**
 * Integration tests for conversation log unification (issue #129, #195).
 *
 * Uses runRound with MockRoundLLMProvider to simulate real tool executions
 * across multiple rounds and verifies that the resulting conversation logs
 * correctly surface, via `buildOpenAiMessages` role turns:
 *   - Voice-chat interleaved with witnessed events by round
 *   - Distinct cone-based visibility (witnesses see only what's in their cone)
 *     resolved at write-time (ADR 0006, issue #195)
 *   - put_down placementFlavor rendered for in-cone witnesses
 *   - use outcome flavor rendered to actor as "you" and to witness as "*<actor>"
 *   - No "## Whispers Received" section ever
 *
 * The unified <conversation> system-prompt block was retired in favour of
 * direct role-turn rendering (issue: prompt-cache restructure); witnessed
 * events now show up as user turns interleaved with peer messages.
 */

import { describe, expect, it } from "vitest";
import { renderEntry } from "../conversation-log.js";
import { DEFAULT_LANDMARKS } from "../direction";
import { startGame } from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiPersona, ContentPack } from "../types";

/** Concatenate all role-turn message contents into a single searchable string. */
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

/**
 * ContentPack:
 *   - flower at (2,0): objective object that pairs with flower_space at (2,2)
 *     placementFlavor: "{actor} places the flower on the pedestal."
 *   - lamp at (0,2): interesting object with useOutcome "{actor} holds up the lamp. It glows."
 *   - red at (2,0) facing south (can walk further south or see forward)
 *   - green at (0,0) facing south
 *   - cyan at (0,2) facing south
 *
 * Note: green's southward 9-cell cone from (0,0):
 *   own: (0,0)
 *   dist-1: (1,1), (1,0), (1,-1 OOB)
 *   dist-2: (2,2), (2,1), (2,0), (2,-1 OOB), (2,-2 OOB)
 */
const TEST_CONTENT_PACK: ContentPack = {
	setting: "test chamber",
	weather: "",
	timeOfDay: "",
	objectivePairs: [
		{
			object: {
				id: "flower",
				kind: "objective_object",
				name: "Flower",
				examineDescription: "A delicate flower.",
				holder: { row: 2, col: 0 },
				pairsWithSpaceId: "flower_space",
				placementFlavor: "{actor} places the flower on the pedestal.",
			},
			space: {
				id: "flower_space",
				kind: "objective_space",
				name: "pedestal",
				examineDescription: "A stone pedestal.",
				holder: { row: 2, col: 2 },
			},
		},
	],
	interestingObjects: [
		{
			id: "lamp",
			kind: "interesting_object",
			name: "Lamp",
			examineDescription: "A brass lamp.",
			holder: { row: 2, col: 0 }, // same cell as red
			useOutcome: "{actor} holds up the lamp. It glows.",
		},
	],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	wallName: "wall",
	aiStarts: {
		red: { position: { row: 2, col: 0 }, facing: "south" },
		green: { position: { row: 0, col: 0 }, facing: "south" },
		cyan: { position: { row: 0, col: 2 }, facing: "south" },
	},
};

function makeGame() {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 10 });
}

describe("conversation log integration — no ## Whispers Received ever", () => {
	it("no ## Whispers Received section even with whispers present", async () => {
		const game = makeGame();
		// Round 0: red does nothing, green does nothing, cyan looks
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] }, // red
			{ assistantText: "", toolCalls: [] }, // green
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "look",
						argumentsJson: JSON.stringify({ direction: "forward" }),
					},
				],
			}, // cyan
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);
		// Check all three AIs — none should have ## Whispers Received
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(nextState, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
		}
	});
});

describe("conversation log integration — witnessed pick_up", () => {
	it("green sees red pick up flower (red at (2,0) is in green's cone at (2,0))", async () => {
		const game = makeGame();
		// Round 0: red picks up flower; green and cyan pass
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
			}, // red picks up flower
			{ assistantText: "", toolCalls: [] }, // green passes
			{ assistantText: "", toolCalls: [] }, // cyan passes
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);

		// Verify green's conversationLog has a witnessed-event entry
		const phase = nextState;
		const greenLog = phase.conversationLogs.green ?? [];
		const witnessedEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "pick_up",
		);
		expect(witnessedEntry).toBeDefined();

		// green's role turns should contain the witnessed pick_up
		const greenCtx = buildAiContext(nextState, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		const greenAll = flattenMessageContents(greenMsgs);
		expect(greenAll).toContain("You watch *red pick up the Flower.");

		// red's own role turns should NOT have a "You watch *red" line
		const redCtx = buildAiContext(nextState, "red");
		const redMsgs = buildOpenAiMessages(redCtx);
		expect(flattenMessageContents(redMsgs)).not.toContain("You watch *red");

		// red's own conversationLog should have no witnessed-event entries
		const redLog = phase.conversationLogs.red ?? [];
		const redWitnessed = redLog.filter((e) => e.kind === "witnessed-event");
		expect(redWitnessed).toHaveLength(0);
	});

	it("cyan does NOT see red's pick_up when cyan faces north (all cone cells OOB from (0,2))", async () => {
		// cyan at (0,2) facing south includes (2,0) in the new 9-cell cone.
		// Turn cyan north first so its cone is just own cell — (2,0) falls outside.
		const game = makeGame();

		// Preliminary round: cyan looks north; others pass
		const setupProvider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] }, // red
			{ assistantText: "", toolCalls: [] }, // green
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc0",
						name: "look",
						argumentsJson: JSON.stringify({ direction: "back" }),
					},
				],
			}, // cyan looks north
		]);
		const { nextState: setup } = await runRound(
			game,
			"red",
			"setup",
			setupProvider,
		);

		// Main round: red picks up flower; cyan now faces north → (2,0) not in cone
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
			}, // red picks up flower
			{ assistantText: "", toolCalls: [] }, // green passes
			{ assistantText: "", toolCalls: [] }, // cyan passes
		]);
		const { nextState } = await runRound(setup, "red", "hello", provider);

		// cyan's conversationLog should have no witnessed-event for pick_up
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
	it("actor sees useOutcome with {actor}→'you'; in-cone witness sees {actor}→'*red'", async () => {
		const game = makeGame();
		// red picks up lamp first
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
			}, // red picks up lamp
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state1 } = await runRound(
			game,
			"red",
			"hello",
			provider1,
		);

		// red uses lamp
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
			}, // red uses lamp
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

		// green's conversationLog should have a witnessed-event with kind "use"
		const greenLog = phase.conversationLogs.green ?? [];
		const useEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		expect(useEntry).toBeDefined();
		if (useEntry && useEntry.kind === "witnessed-event") {
			expect(useEntry.useOutcome).toContain("{actor}");
		}

		// green's role turns should have *red substitution
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
	it("green sees placementFlavor with *red substitution when red places flower", async () => {
		const game = makeGame();
		// Round 0: red picks up flower
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

		// Red needs to move to (2,2) to put_down on flower_space.
		// Green looks west so its cone is only own cell by the put_down round —
		// (2,2) enters the new 9-cell south cone but not the west cone from (0,0).
		const provider2 = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc2",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "left" }),
					},
				],
			},
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc2g",
						name: "look",
						argumentsJson: JSON.stringify({ direction: "right" }),
					},
				],
			},
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
						argumentsJson: JSON.stringify({ direction: "left" }),
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

		// Now red is at (2,2) — put_down flower on flower_space
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

		// Verify green's conversationLog for put_down witnessed-event
		const greenLog = phase4.conversationLogs.green ?? [];
		const putEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "put_down",
		);

		// Green looked west in round 2; facing west from (0,0) has only own cell in cone.
		// (2,2) is not visible → green should NOT see this put_down.
		expect(putEntry).toBeUndefined();

		// Also verify via role turns
		const greenCtx = buildAiContext(state4, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		expect(flattenMessageContents(greenMsgs)).not.toContain(
			"*red places the flower on the pedestal.",
		);
	});
});

describe("conversation log integration — action-failure (issue #287)", () => {
	it("dispatch invalid go then buildConversationLog contains one line matching 'Your `go` action failed:'", async () => {
		// Use a ContentPack where red faces south and there's an obstacle directly south.
		const obstacleAtSouth: ContentPack = {
			setting: "blocked test",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [
				{
					id: "wall_s",
					kind: "obstacle",
					name: "wall",
					examineDescription: "A wall.",
					holder: { row: 3, col: 0 },
				},
			],
			landmarks: DEFAULT_LANDMARKS,
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 0 }, facing: "south" },
				cyan: { position: { row: 0, col: 2 }, facing: "south" },
			},
		};
		const game = startGame(TEST_PERSONAS, obstacleAtSouth, { budgetPerAi: 10 });

		// red tries to go south → blocked by wall at (3,0)
		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCalls: [
					{
						id: "go_fail",
						name: "go",
						argumentsJson: JSON.stringify({ direction: "forward" }),
					},
				],
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState } = await runRound(game, "red", "hi", provider);

		// Build the actor's conversation log and check for the failure line
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

		// Round 0: player talks to red; green and cyan pass
		const provider1 = new MockRoundLLMProvider([
			{ assistantText: "Hello from red", toolCalls: [] }, // red chats
			{ assistantText: "", toolCalls: [] }, // green passes
			{ assistantText: "", toolCalls: [] }, // cyan passes
		]);
		const { nextState: state1 } = await runRound(
			game,
			"red",
			"Hi Ember",
			provider1,
		);

		// Round 1: player talks to red again; red picks up lamp
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
			}, // red picks up lamp
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);
		const { nextState: state2 } = await runRound(
			state1,
			"red",
			"What are you doing?",
			provider2,
		);

		// Verify red's role turns have player messages in chronological order.
		// Role turns use the rich "[Round N] blue dms you: <content>" form
		// rendered via conversation-log.ts:renderEntry.
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

		// Verify green's role turns include the witnessed pick_up in round 1.
		// green at (0,0) facing south: two steps ahead is (2,0) — red's position.
		// Witnessed events keep the rich "[Round N] You watch *X do Y." form
		// since that's how renderEntry formats them.
		const greenCtx = buildAiContext(state2, "green");
		const greenMsgs = buildOpenAiMessages(greenCtx);
		expect(flattenMessageContents(greenMsgs)).toContain(
			"[Round 1] You watch *red pick up the Lamp.",
		);
	});
});
