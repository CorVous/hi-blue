import { describe, expect, it } from "vitest";
import type { OpenAiMessage } from "../../llm-client";
import {
	appendBroadcast,
	continueLogsInNewRoom,
	isFirstRoundOfRoom,
	NEW_ROOM_BROADCAST,
} from "../engine";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { GameState } from "../types";
import { makeSilentProvider, makeTestGame } from "./fixtures/make-game-state";

const OLD_ANNOUNCEMENT = "The old room hums.";

function messageText(message: OpenAiMessage): string {
	return typeof message.content === "string" ? message.content : "";
}

async function playEndedRoom(): Promise<GameState> {
	const opening = appendBroadcast(makeTestGame(), OLD_ANNOUNCEMENT);
	const afterFirst = await runRound(
		opening,
		"red",
		"old hello",
		makeSilentProvider(),
	);
	const afterSecond = await runRound(
		afterFirst.nextState,
		"red",
		"old goodbye",
		makeSilentProvider(),
	);
	return afterSecond.nextState;
}

describe("Continue into a new room", () => {
	it("starts the new room after every round the ended room logged", async () => {
		const ended = await playEndedRoom();
		const continued = continueLogsInNewRoom(makeTestGame(), ended);

		const loggedRounds = Object.values(ended.conversationLogs).flatMap((log) =>
			log.map((entry) => entry.round),
		);
		expect(continued.round).toBeGreaterThan(Math.max(...loggedRounds));
		expect(isFirstRoundOfRoom(continued)).toBe(true);
		expect(
			isFirstRoundOfRoom({ ...continued, round: continued.round + 1 }),
		).toBe(false);
	});

	it("puts the new-room broadcast and the new player message last, after the old history", async () => {
		const ended = await playEndedRoom();
		const continued = continueLogsInNewRoom(makeTestGame(), ended);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(continued, "red", "new hello", provider);

		const redCall = provider.calls[0];
		if (!redCall) throw new Error("expected a request for red");
		const texts = redCall.messages.map(messageText);
		const currentState = texts[texts.length - 1] ?? "";
		const logTail = texts.slice(0, -1);

		expect(logTail[logTail.length - 1]).toContain("new hello");
		expect(logTail[logTail.length - 2]).toContain(NEW_ROOM_BROADCAST);
		const oldHello = logTail.findIndex((t) => t.includes("old hello"));
		const oldGoodbye = logTail.findIndex((t) => t.includes("old goodbye"));
		const newRoom = logTail.findIndex((t) => t.includes(NEW_ROOM_BROADCAST));
		expect(oldHello).toBeGreaterThan(0);
		expect(oldGoodbye).toBeGreaterThan(oldHello);
		expect(newRoom).toBeGreaterThan(oldGoodbye);
		expect(texts).not.toContain("You have received no messages.");

		expect(currentState).toContain(`[announcement] ${NEW_ROOM_BROADCAST}`);
		expect(currentState).not.toContain(OLD_ANNOUNCEMENT);
	});

	it("gives a Daemon that did not hear from blue the silent-turn anchor", async () => {
		const ended = await playEndedRoom();
		const continued = continueLogsInNewRoom(makeTestGame(), ended);
		const provider = new MockRoundLLMProvider([
			{ assistantText: "", toolCalls: [] },
		]);

		await runRound(continued, "red", "new hello", provider);

		const greenCall = provider.calls[1];
		if (!greenCall) throw new Error("expected a request for green");
		const texts = greenCall.messages.map(messageText);
		expect(texts[texts.length - 2]).toBe("You have received no messages.");
	});
});
