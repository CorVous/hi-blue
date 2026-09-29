import { describe, expect, it } from "vitest";
import type { OpenAiMessage } from "../../llm-client";
import {
	appendBroadcast,
	continueLogsInNewRoom,
	isFirstRoundOfRoom,
	NEW_ROOM_BROADCAST,
} from "../engine";
import { runRound } from "../round-coordinator";
import type { GameState } from "../types";
import { makeSilentProvider, makeTestGame } from "./fixtures/make-game-state";

const OLD_ANNOUNCEMENT = "The old room hums.";
const FINAL_ROUND_ANNOUNCEMENT = "[SYSTEM] The weather has changed. Fog.";

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

async function promptTextsInNewRoom(continued: GameState): Promise<string[][]> {
	const provider = makeSilentProvider();
	await runRound(continued, "red", "new hello", provider);
	return provider.calls.map((call) => call.messages.map(messageText));
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

	it("keeps the round count when the ended room's final round logged an announcement for the next round", async () => {
		const playedThrough = await playEndedRoom();
		const ended = appendBroadcast(playedThrough, FINAL_ROUND_ANNOUNCEMENT);
		const continued = continueLogsInNewRoom(makeTestGame(), ended);

		expect(continued.round).toBe(ended.round);
		expect(isFirstRoundOfRoom(continued)).toBe(true);
		const redRounds = (continued.conversationLogs.red ?? []).map(
			(entry) => entry.round,
		);
		expect(Math.max(...redRounds.slice(0, -1))).toBe(ended.round - 1);

		const [texts = []] = await promptTextsInNewRoom(continued);
		const currentState = texts[texts.length - 1] ?? "";
		const logTail = texts.slice(0, -1);
		const finalAnnouncement = logTail.findIndex((t) =>
			t.includes(FINAL_ROUND_ANNOUNCEMENT),
		);
		const oldGoodbye = logTail.findIndex((t) => t.includes("old goodbye"));
		expect(finalAnnouncement).toBeGreaterThan(oldGoodbye);
		expect(logTail[logTail.length - 2]).toContain(NEW_ROOM_BROADCAST);
		expect(logTail[logTail.length - 1]).toContain("new hello");
		expect(currentState).toContain(`[announcement] ${NEW_ROOM_BROADCAST}`);
		expect(currentState).not.toContain(FINAL_ROUND_ANNOUNCEMENT);
	});

	it("puts the new-room broadcast and the new player message last, after the old history", async () => {
		const ended = await playEndedRoom();
		const continued = continueLogsInNewRoom(makeTestGame(), ended);
		const [texts = []] = await promptTextsInNewRoom(continued);
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
		const [, greenTexts = []] = await promptTextsInNewRoom(continued);
		expect(greenTexts[greenTexts.length - 2]).toBe(
			"You have received no messages.",
		);
	});
});
