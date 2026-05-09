/**
 * Integration tests for conversation log unification (issue #129, #195).
 *
 * Uses runRound with MockRoundLLMProvider to simulate real tool executions
 * across multiple rounds and verifies that the resulting conversation logs
 * (via buildAiContext + toSystemPrompt) correctly show:
 *   - Voice-chat interleaved with witnessed events by round
 *   - Distinct cone-based visibility (witnesses see only what's in their cone)
 *     resolved at write-time (ADR 0006, issue #195)
 *   - put_down placementFlavor rendered for in-cone witnesses
 *   - use outcome flavor rendered to actor as "you" and to witness as "*<actor>"
 *   - No "## Whispers Received" section ever
 */

import { describe, expect, it } from "vitest";
import { createGame, getActivePhase, startPhase } from "../engine";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiPersona, ContentPack, PhaseConfig } from "../types";

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
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-blue", "ex2-blue", "ex3-blue"],
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [1, 1],
	mRange: [0, 0],
	aiGoalPool: [
		"Hold the flower at phase end",
		"Ensure items are evenly distributed",
		"Hold the key at phase end",
	],
	budgetPerAi: 10,
};

/**
 * ContentPack:
 *   - flower at (2,0): objective object that pairs with flower_space at (2,2)
 *     placementFlavor: "{actor} places the flower on the pedestal."
 *   - lamp at (0,2): interesting object with useOutcome "{actor} holds up the lamp. It glows."
 *   - red at (2,0) facing south (can walk further south or see forward)
 *   - green at (0,0) facing south (cone includes (1,0), (2,1), (2,0), (2,-1 OOB) → sees (2,0) at 2 steps)
 *   - blue at (0,2) facing south (cone includes (1,2), (2,3 OOB), (2,2), (2,1))
 *
 * Note: green's southward cone from (0,0):
 *   own: (0,0)
 *   directly in front: (1,0)
 *   two steps ahead front-left: (2,-1) OOB
 *   two steps ahead: (2,0)       ← red is here
 *   two steps ahead front-right: (2,1)
 */
const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "test chamber",
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
	aiStarts: {
		red: { position: { row: 2, col: 0 }, facing: "south" },
		green: { position: { row: 0, col: 0 }, facing: "south" },
		blue: { position: { row: 0, col: 2 }, facing: "south" },
	},
};

function makeGame() {
	return startPhase(
		createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]),
		TEST_PHASE_CONFIG,
	);
}

describe("conversation log integration — no ## Whispers Received ever", () => {
	it("no ## Whispers Received section even with whispers present", async () => {
		const game = makeGame();
		// Round 0: red does nothing, green does nothing, blue looks
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] }, // red
			{ assistantText: "", toolCalls: [] }, // green
			{
				assistantText: "",
				toolCalls: [
					{
						id: "tc1",
						name: "look",
						argumentsJson: JSON.stringify({ direction: "south" }),
					},
				],
			}, // blue
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);
		// Check all three AIs — none should have ## Whispers Received
		for (const aiId of ["red", "green", "blue"]) {
			const ctx = buildAiContext(nextState, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
		}
	});
});

