import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAS, PHASE_1_CONFIG } from "../../../content/index.js";
import { createGame, startPhase } from "../../game/engine.js";
import type { AiId, GameState } from "../../game/types.js";
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
	const game = createGame(PERSONAS);
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

	it("round-trips chat histories, whispers, action log, world items, budgets", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modifiedPhase = {
			...phase,
			chatHistories: {
				red: [{ role: "player" as const, content: "hello red" }],
				green: [{ role: "ai" as const, content: "green reply" }],
				blue: [],
			},
			whispers: [
				{ from: "red" as AiId, to: "blue" as AiId, content: "psst", round: 1 },
			],
			actionLog: [
				{
					round: 1,
					actor: "red" as AiId,
					type: "pass" as const,
					description: "passed",
				},
			],
			world: {
				items: [{ id: "key", name: "The Key", holder: "room" as const }],
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
			{ role: "player", content: "hello red" },
		]);
		expect(rp?.chatHistories.green).toEqual([
			{ role: "ai", content: "green reply" },
		]);
		expect(rp?.whispers[0]).toEqual({
			from: "red",
			to: "blue",
			content: "psst",
			round: 1,
		});
		expect(rp?.actionLog[0]).toMatchObject({
			round: 1,
			actor: "red",
			type: "pass",
		});
		expect(rp?.world.items[0]).toEqual({
			id: "key",
			name: "The Key",
			holder: "room",
		});
		expect(rp?.budgets.red).toEqual({ remaining: 3, total: 5 });
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
	});
});

describe("saveGame", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns ok: true on a normal write", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		const game = makeFreshGame();
		const result = saveGame(game);
		expect(result.ok).toBe(true);
	});

	it("returns ok: false reason: quota when localStorage.setItem throws QuotaExceededError", () => {
		const stub = makeLocalStorageStub();
		stub.setItem.mockImplementation(() => {
			throw Object.assign(new DOMException("quota", "QuotaExceededError"));
		});
		vi.stubGlobal("localStorage", stub);
		const game = makeFreshGame();
		const result = saveGame(game);
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
		const result = saveGame(game);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unavailable");
	});

	it("persists to localStorage so a subsequent loadGame can recover it", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		const game = makeFreshGame();
		saveGame(game);
		const loaded = loadGame();
		expect(loaded.state).not.toBeNull();
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
		saveGame(game);
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
