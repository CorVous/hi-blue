import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE_1_CONFIG } from "../../../content/index.js";
import { createGame, startPhase } from "../../game/engine.js";
import type { AiPersona, GameState } from "../../game/types.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import {
	ACTIVE_KEY,
	clearActiveSession,
	deleteLegacySaveKey,
	dupSession,
	getActiveSessionId,
	getSessionInfo,
	hasLegacySave,
	LEGACY_KEY,
	listSessions,
	loadActiveSession,
	loadSession,
	mintAndActivateNewSession,
	mintSession,
	mintSessionId,
	rmSession,
	SESSIONS_PREFIX,
	saveActiveSession,
	setActiveSessionId,
} from "../session-storage.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		typingQuirks: ["fragments", "ALL CAPS"],
		voiceExamples: ["Now.", "BURN IT.", "Soon, soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		typingQuirks: ["ellipses", "no contractions"],
		voiceExamples: [
			"I will count again...",
			"That is not balanced.",
			"One more sweep through the list.",
		],
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		typingQuirks: ["lowercase only", "fragments"],
		voiceExamples: ["sure.", "if you say so.", "fine."],
	},
};

function makeFreshGame(): GameState {
	const game = createGame(TEST_PERSONAS);
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("mintSessionId", () => {
	it("matches /^0x[0-9A-F]{4}$/", () => {
		const id = mintSessionId();
		expect(id).toMatch(/^0x[0-9A-F]{4}$/);
	});
});

describe("getActiveSessionId", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns null when absent", () => {
		expect(getActiveSessionId()).toBeNull();
	});

	it("returns the stored value after setActiveSessionId", () => {
		setActiveSessionId("0xABCD");
		expect(getActiveSessionId()).toBe("0xABCD");
	});
});

describe("mintAndActivateNewSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sets pointer to /^0x[0-9A-F]{4}$/ format", () => {
		const id = mintAndActivateNewSession();
		expect(id).toMatch(/^0x[0-9A-F]{4}$/);
		expect(getActiveSessionId()).toBe(id);
	});
});

describe("saveActiveSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writes six keys in strict order: meta → 3 daemons → whispers → engine", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		const calls = stub.setItem.mock.calls.map((c) => c[0] as string);
		// Skip the ACTIVE_KEY set
		const dataCalls = calls.filter((k) => k !== ACTIVE_KEY);

		// First key should be meta.json
		expect(dataCalls[0]).toMatch(/meta\.json$/);

		// Last key should be engine.dat
		expect(dataCalls[dataCalls.length - 1]).toMatch(/engine\.dat$/);

		// whispers.txt is second-to-last
		expect(dataCalls[dataCalls.length - 2]).toMatch(/whispers\.txt$/);

		// Middle 3 keys are daemon .txt files
		const daemonCalls = dataCalls.slice(1, dataCalls.length - 2);
		expect(daemonCalls).toHaveLength(3);
		for (const k of daemonCalls) {
			expect(k).toMatch(/\.txt$/);
			expect(k).not.toMatch(/whispers/);
		}
	});

	it("engine.dat is written LAST (commit signal)", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		const calls = stub.setItem.mock.calls.map((c) => c[0] as string);
		const dataCalls = calls.filter((k) => k !== ACTIVE_KEY);
		expect(dataCalls[dataCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("returns ok: true on a normal write", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		mintAndActivateNewSession();
		const game = makeFreshGame();
		const result = saveActiveSession(game);
		expect(result.ok).toBe(true);
	});

	it("returns ok: false reason: quota on QuotaExceededError", () => {
		const stub = makeLocalStorageStub();
		stub.setItem.mockImplementation((key: string, _value: string) => {
			if (key.endsWith("engine.dat")) {
				throw Object.assign(new DOMException("quota", "QuotaExceededError"));
			}
			stub._store[key] = _value;
		});
		vi.stubGlobal("localStorage", stub);
		mintAndActivateNewSession();
		const game = makeFreshGame();
		const result = saveActiveSession(game);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("quota");
	});

	it("returns ok: false reason: unavailable on SecurityError", () => {
		const stub = makeLocalStorageStub();
		stub.setItem.mockImplementation((key: string, _value: string) => {
			if (key.endsWith("engine.dat")) {
				throw Object.assign(new DOMException("denied", "SecurityError"));
			}
			stub._store[key] = _value;
		});
		vi.stubGlobal("localStorage", stub);
		mintAndActivateNewSession();
		const game = makeFreshGame();
		const result = saveActiveSession(game);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unavailable");
	});
});

