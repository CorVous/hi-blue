/**
 * devtools-edit.test.ts
 *
 * Verifies that editing a daemon .txt file in localStorage (as a player would
 * in DevTools) affects the chatHistories on the next loadActiveSession() call.
 *
 * This tests the "editable surface" affordance described in ADR 0004.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE_1_CONFIG } from "../../../content/index.js";
import { createGame, startPhase } from "../../game/engine.js";
import type { AiPersona, GameState } from "../../game/types.js";
import type { DaemonFile } from "../session-codec.js";
import {
	ACTIVE_KEY,
	loadActiveSession,
	mintAndActivateNewSession,
	SESSIONS_PREFIX,
	saveActiveSession,
} from "../session-storage.js";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
	},
};

function makeFreshGame(): GameState {
	const game = createGame(TEST_PERSONAS);
	return startPhase(game, PHASE_1_CONFIG, () => 0);
}

function makeLocalStorageStub(initialData: Record<string, string> = {}) {
	const store: Record<string, string> = { ...initialData };
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
		_store: store,
	};
}

describe("devtools-edit: mutating daemon .txt affects chatHistories on reload", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("editing red daemon .txt chat message is visible after loadActiveSession()", () => {
		// Set up: save a game with a chat history for red
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);

		mintAndActivateNewSession();
		const sessionId = stub._store[ACTIVE_KEY];
		expect(sessionId).toBeDefined();

		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");

		// Inject a chat history for red
		const modifiedGame: GameState = {
			...game,
			phases: [
				{
					...phase,
					chatHistories: {
						red: [
							{ role: "ai" as const, content: "original message", round: 1 },
						],
						green: [],
						blue: [],
					},
				},
			],
		};

		saveActiveSession(modifiedGame);

		// Find the daemon .txt key for red
		const redDaemonKey = `${SESSIONS_PREFIX}${sessionId}/red.txt`;
		expect(stub._store[redDaemonKey]).toBeDefined();

		// Parse the daemon file, mutate the chat message, and write it back
		const rawDaemon = stub._store[redDaemonKey];
		if (!rawDaemon) throw new Error("red daemon file missing");
		const daemonFile = JSON.parse(rawDaemon) as DaemonFile;
		const phases = daemonFile.phases;
		const phase1 = phases["1"];
		if (!phase1) throw new Error("no phase 1 in daemon file");
		// Mutate the chat history
		phase1.chatHistory[0] = {
			role: "ai",
			content: "DEVTOOLS_INJECTED_MARKER",
			round: 1,
		};
		stub._store[redDaemonKey] = JSON.stringify(daemonFile, null, 2);

		// Load the session
		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const loadedPhase = result.state.phases[0];
			// The mutated content should be visible in chatHistories
			expect(loadedPhase?.chatHistories.red?.[0]?.content).toBe(
				"DEVTOOLS_INJECTED_MARKER",
			);
		}
	});

	it("editing daemon .txt to add a new chat message is preserved", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);

		mintAndActivateNewSession();
		const sessionId = stub._store[ACTIVE_KEY];
		expect(sessionId).toBeDefined();

		const game = makeFreshGame();
		saveActiveSession(game);

		// Find and parse the daemon file for green
		const greenDaemonKey = `${SESSIONS_PREFIX}${sessionId}/green.txt`;
		expect(stub._store[greenDaemonKey]).toBeDefined();

		const rawGreenDaemon = stub._store[greenDaemonKey];
		if (!rawGreenDaemon) throw new Error("green daemon file missing");
		const daemonFile = JSON.parse(rawGreenDaemon) as DaemonFile;
		// Add a new chat message to phase 1
		daemonFile.phases["1"].chatHistory.push({
			role: "player",
			content: "PLAYER_DEVTOOLS_MESSAGE",
			round: 1,
		});
		stub._store[greenDaemonKey] = JSON.stringify(daemonFile, null, 2);

		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const loadedPhase = result.state.phases[0];
			const greenHistory = loadedPhase?.chatHistories.green ?? [];
			expect(
				greenHistory.some((m) => m.content === "PLAYER_DEVTOOLS_MESSAGE"),
			).toBe(true);
		}
	});
});
