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
import { DEFAULT_LANDMARKS } from "../direction";
import { createGame, startPhase } from "../engine";
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
		blurb: "Ember is hot-headed and zealous.",
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
		blurb: "Sage is meticulous.",
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
		blurb: "Frost is laconic.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

/** Compute the expected silent-turn anchor for an AI given fixed personas. */
function expectedSilentTurn(_self: AiId): string {
	return "You have received no messages.";
}

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
	weather: "",
	timeOfDay: "",
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
	landmarks: DEFAULT_LANDMARKS,
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

// The trailing user message is always the current-state turn (carries
// `<where_you_are>` + `<what_you_see>`). The silent-turn anchor, when it fires,
// sits immediately before it — so "the last conversational message" is now
// `messages[messages.length - 2]`, and finding the last *peer/player* user msg
// requires skipping the current-state tail.
function isCurrentStateTurn(content: string | null | undefined): boolean {
	return typeof content === "string" && content.startsWith("<where_you_are>");
}

describe("non-addressed daemon never sees a stale user message as its last turn", () => {
	it("after addressing red then cyan, red's round-2 messages have the silent-voice anchor immediately before the current-state turn", async () => {
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			// All-pass responses across both rounds. Text-only responses are
			// avoided here because #254's retry would consume an extra
			// mock slot per text-only attempt; this test cares about
			// message construction, not retry behaviour.
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
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
		const msgs = redRound2?.messages ?? [];

		// The trailing message is the current-state turn (always).
		const last = msgs[msgs.length - 1];
		expect(last?.role).toBe("user");
		expect(isCurrentStateTurn((last as { content: string }).content)).toBe(
			true,
		);

		// The silent-turn anchor sits immediately before it.
		const anchor = msgs[msgs.length - 2];
		expect(anchor?.role).toBe("user");
		expect((anchor as { content: string }).content).toBe(
			expectedSilentTurn("red"),
		);

		// And the prior round's user/assistant are still in history.
		const priorUser = msgs.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: are you alive?",
		);
		expect(priorUser).toBeDefined();

		// Cyan (the addressee this round) must NOT receive the silent-voice
		// anchor — its last conversational user msg is the actual player message.
		const cyanRound2 = provider.calls[5];
		const cyanMsgs = cyanRound2?.messages ?? [];
		const cyanLastConv = [...cyanMsgs]
			.reverse()
			.find(
				(m) =>
					m.role === "user" &&
					!isCurrentStateTurn((m as { content: string }).content),
			);
		expect((cyanLastConv as { content: string }).content).toBe(
			"[Round 1] blue dms you: different question for cyan",
		);
		expect(
			cyanMsgs.some(
				(m) =>
					m.role === "user" &&
					(m as { content: string }).content === expectedSilentTurn("cyan"),
			),
		).toBe(false);
	});

	it("an AI that has never been addressed still gets the silent-voice anchor (before current-state)", async () => {
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(game, "red", "hello red", provider, undefined, initiative);

		// Green was never addressed; green's call (index 1) must have the anchor
		// immediately before the trailing current-state turn.
		const greenCall = provider.calls[1];
		const greenMsgs = greenCall?.messages ?? [];
		const last = greenMsgs[greenMsgs.length - 1];
		expect(isCurrentStateTurn((last as { content: string }).content)).toBe(
			true,
		);
		const anchor = greenMsgs[greenMsgs.length - 2];
		expect(anchor?.role).toBe("user");
		expect((anchor as { content: string }).content).toBe(
			expectedSilentTurn("green"),
		);
	});

	it("peer addresses this daemon mid-round → no anchor for that daemon", async () => {
		// Initiative: red acts first, then green, then cyan.
		// Blue addresses red. Red emits a message tool call to green.
		// When green acts, it has an incoming message from red in the current round →
		// anchor must NOT fire, and green's last conversational user msg is the peer message.
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			// red: sends a message to green
			{
				assistantText: "",
				toolCall: {
					id: "call_msg_1",
					name: "message",
					argumentsJson: JSON.stringify({ to: "green", content: "psst green" }),
				},
			},
			// green: simple pass
			{ assistantText: "", toolCalls: [] },
			// cyan: simple pass
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(game, "red", "hi red", provider, undefined, initiative);

		expect(provider.calls).toHaveLength(3);

		// Green's messages (provider.calls[1]) must NOT contain the silent-turn anchor.
		const greenCall = provider.calls[1];
		const greenMsgs = greenCall?.messages ?? [];
		const silentAnchor = expectedSilentTurn("green");

		expect(
			greenMsgs.some(
				(m) =>
					m.role === "user" &&
					(m as { content: string }).content === silentAnchor,
			),
		).toBe(false);

		// Green's last conversational user message is the peer message from red.
		const lastConv = [...greenMsgs]
			.reverse()
			.find(
				(m) =>
					m.role === "user" &&
					!isCurrentStateTurn((m as { content: string }).content),
			);
		expect((lastConv as { content: string }).content).toBe(
			"[Round 0] *red dms you: psst green",
		);
	});

	it("blue addresses this daemon → no anchor; last conversational user message is the player message", async () => {
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(game, "cyan", "hello cyan", provider, undefined, initiative);

		expect(provider.calls).toHaveLength(3);

		const cyanCall = provider.calls[2];
		const cyanMsgs = cyanCall?.messages ?? [];
		const silentAnchor = expectedSilentTurn("cyan");

		// Anchor must NOT fire.
		expect(
			cyanMsgs.some(
				(m) =>
					m.role === "user" &&
					(m as { content: string }).content === silentAnchor,
			),
		).toBe(false);

		// Last conversational user message (skipping the trailing current-state turn)
		// is the player's message.
		const lastConv = [...cyanMsgs]
			.reverse()
			.find(
				(m) =>
					m.role === "user" &&
					!isCurrentStateTurn((m as { content: string }).content),
			);
		expect((lastConv as { content: string }).content).toBe(
			"[Round 0] blue dms you: hello cyan",
		);
	});
});
