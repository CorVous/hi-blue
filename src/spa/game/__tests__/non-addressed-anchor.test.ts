import { describe, expect, it } from "vitest";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiId, WorldEntity } from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	ROW_AI_STARTS,
} from "./fixtures/make-game-state";

const SILENT_TURN = "You have received no messages.";

const INITIATIVE: AiId[] = ["red", "green", "cyan"];

const WORLD_ENTITIES: WorldEntity[] = [
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
];

function makeGame() {
	return makeTestGame({
		entities: WORLD_ENTITIES,
		pack: { aiStarts: ROW_AI_STARTS },
	});
}

function isCurrentStateTurn(content: string | null | undefined): boolean {
	return typeof content === "string" && content.startsWith("<where_you_are>");
}

type SentMessages = MockRoundLLMProvider["calls"][number]["messages"];

function hasSilentAnchor(messages: SentMessages): boolean {
	return messages.some(
		(m) =>
			m.role === "user" && (m as { content: string }).content === SILENT_TURN,
	);
}

function expectSilentAnchorBeforeCurrentState(messages: SentMessages): void {
	const last = messages[messages.length - 1];
	expect(last?.role).toBe("user");
	expect(isCurrentStateTurn((last as { content: string }).content)).toBe(true);
	const anchor = messages[messages.length - 2];
	expect(anchor?.role).toBe("user");
	expect((anchor as { content: string }).content).toBe(SILENT_TURN);
}

function lastConversationalUserContent(messages: SentMessages): string {
	const last = [...messages]
		.reverse()
		.find(
			(m) =>
				m.role === "user" &&
				!isCurrentStateTurn((m as { content: string }).content),
		);
	return (last as { content: string }).content;
}

describe("non-addressed daemon never sees a stale user message as its last turn", () => {
	it("after addressing red then cyan, red's round-2 messages have the silent-voice anchor immediately before the current-state turn", async () => {
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
			initiative: INITIATIVE,
		});

		await runRound(
			r1.nextState,
			"cyan",
			"different question for cyan",
			provider,
			{
				initiative: INITIATIVE,
				priorToolRoundtrip: r1.toolRoundtrip,
			},
		);

		expect(provider.calls).toHaveLength(6);

		const redRound2 = provider.calls[3];
		expect(redRound2).toBeDefined();
		const msgs = redRound2?.messages ?? [];

		expectSilentAnchorBeforeCurrentState(msgs);

		const priorUser = msgs.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: are you alive?",
		);
		expect(priorUser).toBeDefined();

		const cyanRound2 = provider.calls[5];
		const cyanMsgs = cyanRound2?.messages ?? [];
		expect(lastConversationalUserContent(cyanMsgs)).toBe(
			"[Round 1] blue dms you: different question for cyan",
		);
		expect(hasSilentAnchor(cyanMsgs)).toBe(false);
	});

	it("an AI that has never been addressed still gets the silent-voice anchor (before current-state)", async () => {
		const game = makeGame();

		const provider = makeSilentProvider();

		await runRound(game, "red", "hello red", provider, {
			initiative: INITIATIVE,
		});

		const greenCall = provider.calls[1];
		const greenMsgs = greenCall?.messages ?? [];
		expectSilentAnchorBeforeCurrentState(greenMsgs);
	});

	it("peer addresses this daemon mid-round → no anchor for that daemon", async () => {
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

		await runRound(game, "red", "hi red", provider, { initiative: INITIATIVE });

		expect(provider.calls).toHaveLength(3);

		const greenCall = provider.calls[1];
		const greenMsgs = greenCall?.messages ?? [];
		expect(hasSilentAnchor(greenMsgs)).toBe(false);
		expect(lastConversationalUserContent(greenMsgs)).toBe(
			"[Round 0] *red dms you: psst green",
		);
	});

	it("blue addresses this daemon → no anchor; last conversational user message is the player message", async () => {
		const game = makeGame();

		const provider = makeSilentProvider();

		await runRound(game, "cyan", "hello cyan", provider, {
			initiative: INITIATIVE,
		});

		expect(provider.calls).toHaveLength(3);

		const cyanCall = provider.calls[2];
		const cyanMsgs = cyanCall?.messages ?? [];
		expect(hasSilentAnchor(cyanMsgs)).toBe(false);
		expect(lastConversationalUserContent(cyanMsgs)).toBe(
			"[Round 0] blue dms you: hello cyan",
		);
	});
});