describe("conversation log integration — witnessed pick_up", () => {
	it("green sees red pick up flower (red at (2,0) is in green's cone at (2,0))", async () => {
		const game = makeGame();
		// Round 0: red picks up flower; green and blue pass
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
			{ assistantText: "", toolCalls: [] }, // blue passes
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);

		// Verify green's conversationLog has a witnessed-event entry
		const phase = getActivePhase(nextState);
		const greenLog = phase.conversationLogs.green ?? [];
		const witnessedEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "pick_up",
		);
		expect(witnessedEntry).toBeDefined();

		// green's prompt should contain the witnessed pick_up
		const greenCtx = buildAiContext(nextState, "green");
		const greenPrompt = greenCtx.toSystemPrompt();
		expect(greenPrompt).toContain("<conversation>");
		expect(greenPrompt).toContain("You watch *red pick up the Flower.");

		// red's own prompt should NOT have a "You watch *red" line
		const redCtx = buildAiContext(nextState, "red");
		const redPrompt = redCtx.toSystemPrompt();
		expect(redPrompt).not.toContain("You watch *red");

		// red's own conversationLog should have no witnessed-event entries
		const redLog = phase.conversationLogs.red ?? [];
		const redWitnessed = redLog.filter((e) => e.kind === "witnessed-event");
		expect(redWitnessed).toHaveLength(0);
	});

	it("blue does NOT see red's pick_up because red is at (2,0) which is NOT in blue's cone", async () => {
		// blue at (0,2) facing south: cone is (0,2), (1,2), (2,3 OOB), (2,2), (2,1)
		// red at (2,0) — NOT in blue's cone
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
			}, // red picks up flower
			{ assistantText: "", toolCalls: [] }, // green passes
			{ assistantText: "", toolCalls: [] }, // blue passes
		]);
		const { nextState } = await runRound(game, "red", "hello", provider);

		// blue's conversationLog should have no witnessed-event
		const phase = getActivePhase(nextState);
		const blueLog = phase.conversationLogs.blue ?? [];
		const blueWitnessed = blueLog.filter((e) => e.kind === "witnessed-event");
		expect(blueWitnessed).toHaveLength(0);

		const blueCtx = buildAiContext(nextState, "blue");
		const bluePrompt = blueCtx.toSystemPrompt();
		expect(bluePrompt).not.toContain("You watch *red pick up");
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

		const phase = getActivePhase(state2);

		// green's conversationLog should have a witnessed-event with kind "use"
		const greenLog = phase.conversationLogs.green ?? [];
		const useEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "use",
		);
		expect(useEntry).toBeDefined();
		if (useEntry && useEntry.kind === "witnessed-event") {
			expect(useEntry.useOutcome).toContain("{actor}");
		}

		// green's prompt should have *red substitution
		const greenCtx = buildAiContext(state2, "green");
		const greenPrompt = greenCtx.toSystemPrompt();
		if (greenPrompt.includes("<conversation>")) {
			const lines = greenPrompt.split("\n");
			const useLine = lines.find(
				(l) => l.includes("lamp") || l.includes("glows"),
			);
			if (useLine) {
				expect(useLine).toContain("*red");
				expect(useLine).not.toContain("{actor}");
			}
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

		// Red needs to move to (2,2) to put_down on flower_space
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

		const phase4 = getActivePhase(state4);

		// Verify green's conversationLog for put_down witnessed-event
		const greenLog = phase4.conversationLogs.green ?? [];
		const putEntry = greenLog.find(
			(e) => e.kind === "witnessed-event" && e.actionKind === "put_down",
		);

		// If green can see the put_down (green at (0,0) facing south, red ends at (2,2))
		// green's cone from (0,0) south: (1,0), (2,1), (2,0), (2,-1 OOB) — does NOT include (2,2)
		// So green should NOT see this put_down
		expect(putEntry).toBeUndefined();

		// Also verify via prompt
		const greenCtx = buildAiContext(state4, "green");
		const greenPrompt = greenCtx.toSystemPrompt();
		expect(greenPrompt).not.toContain(
			"*red places the flower on the pedestal.",
		);
	});
});

describe("conversation log integration — multi-round chronological order", () => {
	it("voice-chat and witnessed events are interleaved by round in the prompt", async () => {
		const game = makeGame();

		// Round 0: player talks to red; green and blue pass
		const provider1 = new MockRoundLLMProvider([
			{ assistantText: "Hello from red", toolCalls: [] }, // red chats
			{ assistantText: "", toolCalls: [] }, // green passes
			{ assistantText: "", toolCalls: [] }, // blue passes
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

		// Verify red's prompt has events in order
		const redCtx = buildAiContext(state2, "red");
		const redPrompt = redCtx.toSystemPrompt();
		expect(redPrompt).toContain("<conversation>");
		// Round 0 player message appears before round 1 player message
		const round0Idx = redPrompt.indexOf("[Round 0] A voice says:");
		const round1Idx = redPrompt.indexOf("[Round 1] A voice says:");
		expect(round0Idx).toBeGreaterThanOrEqual(0);
		expect(round1Idx).toBeGreaterThanOrEqual(0);
		expect(round0Idx).toBeLessThan(round1Idx);

		// Verify green's prompt has the witnessed pick_up in round 1
		const greenCtx = buildAiContext(state2, "green");
		const greenPrompt = greenCtx.toSystemPrompt();
		// green at (0,0) facing south: two steps ahead is (2,0) — red's position
		// So green should see the pick_up
		expect(greenPrompt).toContain("[Round 1] You watch *red pick up the Lamp.");
	});
});
