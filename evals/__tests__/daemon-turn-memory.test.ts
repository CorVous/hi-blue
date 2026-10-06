import { describe, expect, it } from "vitest";
import {
	CORNER_AI_STARTS,
	makeTestGame,
} from "../../src/spa/game/__tests__/fixtures/make-game-state.js";
import {
	prepareDaemonTurn,
	settlePreparedTurn,
} from "../daemon-turn-memory.js";

const goSouth = {
	id: "go_1",
	name: "go",
	argumentsJson: JSON.stringify({ direction: "south" }),
};

describe("settlePreparedTurn", () => {
	it("logs the action so the next prompt replays it, as a live round does", () => {
		const game = makeTestGame({
			budgetPerAi: 20,
			pack: { aiStarts: CORNER_AI_STARTS },
		});
		const prepared = prepareDaemonTurn(game, "red", {});

		const { settled, memory } = settlePreparedTurn(game, "red", prepared, [
			goSouth,
		]);

		const toolCallEntries = (settled.game.conversationLogs.red ?? []).filter(
			(e) => e.kind === "tool-call",
		);
		expect(toolCallEntries).toHaveLength(1);
		expect(toolCallEntries[0]).toMatchObject({
			toolCallId: "go_1",
			toolName: "go",
			success: true,
		});

		const next = prepareDaemonTurn(settled.game, "red", memory);
		const replayedCall = next.messages.find(
			(m) =>
				m.role === "assistant" &&
				(m.tool_calls ?? []).some((tc) => tc.id === "go_1"),
		);
		expect(replayedCall).toBeDefined();
		expect(
			next.messages.some((m) => m.role === "tool" && m.tool_call_id === "go_1"),
		).toBe(true);
	});

	it("gives a reused tool-call id a fresh one so the replay stays unambiguous", () => {
		const game = makeTestGame({
			budgetPerAi: 20,
			pack: { aiStarts: CORNER_AI_STARTS },
		});
		const first = prepareDaemonTurn(game, "red", {});
		const afterFirst = settlePreparedTurn(game, "red", first, [goSouth]);

		const second = prepareDaemonTurn(
			afterFirst.settled.game,
			"red",
			afterFirst.memory,
		);
		const afterSecond = settlePreparedTurn(
			afterFirst.settled.game,
			"red",
			second,
			[goSouth],
		);

		const ids = (afterSecond.settled.game.conversationLogs.red ?? []).flatMap(
			(e) => (e.kind === "tool-call" ? [e.toolCallId] : []),
		);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
	});
});
