import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE_1_CONFIG } from "../../../content/index.js";
import { createGame, startPhase } from "../../game/engine.js";
import type {
	AiId,
	AiPersona,
	GameState,
	WorldEntity,
} from "../../game/types.js";

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

import {
	clearGame,
	deserializeGameState,
	isStorageAvailable,
	loadGame,
	STORAGE_KEY,
	saveGame,
	serializeGameState,
} from "../game-storage.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a fresh phase-1 game state using the canonical config. */
function makeFreshGame(): GameState {
	const game = createGame(TEST_PERSONAS);
	// Use a fixed rng so goals are deterministic in tests
	return startPhase(game, PHASE_1_CONFIG, () => 0);
}

// ── localStorage stub ─────────────────────────────────────────────────────────

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

describe("serializeGameState / deserializeGameState", () => {
	it("round-trips a fresh game", () => {
		const original = makeFreshGame();
		const persisted = serializeGameState(original);
		const restored = deserializeGameState(persisted);

		expect(restored.currentPhase).toBe(original.currentPhase);
		expect(restored.isComplete).toBe(original.isComplete);
		expect(restored.phases).toHaveLength(original.phases.length);
	});

	it("converts lockedOut Set → array on serialize; deserialize hydrates back to Set", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		// Inject a lockedOut entry
		const modifiedPhase = { ...phase, lockedOut: new Set<AiId>(["red"]) };
		const modified: GameState = {
			...game,
			phases: [modifiedPhase],
		};

		const persisted = serializeGameState(modified);
		expect(Array.isArray(persisted.game.phases[0]?.lockedOut)).toBe(true);
		expect(persisted.game.phases[0]?.lockedOut).toContain("red");

		const restored = deserializeGameState(persisted);
		const restoredPhase = restored.phases[0];
		expect(restoredPhase?.lockedOut).toBeInstanceOf(Set);
		expect(restoredPhase?.lockedOut.has("red")).toBe(true);
	});

	it("converts chatLockouts Map → entries on serialize; deserialize hydrates back to Map", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modifiedPhase = {
			...phase,
			chatLockouts: new Map<AiId, number>([["green", 3]]),
		};
		const modified: GameState = {
			...game,
			phases: [modifiedPhase],
		};

		const persisted = serializeGameState(modified);
		expect(Array.isArray(persisted.game.phases[0]?.chatLockouts)).toBe(true);
		expect(persisted.game.phases[0]?.chatLockouts[0]).toEqual(["green", 3]);

		const restored = deserializeGameState(persisted);
		const restoredPhase = restored.phases[0];
		expect(restoredPhase?.chatLockouts).toBeInstanceOf(Map);
		expect(restoredPhase?.chatLockouts.get("green")).toBe(3);
	});

	it("deserializeGameState re-attaches nextPhaseConfig from canonical phase chain", () => {
		const game = makeFreshGame();
		const persisted = serializeGameState(game);
		const restored = deserializeGameState(persisted);
		const restoredPhase = restored.phases[0];
		// PHASE_1_CONFIG has a nextPhaseConfig (PHASE_2_CONFIG)
		expect(restoredPhase?.nextPhaseConfig).toBeDefined();
		expect(restoredPhase?.nextPhaseConfig?.phaseNumber).toBe(2);
	});

	it("round-trips chat histories, whispers, world entities, budgets", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const keyEntity: WorldEntity = {
			id: "key",
			kind: "interesting_object",
			name: "The Key",
			examineDescription: "A key",
			holder: { row: 0, col: 0 },
		};
		const modifiedPhase = {
			...phase,
			chatHistories: {
				red: [{ role: "player" as const, content: "hello red", round: 0 }],
				green: [{ role: "ai" as const, content: "green reply", round: 0 }],
				blue: [],
			},
			whispers: [
				{ from: "red" as AiId, to: "blue" as AiId, content: "psst", round: 1 },
			],
			world: {
				entities: [keyEntity],
			},
			budgets: {
				red: { remaining: 3, total: 5 },
				green: { remaining: 5, total: 5 },
				blue: { remaining: 4, total: 5 },
			},
		};
		const modified: GameState = { ...game, phases: [modifiedPhase] };

		const persisted = serializeGameState(modified);
		const restored = deserializeGameState(persisted);
		const rp = restored.phases[0];

		expect(rp?.chatHistories.red).toEqual([
			{ role: "player", content: "hello red", round: 0 },
		]);
		expect(rp?.chatHistories.green).toEqual([
			{ role: "ai", content: "green reply", round: 0 },
		]);
		expect(rp?.whispers[0]).toEqual({
			from: "red",
			to: "blue",
			content: "psst",
			round: 1,
		});
		expect(rp?.world.entities[0]).toMatchObject({
			id: "key",
			name: "The Key",
			holder: { row: 0, col: 0 },
		});
		expect(rp?.budgets.red).toEqual({ remaining: 3, total: 5 });
	});

	it("round-trips personaSpatial (position + facing)", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modifiedPhase = {
			...phase,
			personaSpatial: {
				red: { position: { row: 2, col: 3 }, facing: "east" as const },
				green: { position: { row: 1, col: 1 }, facing: "south" as const },
				blue: { position: { row: 4, col: 4 }, facing: "west" as const },
			},
		};
		const modified = { ...game, phases: [modifiedPhase] };

		const persisted = serializeGameState(modified);
		const restored = deserializeGameState(persisted);
		const rp = restored.phases[0];

		expect(rp?.personaSpatial.red).toEqual({
			position: { row: 2, col: 3 },
			facing: "east",
		});
		expect(rp?.personaSpatial.green).toEqual({
			position: { row: 1, col: 1 },
			facing: "south",
		});
		expect(rp?.personaSpatial.blue).toEqual({
			position: { row: 4, col: 4 },
			facing: "west",
		});
	});

	it("round-trips obstacle entities", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const obstacleEntities: WorldEntity[] = [
			{
				id: "wall_a",
				kind: "obstacle",
				name: "wall",
				examineDescription: "A solid wall",
				holder: { row: 0, col: 0 },
			},
			{
				id: "wall_b",
				kind: "obstacle",
				name: "wall",
				examineDescription: "A solid wall",
				holder: { row: 2, col: 4 },
			},
		];
		const modifiedPhase = {
			...phase,
			world: {
				entities: [...phase.world.entities, ...obstacleEntities],
			},
		};
		const modified = { ...game, phases: [modifiedPhase] };

		const persisted = serializeGameState(modified);
		const restored = deserializeGameState(persisted);
		const rp = restored.phases[0];

		const restoredObstacles = rp?.world.entities.filter(
			(e) => e.kind === "obstacle",
		);
		expect(restoredObstacles).toHaveLength(2);
		expect(restoredObstacles?.[0]?.holder).toEqual({ row: 0, col: 0 });
		expect(restoredObstacles?.[1]?.holder).toEqual({ row: 2, col: 4 });
	});
});

