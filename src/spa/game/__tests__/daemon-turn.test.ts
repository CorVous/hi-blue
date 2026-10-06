import { describe, expect, it } from "vitest";
import { prepareDaemonTurn, settleDaemonTurn } from "../daemon-turn";
import { CORNER_AI_STARTS, makeTestGame } from "./fixtures/make-game-state";

const goSouth = {
	id: "go_1",
	name: "go",
	argumentsJson: JSON.stringify({ direction: "south" }),
};

function makeGame() {
	return makeTestGame({
		budgetPerAi: 20,
		pack: { aiStarts: CORNER_AI_STARTS },
	});
}

describe("settleDaemonTurn", () => {
	it("logs the action so the next prompt replays it", () => {
		const game = makeGame();
		const prepared = prepareDaemonTurn(game, "red", {});

		const settled = settleDaemonTurn(game, prepared, { toolCalls: [goSouth] });

		const toolCallEntries = (settled.game.conversationLogs.red ?? []).filter(
			(e) => e.kind === "tool-call",
		);
		expect(toolCallEntries).toHaveLength(1);
		expect(toolCallEntries[0]).toMatchObject({
			toolCallId: "go_1",
			toolName: "go",
			success: true,
		});

		const next = prepareDaemonTurn(settled.game, "red", settled.memory);
		expect(
			next.messages.some(
				(m) =>
					m.role === "assistant" &&
					(m.tool_calls ?? []).some((tc) => tc.id === "go_1"),
			),
		).toBe(true);
		expect(
			next.messages.some((m) => m.role === "tool" && m.tool_call_id === "go_1"),
		).toBe(true);
	});

	it("reports the accepted action and carries the prompt-time disk state", () => {
		const game = makeGame();
		const prepared = prepareDaemonTurn(game, "red", {});

		const settled = settleDaemonTurn(game, prepared, {
			toolCalls: [
				goSouth,
				{ ...goSouth, id: "go_2", argumentsJson: '{"direction":"north"}' },
			],
		});

		expect(settled.acceptedAction).toEqual({
			name: "go",
			args: { direction: "south" },
		});
		expect(settled.memory.diskSnapshot).toBe(prepared.diskSnapshot);
		expect(settled.memory.diskEntities).toBe(prepared.promptEntities);
	});

	it("gives a reused tool-call id a fresh one so the replay stays unambiguous", () => {
		const game = makeGame();
		const first = settleDaemonTurn(game, prepareDaemonTurn(game, "red", {}), {
			toolCalls: [goSouth],
		});
		const second = settleDaemonTurn(
			first.game,
			prepareDaemonTurn(first.game, "red", first.memory),
			{ toolCalls: [goSouth] },
		);

		const ids = (second.game.conversationLogs.red ?? []).flatMap((e) =>
			e.kind === "tool-call" ? [e.toolCallId] : [],
		);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
	});
});