describe("loadActiveSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 'none' when pointer absent", () => {
		const result = loadActiveSession();
		expect(result.kind).toBe("none");
	});

	it("returns 'broken' when engine.dat is missing", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const sessionId = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);
		// Remove engine.dat
		stub.removeItem(`${SESSIONS_PREFIX}${sessionId}/engine.dat`);
		stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`] =
			undefined as unknown as string;
		delete stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`];
		const result = loadActiveSession();
		expect(result.kind).toBe("broken");
	});

	it("returns 'broken' when engine.dat fails deobfuscation", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const sessionId = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);
		// Overwrite engine.dat with garbage
		stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`] =
			"not-valid-base64$$$";
		const result = loadActiveSession();
		expect(result.kind).toBe("broken");
	});

	it("returns 'version-mismatch' when sealed schemaVersion is stale", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const sessionId = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		// Tamper with schemaVersion in engine.dat
		const engineBlob = stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`];
		if (!engineBlob) throw new Error("engine.dat should exist after save");
		const rawJson = deobfuscate(engineBlob);
		const sealed = JSON.parse(rawJson);
		sealed.schemaVersion = 999;
		stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`] = obfuscate(
			JSON.stringify(sealed),
		);

		const result = loadActiveSession();
		expect(result.kind).toBe("version-mismatch");
	});

	it("save → load round-trip returns ok with correct state", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);
		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.currentPhase).toBe(1);
			expect(result.state.phases).toHaveLength(1);
		}
	});
});

describe("clearActiveSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes pointer + all six session files", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		clearActiveSession();

		// Pointer should be gone
		expect(stub._store[ACTIVE_KEY]).toBeUndefined();
		// All session keys should be gone
		const remaining = Object.keys(stub._store).filter((k) =>
			k.startsWith(SESSIONS_PREFIX),
		);
		expect(remaining).toHaveLength(0);
	});

	it("is a no-op (no throw) when no active session", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		expect(() => clearActiveSession()).not.toThrow();
	});
});

describe("hasLegacySave / deleteLegacySaveKey", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("hasLegacySave returns false when legacy key absent", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		expect(hasLegacySave()).toBe(false);
	});

	it("hasLegacySave returns true when legacy key present", () => {
		const stub = makeLocalStorageStub({ [LEGACY_KEY]: '{"old":"save"}' });
		vi.stubGlobal("localStorage", stub);
		expect(hasLegacySave()).toBe(true);
	});

	it("deleteLegacySaveKey removes the legacy key", () => {
		const stub = makeLocalStorageStub({ [LEGACY_KEY]: '{"old":"save"}' });
		vi.stubGlobal("localStorage", stub);
		deleteLegacySaveKey();
		expect(stub._store[LEGACY_KEY]).toBeUndefined();
	});

	it("deleteLegacySaveKey is a no-op when legacy key absent", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		expect(() => deleteLegacySaveKey()).not.toThrow();
	});
});

describe("consecutive saves", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("two consecutive saveActiveSession calls update engine.dat (no stale data)", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		mintAndActivateNewSession();
		const game = makeFreshGame();

		// First save
		saveActiveSession(game, { createdAt: "2024-01-01T00:00:00.000Z" });
		const firstLoad = loadActiveSession();
		expect(firstLoad.kind).toBe("ok");

		// Second save with same game state — should still work
		saveActiveSession(game, { createdAt: "2024-01-01T00:00:00.000Z" });
		const secondLoad = loadActiveSession();
		expect(secondLoad.kind).toBe("ok");
		if (secondLoad.kind === "ok") {
			expect(secondLoad.state.currentPhase).toBe(1);
		}
	});
});

// ── listSessions ──────────────────────────────────────────────────────────────

describe("listSessions", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns empty array when no sessions exist", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		expect(listSessions()).toEqual([]);
	});

	it("returns minted-then-saved session ids", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id1 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const id2 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const ids = listSessions();
		expect(ids).toContain(id1);
		expect(ids).toContain(id2);
		expect(ids).toHaveLength(2);
	});

	it("ignores ACTIVE_KEY and LEGACY_KEY", () => {
		const stub = makeLocalStorageStub({
			[ACTIVE_KEY]: "0xABCD",
			[LEGACY_KEY]: "{}",
		});
		vi.stubGlobal("localStorage", stub);
		const ids = listSessions();
		expect(ids).not.toContain(ACTIVE_KEY);
		expect(ids).not.toContain(LEGACY_KEY);
		expect(ids).toEqual([]);
	});

	it("de-duplicates ids that have multiple files", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		// Multiple files under same id -> should appear only once
		const ids = listSessions();
		expect(ids.filter((x) => x === id)).toHaveLength(1);
	});
});

// ── loadSession ───────────────────────────────────────────────────────────────

describe("loadSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 'none' for an id with no data", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const result = loadSession("0x9999");
		expect(result.kind).toBe("none");
	});

	it("returns 'ok' for a saved session", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const result = loadSession(id);
		expect(result.kind).toBe("ok");
	});

	it("returns 'broken' when engine.dat is missing", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];
		const result = loadSession(id);
		expect(result.kind).toBe("broken");
	});

	it("returns 'version-mismatch' when schemaVersion is stale", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const engineBlob = stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];
		if (!engineBlob) throw new Error("engine.dat should exist");
		const rawJson = deobfuscate(engineBlob);
		const sealed = JSON.parse(rawJson);
		sealed.schemaVersion = 999;
		stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`] = obfuscate(
			JSON.stringify(sealed),
		);
		const result = loadSession(id);
		expect(result.kind).toBe("version-mismatch");
	});

	it("does NOT touch the active pointer", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const activeId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		// Load a different id
		loadSession("0x1234");
		expect(getActiveSessionId()).toBe(activeId);
	});
});