describe("loadGame — schema version", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns error: version-mismatch when schemaVersion is 2 (old)", () => {
		const bad = JSON.stringify({ schemaVersion: 2, savedAt: "", game: {} });
		localStorage.setItem(STORAGE_KEY, bad);
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBe("version-mismatch");
	});

	it("returns error: version-mismatch when schemaVersion is 3 (pre-v4 schema without actionLog removal)", () => {
		const bad = JSON.stringify({ schemaVersion: 3, savedAt: "", game: {} });
		localStorage.setItem(STORAGE_KEY, bad);
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBe("version-mismatch");
	});
});

describe("loadGame", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns null when no saved state", () => {
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBeUndefined();
	});

	it("returns error: corrupt when JSON.parse throws", () => {
		localStorage.setItem(STORAGE_KEY, "not-json{{{");
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBe("corrupt");
	});

	it("returns error: version-mismatch when version field disagrees", () => {
		const bad = JSON.stringify({ schemaVersion: 999, savedAt: "", game: {} });
		localStorage.setItem(STORAGE_KEY, bad);
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBe("version-mismatch");
	});

	it("returns error: corrupt when parsed value has no schemaVersion", () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBe("corrupt");
	});

	it("returns a hydrated GameState when a valid persisted blob is present", () => {
		const game = makeFreshGame();
		const blob = JSON.stringify(serializeGameState(game));
		localStorage.setItem(STORAGE_KEY, blob);
		const result = loadGame();
		expect(result.state).not.toBeNull();
		expect(result.state?.currentPhase).toBe(1);
		expect(result.state?.phases).toHaveLength(1);
		// transcripts defaults to {} when blob omits the field
		if (result.state) {
			expect(result.transcripts).toEqual({});
		}
	});

	it("loadGame defaults transcripts to {} when persisted blob omits the field", () => {
		const game = makeFreshGame();
		// Write a v1 blob without transcripts (legacy save)
		const blobObj = serializeGameState(game);
		// biome-ignore lint/suspicious/noExplicitAny: mutating persisted blob shape for legacy-save test
		delete (blobObj as any).transcripts;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(blobObj));
		const result = loadGame();
		expect(result.state).not.toBeNull();
		if (result.state) {
			expect(result.transcripts).toEqual({});
		}
	});

	it("loadGame tolerates non-object transcripts field by defaulting to {}", () => {
		const game = makeFreshGame();
		const blobObj = serializeGameState(game);
		// biome-ignore lint/suspicious/noExplicitAny: injecting invalid transcripts type for robustness test
		(blobObj as any).transcripts = "garbage";
		localStorage.setItem(STORAGE_KEY, JSON.stringify(blobObj));
		const result = loadGame();
		expect(result.state).not.toBeNull();
		if (result.state) {
			expect(result.transcripts).toEqual({});
		}
	});

	it("returns error: corrupt (not unavailable) when schemaVersion is valid but game structure is malformed", () => {
		// Valid JSON, correct schemaVersion (5), but game.phases is not an array
		const malformed = JSON.stringify({
			schemaVersion: 5,
			savedAt: new Date().toISOString(),
			game: {
				currentPhase: 1,
				isComplete: false,
				personas: {},
				phases: null,
				contentPacks: [],
			},
		});
		localStorage.setItem(STORAGE_KEY, malformed);
		const result = loadGame();
		expect(result.state).toBeNull();
		expect(result.error).toBe("corrupt");
	});
});

