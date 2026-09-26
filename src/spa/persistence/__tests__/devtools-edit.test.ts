import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub } from "../../__tests__/fixtures/local-storage";
import { makeTestPack } from "../../game/__tests__/fixtures/make-test-pack.js";
import { startGame } from "../../game/engine.js";
import type { AiPersona, GameState } from "../../game/types.js";
import type { DaemonFile } from "../session-codec.js";
import {
	ACTIVE_KEY,
	loadActiveSession,
	mintAndActivateNewSession,
	SESSIONS_PREFIX,
	saveActiveSession,
} from "../session-storage.js";

const TEST_CONTENT_PACK = makeTestPack([], { wallName: "wall" });

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
		typingQuirks: ["fragments", "ALL CAPS"],
		voiceExamples: ["Now.", "BURN IT.", "Soon, soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
		typingQuirks: ["ellipses", "no contractions"],
		voiceExamples: [
			"I will count again...",
			"That is not balanced.",
			"One more sweep through the list.",
		],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
		typingQuirks: ["lowercase only", "fragments"],
		voiceExamples: ["sure.", "if you say so.", "fine."],
	},
};

function makeFreshGame(): GameState {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
		budgetPerAi: 5,
		rng: () => 0,
	});
}

describe("devtools-edit: mutating daemon .txt affects conversationLogs on reload", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

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
