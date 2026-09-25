import { describe, expect, it } from "vitest";
import { startGame } from "../engine";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiId, AiPersona } from "../types";
import { makeTestPack } from "./fixtures/make-test-pack";

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

function expectedSilentTurn(_self: AiId): string {
	return "You have received no messages.";
}

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
			examineDescription: "A space",
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
	{
		wallName: "wall",
		aiStarts: {
			red: { position: { row: 0, col: 0 } },
			green: { position: { row: 0, col: 1 } },
			cyan: { position: { row: 0, col: 2 } },
		},
	},
);

function makeGame() {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
}

function isCurrentStateTurn(content: string | null | undefined): boolean {
	return typeof content === "string" && content.startsWith("<where_you_are>");
}

describe("non-addressed daemon never sees a stale user message as its last turn", () => {
	it("after addressing red then cyan, red's round-2 messages have the silent-voice anchor immediately before the current-state turn", async () => {
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		const r1 = await runRound(game, "red", "are you alive?", provider, {
			initiative,
		});

		await runRound(
			r1.nextState,
			"cyan",
			"different question for cyan",
			provider,
			{
				initiative,
				priorToolRoundtrip: r1.toolRoundtrip,
			},
		);

		expect(provider.calls).toHaveLength(6);

		const redRound2 = provider.calls[3];
		expect(redRound2).toBeDefined();
		const msgs = redRound2?.messages ?? [];

		const last = msgs[msgs.length - 1];
		expect(last?.role).toBe("user");
		expect(isCurrentStateTurn((last as { content: string }).content)).toBe(
			true,
		);

		const anchor = msgs[msgs.length - 2];
		expect(anchor?.role).toBe("user");
		expect((anchor as { content: string }).content).toBe(
			expectedSilentTurn("red"),
		);

		const priorUser = msgs.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: are you alive?",
		);
		expect(priorUser).toBeDefined();

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

		await runRound(game, "red", "hello red", provider, { initiative });

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
		const initiative: AiId[] = ["red", "green", "cyan"];
		const game = makeGame();

		const provider = new MockRoundLLMProvider([
			{
				assistantText: "",
				toolCall: {
					id: "call_msg_1",
					name: "message",
					argumentsJson: JSON.stringify({ to: "green", content: "psst green" }),
				},
			},
			{ assistantText: "", toolCalls: [] },
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(game, "red", "hi red", provider, { initiative });

		expect(provider.calls).toHaveLength(3);

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

		await runRound(game, "cyan", "hello cyan", provider, { initiative });

		expect(provider.calls).toHaveLength(3);

		const cyanCall = provider.calls[2];
		const cyanMsgs = cyanCall?.messages ?? [];
		const silentAnchor = expectedSilentTurn("cyan");

		expect(
			cyanMsgs.some(
				(m) =>
					m.role === "user" &&
					(m as { content: string }).content === silentAnchor,
			),
		).toBe(false);

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