describe("saveGame", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns ok: true on a normal write", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		const game = makeFreshGame();
		const result = saveGame(game, {});
		expect(result.ok).toBe(true);
	});

	it("returns ok: false reason: quota when localStorage.setItem throws QuotaExceededError", () => {
		const stub = makeLocalStorageStub();
		stub.setItem.mockImplementation(() => {
			throw Object.assign(new DOMException("quota", "QuotaExceededError"));
		});
		vi.stubGlobal("localStorage", stub);
		const game = makeFreshGame();
		const result = saveGame(game, {});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("quota");
	});

	it("returns ok: false reason: unavailable when localStorage access throws SecurityError", () => {
		const stub = makeLocalStorageStub();
		stub.setItem.mockImplementation(() => {
			throw Object.assign(new DOMException("denied", "SecurityError"));
		});
		vi.stubGlobal("localStorage", stub);
		const game = makeFreshGame();
		const result = saveGame(game, {});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unavailable");
	});

	it("persists to localStorage so a subsequent loadGame can recover it", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		const game = makeFreshGame();
		saveGame(game, {});
		const loaded = loadGame();
		expect(loaded.state).not.toBeNull();
	});

	it("saveGame + loadGame round-trips the transcripts map", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		const game = makeFreshGame();
		const transcripts: Partial<Record<AiId, string>> = {
			red: "[Ember] Hello there\n",
			green: "[Sage] How can I help?\n",
		};
		saveGame(game, transcripts);
		const loaded = loadGame();
		expect(loaded.state).not.toBeNull();
		if (loaded.state) {
			expect(loaded.transcripts).toEqual(transcripts);
		}
	});
});

describe("isStorageAvailable", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns true when localStorage works normally", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		expect(isStorageAvailable()).toBe(true);
	});

	it("returns false when localStorage.setItem throws SecurityError (privacy mode)", () => {
		const stub = makeLocalStorageStub();
		stub.setItem.mockImplementation(() => {
			throw new DOMException("denied", "SecurityError");
		});
		vi.stubGlobal("localStorage", stub);
		expect(isStorageAvailable()).toBe(false);
	});
});

describe("clearGame", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes the saved game from localStorage", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const game = makeFreshGame();
		saveGame(game, {});
		clearGame();
		expect(stub.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
	});

	it("is a no-op (no throw) when localStorage is unavailable", () => {
		const stub = makeLocalStorageStub();
		stub.removeItem.mockImplementation(() => {
			throw new DOMException("denied", "SecurityError");
		});
		vi.stubGlobal("localStorage", stub);
		expect(() => clearGame()).not.toThrow();
	});
});
