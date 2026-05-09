/**
 * Regression: a non-addressed daemon must not see a stale user/assistant pair
 * as the tail of its OpenAI messages array.
 *
 * Without the fix, when daemon X was addressed in round N-1 and not in round N,
 * X's round-N call ended with `[..., user "<prev msg>", assistant "<X's reply>"]`.
 * The model treated that prior user message as the freshest stimulus and
 * re-responded to it (player symptom: "the other AI acts like I just sent them
 * the last message I sent them again").
 *
 * Fix: append a synthetic `user: "Blue: "` (empty Blue message) turn for any
 * non-addressed daemon, anchoring the current round.
 */
import { describe, expect, it } from "vitest";
import { createGame, startPhase } from "../engine";
import { SILENT_BLUE_TURN } from "../openai-message-builder";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiId, AiPersona, ContentPack, PhaseConfig } from "../types";

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
		blurb: "You are hot-headed and zealous.",
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
		blurb: "You are meticulous.",
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
		blurb: "You are laconic.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [1, 1],
	mRange: [0, 0],
	aiGoalPool: ["g1", "g2", "g3"],
	budgetPerAi: 5,
};

const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "",
	objectivePairs: [
		{
			object: {
				id: "flower",
				kind: "objective_object",
				name: "flower",
				examineDescription: "A flower",
				holder: { row: 0, col: 0 },
				pairsWithSpaceId: "flower_space",
			},
			space: {
				id: "flower_space",
				kind: "objective_space",
				name: "flower space",
				examineDescription: "A space",
				holder: { row: 4, col: 4 },
			},
		},
	],
	interestingObjects: [
		{
			id: "key",
			kind: "interesting_object",
			name: "key",
			examineDescription: "A key",
			holder: { row: 0, col: 1 },
		},
	],
	obstacles: [],
	aiStarts: {
		red: { position: { row: 0, col: 0 }, facing: "north" },
		green: { position: { row: 0, col: 1 }, facing: "north" },
		cyan: { position: { row: 0, col: 2 }, facing: "north" },
	},
};

function makeGame() {
	return startPhase(
		createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]),
		TEST_PHASE_CONFIG,
	);
}

describe("non-addressed daemon never sees a stale user message as its last turn", () => {
	it("after addressing red then cyan, red's round-2 messages end with the silent-voice anchor (not the prior user/assistant)", async () => {
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{ assistantText: "Hi, I am Ember.", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "<red round 2>", toolCalls: [] },
			{ assistantText: "<green round 2>", toolCalls: [] },
			{ assistantText: "<cyan round 2>", toolCalls: [] },
		]);

		const r1 = await runRound(
			game,
			"red",
			"are you alive?",
			provider,
			undefined,
			initiative,
		);

		await runRound(
			r1.nextState,
			"cyan",
			"different question for cyan",
			provider,
			undefined,
			initiative,
			r1.toolRoundtrip,
		);

		expect(provider.calls).toHaveLength(6);

		const redRound2 = provider.calls[3];
		expect(redRound2).toBeDefined();
		const msgs = redRound2!.messages;

		// Last message anchors the current round.
		const last = msgs[msgs.length - 1];
		expect(last?.role).toBe("user");
		expect((last as { content: string }).content).toBe(SILENT_BLUE_TURN);

		// And the prior round's user/assistant are still in history but no longer
		// at the tail.
		const lastUser = [...msgs].reverse().find((m) => m.role === "user");
		expect((lastUser as { content: string }).content).toBe(SILENT_BLUE_TURN);
		const priorUser = msgs.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content === "are you alive?",
		);
		expect(priorUser).toBeDefined();

		// Cyan (the addressee this round) must NOT receive the silent-voice
		// anchor — its tail is the actual player message.
		const cyanRound2 = provider.calls[5];
		const cyanMsgs = cyanRound2!.messages;
		const cyanLastUser = [...cyanMsgs].reverse().find((m) => m.role === "user");
		expect((cyanLastUser as { content: string }).content).toBe(
			"different question for cyan",
		);
		expect(
			cyanMsgs.some(
				(m) =>
					m.role === "user" &&
					(m as { content: string }).content === SILENT_BLUE_TURN,
			),
		).toBe(false);
	});

	it("an AI that has never been addressed still gets the silent-voice anchor", async () => {
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{ assistantText: "<red>", toolCalls: [] },
			{ assistantText: "<green>", toolCalls: [] },
			{ assistantText: "<cyan>", toolCalls: [] },
		]);

		await runRound(game, "red", "hello red", provider, undefined, initiative);

		// Green was never addressed; green's call (index 1) must end with the anchor.
		const greenCall = provider.calls[1];
		const greenMsgs = greenCall!.messages;
		const last = greenMsgs[greenMsgs.length - 1];
		expect(last?.role).toBe("user");
		expect((last as { content: string }).content).toBe(SILENT_BLUE_TURN);
	});
});