// ── mintSession ───────────────────────────────────────────────────────────────

describe("mintSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns /^0x[0-9A-F]{4}$/ format", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		const id = mintSession();
		expect(id).toMatch(/^0x[0-9A-F]{4}$/);
	});

	it("does NOT set the active pointer", () => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
		mintSession();
		expect(getActiveSessionId()).toBeNull();
	});
});

// ── dupSession ────────────────────────────────────────────────────────────────

describe("dupSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("produces a new id distinct from the source", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const newId = dupSession(srcId);
		expect(newId).not.toBe(srcId);
		expect(newId).toMatch(/^0x[0-9A-F]{4}$/);
	});

	it("new session keys are deep-independent: mutating new engine.dat does not affect original", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const newId = dupSession(srcId);

		// Corrupt the new session's engine.dat
		stub._store[`${SESSIONS_PREFIX}${newId}/engine.dat`] = "corrupted";

		// Original should still load ok
		const origResult = loadSession(srcId);
		expect(origResult.kind).toBe("ok");

		// New session should be broken
		const newResult = loadSession(newId);
		expect(newResult.kind).toBe("broken");
	});

	it("engine.dat is written LAST (commit signal)", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		// Clear the setItem mock so we only track dup writes
		stub.setItem.mockClear();
		const newId = dupSession(srcId);

		const calls = stub.setItem.mock.calls.map((c) => c[0] as string);
		const newPrefix = `${SESSIONS_PREFIX}${newId}/`;
		const newCalls = calls.filter((k) => k.startsWith(newPrefix));
		expect(newCalls[newCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("active pointer is unchanged after dup", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		dupSession(srcId);
		expect(getActiveSessionId()).toBe(srcId);
	});

	it("throws on broken source session", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${srcId}/engine.dat`];
		expect(() => dupSession(srcId)).toThrow();
	});

	it("throws on version-mismatch source session", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const engineBlob = stub._store[`${SESSIONS_PREFIX}${srcId}/engine.dat`];
		if (!engineBlob) throw new Error("engine.dat should exist");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		sealed.schemaVersion = 999;
		stub._store[`${SESSIONS_PREFIX}${srcId}/engine.dat`] = obfuscate(
			JSON.stringify(sealed),
		);
		expect(() => dupSession(srcId)).toThrow();
	});
});

// ── rmSession ─────────────────────────────────────────────────────────────────

describe("rmSession", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes only the named id's keys", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id1 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const id2 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		rmSession(id1);

		// id1's keys should be gone
		const remaining = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}${id1}/`),
		);
		expect(remaining).toHaveLength(0);

		// id2's keys should still be there
		const id2Keys = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}${id2}/`),
		);
		expect(id2Keys.length).toBeGreaterThan(0);
	});

	it("clears active pointer when removing the active session", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		expect(getActiveSessionId()).toBe(id);

		rmSession(id);

		expect(getActiveSessionId()).toBeNull();
	});

	it("does NOT clear active pointer when removing a non-active session", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id1 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const id2 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		// active is now id2
		expect(getActiveSessionId()).toBe(id2);

		rmSession(id1);

		// Active pointer should still point to id2
		expect(getActiveSessionId()).toBe(id2);
	});
});

// ── getSessionInfo ────────────────────────────────────────────────────────────

describe("getSessionInfo", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", makeLocalStorageStub());
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns kind=ok for a valid session", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const info = getSessionInfo(id);
		expect(info.kind).toBe("ok");
		if (info.kind === "ok") {
			expect(info.phase).toBe(1);
			expect(typeof info.lastSavedAt).toBe("string");
			expect(Array.isArray(info.daemonFiles)).toBe(true);
			expect(info.daemonFiles.length).toBeGreaterThan(0);
		}
	});

	it("returns kind=broken when engine.dat is missing", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];
		const info = getSessionInfo(id);
		expect(info.kind).toBe("broken");
	});

	it("returns kind=version-mismatch when schemaVersion is stale", () => {
		const stub = makeLocalStorageStub();
		vi.stubGlobal("localStorage", stub);
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const engineBlob = stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];
		if (!engineBlob) throw new Error("engine.dat should exist");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		sealed.schemaVersion = 999;
		stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`] = obfuscate(
			JSON.stringify(sealed),
		);
		const info = getSessionInfo(id);
		expect(info.kind).toBe("version-mismatch");
		if (info.kind === "version-mismatch") {
			expect(Array.isArray(info.daemonFiles)).toBe(true);
		}
	});
});
