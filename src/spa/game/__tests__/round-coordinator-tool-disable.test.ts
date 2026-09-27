import { describe, expect, it } from "vitest";
import { runRound } from "../round-coordinator";
import type { ActiveComplication, ConversationEntry } from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	ROW_AI_STARTS,
	seededRng,
	TEST_PERSONAS,
	withCountdownZero,
} from "./fixtures/make-game-state";

const DRAW_TOOL_DISABLE_KIND = 0.4;
const DRAW_FIRST_PAIR = 0.0;
const DRAW_MIN_DURATION = 0.0;
const DRAW_MIN_COUNTDOWN = 0.0;
const TOOL_DISABLE_DRAWS = [
	DRAW_TOOL_DISABLE_KIND,
	DRAW_FIRST_PAIR,
	DRAW_MIN_DURATION,
	DRAW_MIN_COUNTDOWN,
];

function broadcastContents(log: readonly ConversationEntry[]): string[] {
	return log.flatMap((e) => (e.kind === "broadcast" ? [e.content] : []));
}

async function fireToolDisable() {
	const game = withCountdownZero(
		makeTestGame({ pack: { aiStarts: ROW_AI_STARTS } }),
	);
	const rng = seededRng(TOOL_DISABLE_DRAWS, () => 0);
	const { nextState } = await runRound(
		game,
		"red",
		"hi",
		makeSilentProvider(),
		{ rng },
	);
	const disable = nextState.activeComplications.find(
		(c): c is Extract<ActiveComplication, { kind: "tool_disable" }> =>
			c.kind === "tool_disable",
	);
	if (!disable) throw new Error("expected a tool_disable complication");
	return { nextState, disable };
}

describe("runRound — tool_disable complication", () => {
	it("appends a Sysadmin disable notice naming the tool to the target Daemon's log in the round it fires", async () => {
		const { nextState, disable } = await fireToolDisable();
		const targetLog = nextState.conversationLogs[disable.target] ?? [];
		const notices = targetLog.filter(
			(e) =>
				e.kind === "broadcast" &&
				e.content === `Sysadmin: Your ${disable.tool} tool has been disabled.`,
		);
		expect(notices).toHaveLength(1);
		expect(notices[0]?.round).toBe(nextState.round);
	});

	it("does not send the disable notice to the other Daemons", async () => {
		const { nextState, disable } = await fireToolDisable();
		const others = Object.keys(TEST_PERSONAS).filter(
			(id) => id !== disable.target,
		);
		expect(others).toHaveLength(2);
		for (const aiId of others) {
			const contents = broadcastContents(
				nextState.conversationLogs[aiId] ?? [],
			);
			expect(contents.some((c) => c.includes("has been disabled"))).toBe(false);
		}
	});

	it("does not send a restore notice in the round the tool is disabled", async () => {
		const { nextState, disable } = await fireToolDisable();
		const contents = broadcastContents(
			nextState.conversationLogs[disable.target] ?? [],
		);
		expect(contents.some((c) => c.includes("has been restored"))).toBe(false);
	});
});
