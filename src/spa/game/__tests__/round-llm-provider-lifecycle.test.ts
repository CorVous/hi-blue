import { describe, expect, it } from "vitest";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import { makeTestGame, ROW_AI_STARTS } from "./fixtures/make-game-state";

describe("runRound — onLifecycle forwarding", () => {
	it("tags started → first-token → completed with each Daemon's id, in initiative order", async () => {
		const events: string[] = [];

		await runRound(
			makeTestGame({ pack: { aiStarts: ROW_AI_STARTS } }),
			"red",
			"hi",
			new MockRoundLLMProvider([{ assistantText: "", toolCalls: [] }]),
			{
				initiative: ["cyan", "red", "green"],
				onLifecycle: (event) => {
					events.push(`${event.phase}:${event.daemonId}`);
				},
			},
		);

		expect(events).toEqual(
			["cyan", "red", "green"].flatMap((id) => [
				`started:${id}`,
				`first-token:${id}`,
				`completed:${id}`,
			]),
		);
	});
});
