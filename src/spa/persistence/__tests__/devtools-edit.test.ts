import { describe, expect, it } from "vitest";
import { installLocalStorageStub } from "../../__tests__/fixtures/local-storage";
import type { GameState } from "../../game/types.js";
import type { DaemonFile } from "../session-codec.js";
import {
	ACTIVE_KEY,
	loadActiveSession,
	mintAndActivateNewSession,
	SESSIONS_PREFIX,
	saveActiveSession,
} from "../session-storage.js";
import { makeFreshGame } from "./make-fresh-game.js";

describe("devtools-edit: mutating daemon .txt affects conversationLogs on reload", () => {
	it("editing red daemon .txt message entry is visible after loadActiveSession()", () => {
		const stub = installLocalStorageStub();

		mintAndActivateNewSession();
		const sessionId = stub._store[ACTIVE_KEY];
		expect(sessionId).toBeDefined();

		const game = makeFreshGame();

		const modifiedGame: GameState = {
			...game,
			conversationLogs: {
				...game.conversationLogs,
				red: [
					{
						kind: "message" as const,
						from: "red" as const,
						to: "blue" as const,
						content: "original message",
						round: 1,
					},
				],
			},
		};

		saveActiveSession(modifiedGame);

		const redDaemonKey = `${SESSIONS_PREFIX}${sessionId}/red.txt`;
		expect(stub._store[redDaemonKey]).toBeDefined();

		const rawDaemon = stub._store[redDaemonKey];
		if (!rawDaemon) throw new Error("red daemon file missing");
		const daemonFile = JSON.parse(rawDaemon) as DaemonFile;
		daemonFile.conversationLog[0] = {
			kind: "message",
			from: "blue",
			to: "red",
			content: "DEVTOOLS_INJECTED_MARKER",
			round: 1,
		};
		stub._store[redDaemonKey] = JSON.stringify(daemonFile, null, 2);

		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const redEntry = result.state.conversationLogs.red?.[0];
			expect(redEntry?.kind === "message" && redEntry.content).toBe(
				"DEVTOOLS_INJECTED_MARKER",
			);
		}
	});

	it("editing daemon .txt to add a new message entry is preserved", () => {
		const stub = installLocalStorageStub();

		mintAndActivateNewSession();
		const sessionId = stub._store[ACTIVE_KEY];
		expect(sessionId).toBeDefined();

		const game = makeFreshGame();
		saveActiveSession(game);

		const greenDaemonKey = `${SESSIONS_PREFIX}${sessionId}/green.txt`;
		expect(stub._store[greenDaemonKey]).toBeDefined();

		const rawGreenDaemon = stub._store[greenDaemonKey];
		if (!rawGreenDaemon) throw new Error("green daemon file missing");
		const daemonFile = JSON.parse(rawGreenDaemon) as DaemonFile;
		daemonFile.conversationLog.push({
			kind: "message",
			from: "blue",
			to: "green",
			content: "PLAYER_DEVTOOLS_MESSAGE",
			round: 1,
		});
		stub._store[greenDaemonKey] = JSON.stringify(daemonFile, null, 2);

		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const greenLog = result.state.conversationLogs.green ?? [];
			expect(
				greenLog.some(
					(e) =>
						e.kind === "message" && e.content === "PLAYER_DEVTOOLS_MESSAGE",
				),
			).toBe(true);
		}
	});
});
