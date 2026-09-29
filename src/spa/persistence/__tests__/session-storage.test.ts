import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installLocalStorageStub,
	type LocalStorageStub,
	makeLocalStorageStub,
} from "../../__tests__/fixtures/local-storage";
import { makeTestPack } from "../../game/__tests__/fixtures/make-test-pack.js";
import { appendBroadcast, startGame } from "../../game/engine.js";
import type { AiPersona, GameState } from "../../game/types.js";
import { lookupArchiveVersion } from "../archive-map.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import {
	ACTIVE_KEY,
	ARCHIVE_PREFIX,
	archiveSession,
	clearActiveSession,
	deactivateActiveSession,
	deleteLegacySaveKey,
	dupSession,
	getActiveSessionId,
	getArchivedSessionInfo,
	getSessionInfo,
	hasLegacySave,
	isSessionComplete,
	isSessionSaveInProgress,
	LEGACY_KEY,
	listArchivedSessions,
	listSessions,
	loadActiveSession,
	loadArchivedSession,
	loadSession,
	mintAndActivateNewSession,
	mintSessionId,
	readSessionLastSavedAt,
	rmArchivedSession,
	rmSession,
	SESSIONS_PREFIX,
	saveActiveSession,
	seedFromArchive,
	sessionChangedSince,
	setActiveSessionId,
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

describe("mintSessionId", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("matches /^0x[0-9A-F]{4}$/", () => {
		const id = mintSessionId();
		expect(id).toMatch(/^0x[0-9A-F]{4}$/);
	});

	it("can mint 0xFFFF at the top of the range", () => {
		installLocalStorageStub();
		vi.spyOn(Math, "random").mockReturnValue(0.99999999);
		expect(mintSessionId()).toBe("0xFFFF");
	});

	it("re-rolls while the id is taken under sessions/ or archive/", () => {
		installLocalStorageStub({
			[`${SESSIONS_PREFIX}0x0000/meta.json`]: "{}",
			[`${ARCHIVE_PREFIX}0x0001/engine.dat`]: "x",
		});
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(1 / 0x10000)
			.mockReturnValueOnce(2 / 0x10000);
		expect(mintSessionId()).toBe("0x0002");
	});

	it("dupSession and seedFromArchive never reuse an existing id", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);
		const takenValue = Number.parseInt(id.slice(2), 16) / 0x10000;
		const freeValue =
			((Number.parseInt(id.slice(2), 16) + 1) % 0x10000) / 0x10000;
		const random = vi.spyOn(Math, "random");

		random.mockReturnValueOnce(takenValue).mockReturnValueOnce(freeValue);
		const dupId = dupSession(id);
		expect(dupId).not.toBe(id);

		random.mockReturnValueOnce(takenValue).mockReturnValueOnce(freeValue);
		rmSession(dupId);
		const seededId = seedFromArchive(id, makeFreshGame());
		expect(seededId).not.toBe(id);
		expect(loadArchivedSession(id).kind).toBe("ok");
	});

	it("seedFromArchive starts the new room at the archived round and files the unplayed round's entries under the last played round", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		const played = appendBroadcast(
			{ ...makeFreshGame(), round: 4 },
			"The old room hums.",
		);
		saveActiveSession(played);
		await archiveSession(id);

		const seeded = loadSession(seedFromArchive(id, makeFreshGame()));
		if (seeded.kind !== "ok") throw new Error("seeded session did not load");
		expect(seeded.state.round).toBe(4);
		const redLog = seeded.state.conversationLogs.red ?? [];
		expect(redLog.map((entry) => entry.round)).toEqual([3, 4]);
	});
});

describe("getActiveSessionId", () => {
	beforeEach(() => {
		installLocalStorageStub();
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
		installLocalStorageStub();
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
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writes the saving marker, then meta → 3 daemons → engine, then removes the marker", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		const calls = stub.setItem.mock.calls.map((c) => c[0] as string);
		const markerKey = `${SESSIONS_PREFIX}${id}/saving`;
		expect(calls.filter((k) => k !== ACTIVE_KEY)[0]).toBe(markerKey);
		expect(stub.removeItem).toHaveBeenLastCalledWith(markerKey);
		const dataCalls = calls.filter((k) => k !== ACTIVE_KEY && k !== markerKey);

		expect(dataCalls[0]).toMatch(/meta\.json$/);

		expect(dataCalls[dataCalls.length - 1]).toMatch(/engine\.dat$/);

		expect(dataCalls.some((k) => k.includes("whispers"))).toBe(false);

		const daemonCalls = dataCalls.slice(1, dataCalls.length - 1);
		expect(daemonCalls).toHaveLength(3);
		for (const k of daemonCalls) {
			expect(k).toMatch(/\.txt$/);
		}
	});

	it("engine.dat is the last data file written", () => {
		const stub = installLocalStorageStub();
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		const calls = stub.setItem.mock.calls.map((c) => c[0] as string);
		const dataCalls = calls.filter(
			(k) => k !== ACTIVE_KEY && !k.endsWith("/saving"),
		);
		expect(dataCalls[dataCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("returns ok: true on a normal write", () => {
		installLocalStorageStub();
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

	it.each([
		".txt",
		"engine.dat",
	])("a re-save that fails writing %s leaves the session broken, not the old engine", (failingSuffix) => {
		const stub = installLocalStorageStub();
		mintAndActivateNewSession();
		expect(saveActiveSession(makeFreshGame()).ok).toBe(true);
		expect(loadActiveSession().kind).toBe("ok");

		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key.endsWith(failingSuffix)) {
				throw new DOMException("quota", "QuotaExceededError");
			}
			stub._store[key] = value;
		});
		const result = saveActiveSession(makeFreshGame());
		expect(result).toMatchObject({ ok: false, reason: "quota" });
		expect(loadActiveSession().kind).toBe("broken");
	});

	it.each([
		".txt",
		"engine.dat",
	])("a save that fails writing %s reports the lastSavedAt it wrote, so the next save is not stale", (failingSuffix) => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		const first = saveActiveSession(makeFreshGame());
		if (!first.ok) throw new Error("first save failed");

		const failingStore = stub.setItem.getMockImplementation();
		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key.endsWith(failingSuffix)) {
				throw new DOMException("quota", "QuotaExceededError");
			}
			stub._store[key] = value;
		});
		vi.useFakeTimers({ now: Date.parse(first.lastSavedAt) + 1000 });
		const failed = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: first.lastSavedAt,
		});
		vi.useRealTimers();
		expect(failed.lastSavedAt).not.toBe(first.lastSavedAt);
		expect(failed.ok).toBe(false);
		expect(failed.lastSavedAt).toBe(readSessionLastSavedAt(id));
		if (failingStore) stub.setItem.mockImplementation(failingStore);

		const next = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: failed.lastSavedAt ?? first.lastSavedAt,
		});
		expect(next.ok).toBe(true);
		expect(isSessionSaveInProgress(id)).toBe(false);
		expect(loadActiveSession().kind).toBe("ok");

		stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] = JSON.stringify({
			...JSON.parse(stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] ?? "{}"),
			lastSavedAt: "2099-01-01T00:00:00.000Z",
		});
		expect(
			saveActiveSession(makeFreshGame(), {
				expectedLastSavedAt: next.ok ? next.lastSavedAt : "",
			}),
		).toEqual({ ok: false, reason: "stale" });
	});

	it("a re-save that fails writing meta.json removes the marker and leaves the old save ok", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		const game = makeFreshGame();
		expect(saveActiveSession(game).ok).toBe(true);
		const before = { ...stub._store };

		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key.endsWith("meta.json")) {
				throw new DOMException("quota", "QuotaExceededError");
			}
			stub._store[key] = value;
		});
		const result = saveActiveSession(game);
		expect(result).toEqual({ ok: false, reason: "quota" });
		expect(stub._store[`${SESSIONS_PREFIX}${id}/saving`]).toBeUndefined();
		expect(stub._store).toEqual(before);
		expect(loadActiveSession().kind).toBe("ok");
		expect(getSessionInfo(id).kind).toBe("ok");
	});

	it("a re-save that fails writing the saving marker leaves the old save ok", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		const game = makeFreshGame();
		expect(saveActiveSession(game).ok).toBe(true);
		const before = { ...stub._store };

		stub.setItem.mockImplementation((key: string, value: string) => {
			if (key.endsWith("/saving")) {
				throw new DOMException("quota", "QuotaExceededError");
			}
			stub._store[key] = value;
		});
		const result = saveActiveSession(game);
		expect(result).toEqual({ ok: false, reason: "quota" });
		expect(stub._store).toEqual(before);
		const loaded = loadActiveSession();
		expect(loaded.kind).toBe("ok");
		expect(getSessionInfo(id).kind).toBe("ok");
	});

	it("removes the saving marker after a successful save", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		expect(stub._store[`${SESSIONS_PREFIX}${id}/saving`]).toBeUndefined();
	});

	it("the saving marker is not listed as a daemon file nor copied by dup or archive", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const dupId = dupSession(id);
		await archiveSession(id);
		stub._store[`${SESSIONS_PREFIX}${id}/saving`] = "x";

		const info = getSessionInfo(id);
		expect(info.kind).toBe("broken");
		expect(info.daemonFiles.map((f) => f.name)).toEqual([
			"cyan.txt",
			"green.txt",
			"red.txt",
		]);
		expect(listSessions().sort()).toEqual([id, dupId].sort());
		expect(stub._store[`${SESSIONS_PREFIX}${dupId}/saving`]).toBeUndefined();
		expect(stub._store[`${ARCHIVE_PREFIX}${id}/saving`]).toBeUndefined();
		await expect(archiveSession(id)).rejects.toThrow(/incomplete/);
	});

	it("isSessionComplete is false exactly when archiveSession would refuse the session", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		expect(isSessionComplete(id)).toBe(false);
		saveActiveSession(makeFreshGame());
		expect(isSessionComplete(id)).toBe(true);
		stub._store[`${SESSIONS_PREFIX}${id}/saving`] = "x";
		expect(isSessionComplete(id)).toBe(false);
	});

	it("preserves createdAt from the existing meta.json on re-save", () => {
		installLocalStorageStub();
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game, { createdAt: "2024-01-01T00:00:00.000Z" });
		saveActiveSession(game);
		const loaded = loadActiveSession();
		expect(loaded.kind).toBe("ok");
		if (loaded.kind === "ok") {
			expect(loaded.createdAt).toBe("2024-01-01T00:00:00.000Z");
		}
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
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 'none' when pointer absent", () => {
		const result = loadActiveSession();
		expect(result.kind).toBe("none");
	});

	it("returns 'broken' when engine.dat is missing", () => {
		const stub = installLocalStorageStub();
		const sessionId = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);
		stub.removeItem(`${SESSIONS_PREFIX}${sessionId}/engine.dat`);
		stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`] =
			undefined as unknown as string;
		delete stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`];
		const result = loadActiveSession();
		expect(result.kind).toBe("broken");
	});

	it("returns 'broken' when engine.dat fails deobfuscation", () => {
		const stub = installLocalStorageStub();
		const sessionId = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);
		stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`] =
			"not-valid-base64$$$";
		const result = loadActiveSession();
		expect(result.kind).toBe("broken");
	});

	it("returns 'version-mismatch' when sealed schemaVersion is stale", () => {
		const stub = installLocalStorageStub();
		const sessionId = mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

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
		if (result.kind === "version-mismatch") {
			expect(result.schemaVersion).toBe(999);
		}
	});

	it("save → load round-trip returns ok with correct state", () => {
		installLocalStorageStub();
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);
		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.isComplete).toBe(false);
			expect(result.state.round).toBe(0);
		}
	});
});

describe("clearActiveSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes pointer + all session files", () => {
		const stub = installLocalStorageStub();
		mintAndActivateNewSession();
		const game = makeFreshGame();
		saveActiveSession(game);

		clearActiveSession();

		expect(stub._store[ACTIVE_KEY]).toBeUndefined();
		const remaining = Object.keys(stub._store).filter((k) =>
			k.startsWith(SESSIONS_PREFIX),
		);
		expect(remaining).toHaveLength(0);
	});

	it("is a no-op (no throw) when no active session", () => {
		installLocalStorageStub();
		expect(() => clearActiveSession()).not.toThrow();
	});
});

describe("hasLegacySave / deleteLegacySaveKey", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("hasLegacySave returns false when legacy key absent", () => {
		installLocalStorageStub();
		expect(hasLegacySave()).toBe(false);
	});

	it("hasLegacySave returns true when legacy key present", () => {
		installLocalStorageStub({ [LEGACY_KEY]: '{"old":"save"}' });
		expect(hasLegacySave()).toBe(true);
	});

	it("deleteLegacySaveKey removes the legacy key", () => {
		const stub = installLocalStorageStub({ [LEGACY_KEY]: '{"old":"save"}' });
		deleteLegacySaveKey();
		expect(stub._store[LEGACY_KEY]).toBeUndefined();
	});

	it("deleteLegacySaveKey is a no-op when legacy key absent", () => {
		installLocalStorageStub();
		expect(() => deleteLegacySaveKey()).not.toThrow();
	});
});

describe("consecutive saves", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("two consecutive saveActiveSession calls update engine.dat (no stale data)", () => {
		installLocalStorageStub();
		mintAndActivateNewSession();
		const game = makeFreshGame();

		saveActiveSession(game, { createdAt: "2024-01-01T00:00:00.000Z" });
		const firstLoad = loadActiveSession();
		expect(firstLoad.kind).toBe("ok");

		saveActiveSession(game, { createdAt: "2024-01-01T00:00:00.000Z" });
		const secondLoad = loadActiveSession();
		expect(secondLoad.kind).toBe("ok");
		if (secondLoad.kind === "ok") {
			expect(secondLoad.state.isComplete).toBe(false);
		}
	});
});

describe("saveActiveSession expectedLastSavedAt", () => {
	beforeEach(() => {
		installLocalStorageStub();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("saves and reports the new lastSavedAt when the stored save is the expected one", () => {
		const id = mintAndActivateNewSession();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
		const first = saveActiveSession(makeFreshGame());
		if (!first.ok) throw new Error("first save failed");
		vi.setSystemTime(new Date("2025-01-01T00:00:01.000Z"));

		const second = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: first.lastSavedAt,
		});

		expect(second).toEqual({
			ok: true,
			lastSavedAt: "2025-01-01T00:00:01.000Z",
		});
		expect(readSessionLastSavedAt(id)).toBe("2025-01-01T00:00:01.000Z");
	});

	it("refuses with reason stale and leaves storage untouched when another writer saved since", () => {
		const id = mintAndActivateNewSession();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
		const loadedWith = saveActiveSession(makeFreshGame());
		if (!loadedWith.ok) throw new Error("first save failed");
		vi.setSystemTime(new Date("2025-01-01T00:00:05.000Z"));
		saveActiveSession(makeFreshGame());
		const metaBefore = localStorage.getItem(
			`${SESSIONS_PREFIX}${id}/meta.json`,
		);
		vi.setSystemTime(new Date("2025-01-01T00:00:09.000Z"));

		const result = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: loadedWith.lastSavedAt,
		});

		expect(result).toEqual({ ok: false, reason: "stale" });
		expect(localStorage.getItem(`${SESSIONS_PREFIX}${id}/meta.json`)).toBe(
			metaBefore,
		);
		expect(isSessionSaveInProgress(id)).toBe(false);
	});

	it("refuses with reason stale when the session was removed since", () => {
		const id = mintAndActivateNewSession();
		const loadedWith = saveActiveSession(makeFreshGame());
		if (!loadedWith.ok) throw new Error("first save failed");
		rmSession(id);

		const result = saveActiveSession(makeFreshGame(), {
			sessionId: id,
			expectedLastSavedAt: loadedWith.lastSavedAt,
		});

		expect(result).toEqual({ ok: false, reason: "stale" });
		expect(listSessions()).not.toContain(id);
	});
});

describe("sessionChangedSince", () => {
	beforeEach(() => {
		installLocalStorageStub();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("is false while the stored save is the one the caller holds", () => {
		const id = mintAndActivateNewSession();
		const saved = saveActiveSession(makeFreshGame());
		if (!saved.ok) throw new Error("save failed");

		expect(sessionChangedSince(id, saved.lastSavedAt)).toBe(false);
	});

	it("is true once another save lands", () => {
		const id = mintAndActivateNewSession();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
		const saved = saveActiveSession(makeFreshGame());
		if (!saved.ok) throw new Error("save failed");
		vi.setSystemTime(new Date("2025-01-01T00:00:05.000Z"));
		saveActiveSession(makeFreshGame());

		expect(sessionChangedSince(id, saved.lastSavedAt)).toBe(true);
	});

	it("is true once the session is removed", () => {
		const id = mintAndActivateNewSession();
		const saved = saveActiveSession(makeFreshGame());
		if (!saved.ok) throw new Error("save failed");
		rmSession(id);

		expect(sessionChangedSince(id, saved.lastSavedAt)).toBe(true);
	});

	it("leaves an unreadable meta.json to the caller's own storage calls", () => {
		const id = mintAndActivateNewSession();
		const saved = saveActiveSession(makeFreshGame());
		if (!saved.ok) throw new Error("save failed");
		localStorage.setItem(`${SESSIONS_PREFIX}${id}/meta.json`, "{not json");

		expect(sessionChangedSince(id, saved.lastSavedAt)).toBe(false);
	});
});

describe("listSessions", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns empty array when no sessions exist", () => {
		installLocalStorageStub();
		expect(listSessions()).toEqual([]);
	});

	it("returns minted-then-saved session ids", () => {
		installLocalStorageStub();
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
		installLocalStorageStub({
			[ACTIVE_KEY]: "0xABCD",
			[LEGACY_KEY]: "{}",
		});
		const ids = listSessions();
		expect(ids).not.toContain(ACTIVE_KEY);
		expect(ids).not.toContain(LEGACY_KEY);
		expect(ids).toEqual([]);
	});

	it("de-duplicates ids that have multiple files", () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const ids = listSessions();
		expect(ids.filter((x) => x === id)).toHaveLength(1);
	});
});

describe("loadSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 'none' for an id with no data", () => {
		installLocalStorageStub();
		const result = loadSession("0x9999");
		expect(result.kind).toBe("none");
	});

	it("returns 'ok' for a saved session", () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const result = loadSession(id);
		expect(result.kind).toBe("ok");
	});

	it("returns 'broken' when engine.dat is missing", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];
		const result = loadSession(id);
		expect(result.kind).toBe("broken");
	});

	it("returns 'version-mismatch' when schemaVersion is stale", () => {
		const stub = installLocalStorageStub();
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
		installLocalStorageStub();
		const activeId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		loadSession("0x1234");
		expect(getActiveSessionId()).toBe(activeId);
	});
});

describe("mintSessionId activation", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns /^0x[0-9A-F]{4}$/ format", () => {
		installLocalStorageStub();
		const id = mintSessionId();
		expect(id).toMatch(/^0x[0-9A-F]{4}$/);
	});

	it("does NOT set the active pointer", () => {
		installLocalStorageStub();
		mintSessionId();
		expect(getActiveSessionId()).toBeNull();
	});
});

describe("dupSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("produces a new id distinct from the source", () => {
		installLocalStorageStub();
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const newId = dupSession(srcId);
		expect(newId).not.toBe(srcId);
		expect(newId).toMatch(/^0x[0-9A-F]{4}$/);
	});

	it("new session keys are deep-independent: mutating new engine.dat does not affect original", () => {
		const stub = installLocalStorageStub();
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const newId = dupSession(srcId);

		stub._store[`${SESSIONS_PREFIX}${newId}/engine.dat`] = "corrupted";

		const origResult = loadSession(srcId);
		expect(origResult.kind).toBe("ok");

		const newResult = loadSession(newId);
		expect(newResult.kind).toBe("broken");
	});

	it("engine.dat is written LAST (commit signal)", () => {
		const stub = installLocalStorageStub();
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		stub.setItem.mockClear();
		const newId = dupSession(srcId);

		const calls = stub.setItem.mock.calls.map((c) => c[0] as string);
		const newPrefix = `${SESSIONS_PREFIX}${newId}/`;
		const newCalls = calls.filter((k) => k.startsWith(newPrefix));
		expect(newCalls[newCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("active pointer is unchanged after dup", () => {
		installLocalStorageStub();
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		dupSession(srcId);
		expect(getActiveSessionId()).toBe(srcId);
	});

	it("throws on broken source session", () => {
		const stub = installLocalStorageStub();
		const srcId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${srcId}/engine.dat`];
		expect(() => dupSession(srcId)).toThrow();
	});

	it("throws on version-mismatch source session", () => {
		const stub = installLocalStorageStub();
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

describe("rmSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes only the named id's keys", () => {
		const stub = installLocalStorageStub();
		const id1 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const id2 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		rmSession(id1);

		const remaining = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}${id1}/`),
		);
		expect(remaining).toHaveLength(0);

		const id2Keys = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}${id2}/`),
		);
		expect(id2Keys.length).toBeGreaterThan(0);
	});

	it("clears active pointer when removing the active session", () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		expect(getActiveSessionId()).toBe(id);

		rmSession(id);

		expect(getActiveSessionId()).toBeNull();
	});

	it("does NOT clear active pointer when removing a non-active session", () => {
		installLocalStorageStub();
		const id1 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const id2 = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		expect(getActiveSessionId()).toBe(id2);

		rmSession(id1);

		expect(getActiveSessionId()).toBe(id2);
	});
});

describe("getSessionInfo", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns kind=ok for a valid session", () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const info = getSessionInfo(id);
		expect(info.kind).toBe("ok");
		if (info.kind === "ok") {
			expect(info.epoch).toBe(1);
			expect(typeof info.lastSavedAt).toBe("string");
			expect(Array.isArray(info.daemonFiles)).toBe(true);
			expect(info.daemonFiles.length).toBeGreaterThan(0);
		}
	});

	it("returns kind=broken when engine.dat is missing", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];
		const info = getSessionInfo(id);
		expect(info.kind).toBe("broken");
	});

	it("returns kind=version-mismatch when schemaVersion is stale", () => {
		const stub = installLocalStorageStub();
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
			expect(info.schemaVersion).toBe(999);
			expect(Array.isArray(info.daemonFiles)).toBe(true);
		}
	});
});

function seedArchiveInStub(stub: LocalStorageStub, sessionId: string): void {
	const srcPrefix = `${SESSIONS_PREFIX}${sessionId}/`;
	const dstPrefix = `${ARCHIVE_PREFIX}${sessionId}/`;
	for (const [key, value] of Object.entries(stub._store)) {
		if (key.startsWith(srcPrefix) && !key.endsWith("engine.dat")) {
			stub._store[`${dstPrefix}${key.slice(srcPrefix.length)}`] = value;
		}
	}
	const metaKey = `${srcPrefix}meta.json`;
	if (stub._store[metaKey]) {
		const meta = JSON.parse(stub._store[metaKey]) as Record<string, unknown>;
		meta.readonly = true;
		meta.lastPlayedAt = meta.lastSavedAt;
		stub._store[`${dstPrefix}meta.json`] = JSON.stringify(meta, null, 2);
	}
	const engineKey = `${srcPrefix}engine.dat`;
	if (stub._store[engineKey]) {
		stub._store[`${dstPrefix}engine.dat`] = stub._store[engineKey];
	}
}

describe("archiveSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("copies meta, daemon .txt files, and engine.dat to archive namespace", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		await archiveSession(id);

		const dstPrefix = `${ARCHIVE_PREFIX}${id}/`;
		expect(stub._store[`${dstPrefix}meta.json`]).toBeDefined();
		expect(stub._store[`${dstPrefix}engine.dat`]).toBeDefined();
		const daemonKeys = Object.keys(stub._store).filter(
			(k) => k.startsWith(dstPrefix) && k.endsWith(".txt"),
		);
		expect(daemonKeys.length).toBeGreaterThan(0);
	});

	it("replaces an existing archive under the same id instead of merging", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const dstPrefix = `${ARCHIVE_PREFIX}${id}/`;
		stub._store[`${dstPrefix}stale.txt`] = JSON.stringify({
			aiId: "stale",
			persona: TEST_PERSONAS.red,
			conversationLog: [],
		});

		await archiveSession(id);

		expect(stub._store[`${dstPrefix}stale.txt`]).toBeUndefined();
		const archived = loadArchivedSession(id);
		expect(archived.kind).toBe("ok");
		if (archived.kind === "ok") {
			expect(Object.keys(archived.state.personas).sort()).toEqual([
				"cyan",
				"green",
				"red",
			]);
		}
	});

	it("engine.dat is written LAST in archive namespace", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		stub.setItem.mockClear();
		await archiveSession(id);

		const dstPrefix = `${ARCHIVE_PREFIX}${id}/`;
		const archiveCalls = stub.setItem.mock.calls
			.map((c) => c[0] as string)
			.filter((k) => k.startsWith(dstPrefix));
		expect(archiveCalls[archiveCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("archived meta has readonly: true and lastPlayedAt === source meta lastSavedAt", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame(), {
			createdAt: "2024-01-01T00:00:00.000Z",
		});

		const srcMeta = JSON.parse(
			stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] ?? "{}",
		);
		const srcLastSavedAt = srcMeta.lastSavedAt as string;

		await archiveSession(id);

		const archivedMeta = JSON.parse(
			stub._store[`${ARCHIVE_PREFIX}${id}/meta.json`] ?? "{}",
		);
		expect(archivedMeta.readonly).toBe(true);
		expect(archivedMeta.lastPlayedAt).toBe(srcLastSavedAt);
	});

	it("archived meta retains epoch from source", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		const metaRaw = stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] ?? "{}";
		const meta = JSON.parse(metaRaw);
		meta.epoch = 7;
		stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] = JSON.stringify(
			meta,
			null,
			2,
		);

		await archiveSession(id);

		const archivedMeta = JSON.parse(
			stub._store[`${ARCHIVE_PREFIX}${id}/meta.json`] ?? "{}",
		);
		expect(archivedMeta.epoch).toBe(7);
	});

	it("source session still loads ok after archiving (source keys untouched)", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		await archiveSession(id);

		const result = loadSession(id);
		expect(result.kind).toBe("ok");
	});

	it("throws when source meta.json is missing", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${id}/meta.json`];

		await expect(archiveSession(id)).rejects.toThrow();
	});

	it("throws when source engine.dat is missing", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		delete stub._store[`${SESSIONS_PREFIX}${id}/engine.dat`];

		await expect(archiveSession(id)).rejects.toThrow();
	});

	it("does not touch the active pointer", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		await archiveSession(id);

		expect(getActiveSessionId()).toBe(id);
	});

	it("returns a resolved Promise", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		const result = archiveSession(id);
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();
	});
});

describe("listArchivedSessions", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns empty when none", () => {
		installLocalStorageStub();
		expect(listArchivedSessions()).toEqual([]);
	});

	it("returns archived session ids after archiveSession", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		const ids = listArchivedSessions();
		expect(ids).toContain(id);
	});

	it("returns archived session ids seeded via seedArchiveInStub", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		seedArchiveInStub(stub, id);

		const ids = listArchivedSessions();
		expect(ids).toContain(id);
	});

	it("does not return sessions/ namespace ids", () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		const ids = listArchivedSessions();
		expect(ids).not.toContain(id);
	});
});

describe("loadArchivedSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns ok for a valid archived session", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		const result = loadArchivedSession(id);
		expect(result.kind).toBe("ok");
	});

	it("returns broken when archived engine.dat is missing", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);
		delete stub._store[`${ARCHIVE_PREFIX}${id}/engine.dat`];

		const result = loadArchivedSession(id);
		expect(result.kind).toBe("broken");
	});

	it("returns version-mismatch when schemaVersion is stale", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		const engineBlob = stub._store[`${ARCHIVE_PREFIX}${id}/engine.dat`];
		if (!engineBlob) throw new Error("archived engine.dat should exist");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		sealed.schemaVersion = 999;
		stub._store[`${ARCHIVE_PREFIX}${id}/engine.dat`] = obfuscate(
			JSON.stringify(sealed),
		);

		const result = loadArchivedSession(id);
		expect(result.kind).toBe("version-mismatch");
	});
});

describe("getArchivedSessionInfo", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns kind=archived with epoch, lastPlayedAt, round for valid archived session", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		const info = getArchivedSessionInfo(id);
		expect(info.kind).toBe("archived");
		if (info.kind === "archived") {
			expect(typeof info.epoch).toBe("number");
			expect(typeof info.lastPlayedAt).toBe("string");
			expect(typeof info.round).toBe("number");
		}
	});

	it("returns kind=broken when archived engine.dat is missing", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);
		delete stub._store[`${ARCHIVE_PREFIX}${id}/engine.dat`];

		const info = getArchivedSessionInfo(id);
		expect(info.kind).toBe("broken");
	});

	it("returns kind=version-mismatch when schemaVersion is stale", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		const engineBlob = stub._store[`${ARCHIVE_PREFIX}${id}/engine.dat`];
		if (!engineBlob) throw new Error("archived engine.dat should exist");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		sealed.schemaVersion = 999;
		stub._store[`${ARCHIVE_PREFIX}${id}/engine.dat`] = obfuscate(
			JSON.stringify(sealed),
		);

		const info = getArchivedSessionInfo(id);
		expect(info.kind).toBe("version-mismatch");
		if (info.kind === "version-mismatch") {
			expect(info.schemaVersion).toBe(999);
		}
	});
});

describe("rmArchivedSession", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes only that archive id's keys, not sessions/ keys", async () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		rmArchivedSession(id);

		const archiveKeys = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${ARCHIVE_PREFIX}${id}/`),
		);
		expect(archiveKeys).toHaveLength(0);

		const sessionKeys = Object.keys(stub._store).filter((k) =>
			k.startsWith(`${SESSIONS_PREFIX}${id}/`),
		);
		expect(sessionKeys.length).toBeGreaterThan(0);
	});

	it("does not touch active pointer", async () => {
		installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		await archiveSession(id);

		rmArchivedSession(id);

		expect(getActiveSessionId()).toBe(id);
	});
});

describe("epoch in active sessions", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("new save writes an epoch field in meta.json (typeof === 'number')", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		const metaRaw = stub._store[`${SESSIONS_PREFIX}${id}/meta.json`];
		expect(metaRaw).toBeDefined();
		const meta = JSON.parse(metaRaw ?? "{}");
		expect(typeof meta.epoch).toBe("number");
	});

	it("re-save preserves the epoch (seed meta with epoch=7, re-save, epoch stays 7)", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		const metaRaw = stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] ?? "{}";
		const meta = JSON.parse(metaRaw);
		meta.epoch = 7;
		stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] = JSON.stringify(
			meta,
			null,
			2,
		);

		saveActiveSession(makeFreshGame());

		const reloadedMeta = JSON.parse(
			stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] ?? "{}",
		);
		expect(reloadedMeta.epoch).toBe(7);
	});

	it("advanceEpoch saves the session under the next epoch", () => {
		const stub = installLocalStorageStub();
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());
		saveActiveSession(makeFreshGame(), { advanceEpoch: true });

		const meta = JSON.parse(
			stub._store[`${SESSIONS_PREFIX}${id}/meta.json`] ?? "{}",
		);
		expect(meta.epoch).toBe(2);
	});
});

async function seedArchivedSession(
	stub: LocalStorageStub,
	id: string,
	epochOverride = 1,
): Promise<void> {
	const { serializeSession } = await import("../session-codec.js");
	const game = makeFreshGame();
	const now = "2024-01-01T00:00:00.000Z";
	const files = serializeSession(game, now, now, epochOverride);
	const prefix = `${ARCHIVE_PREFIX}${id}/`;
	const meta = JSON.parse(files.meta) as Record<string, unknown>;
	meta.readonly = true;
	meta.lastPlayedAt = now;
	stub._store[`${prefix}meta.json`] = JSON.stringify(meta, null, 2);
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		stub._store[`${prefix}${aiId}.txt`] = daemonJson;
	}
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns a non-null engine string
	stub._store[`${prefix}engine.dat`] = files.engine!;
}

describe("seedFromArchive", () => {
	beforeEach(() => {
		installLocalStorageStub();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("mints a new session id that matches /^0x[0-9A-F]{4}$/ and differs from archiveId", async () => {
		const stub = installLocalStorageStub();
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId);
		const freshState = makeFreshGame();
		const newId = seedFromArchive(archiveId, freshState);
		expect(newId).toMatch(/^0x[0-9A-F]{4}$/);
		expect(newId).not.toBe(archiveId);
	});

	it("new session has epoch = archive.epoch + 1", async () => {
		const stub = installLocalStorageStub();
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId, 3);
		const freshState = makeFreshGame();
		const newId = seedFromArchive(archiveId, freshState);
		const metaRaw = stub._store[`${SESSIONS_PREFIX}${newId}/meta.json`];
		expect(metaRaw).toBeDefined();
		const meta = JSON.parse(metaRaw ?? "{}");
		expect(meta.epoch).toBe(4);
	});

	it("copies all archived daemon conversation logs into the new session", async () => {
		const stub = installLocalStorageStub();
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId);

		const redKey = `${ARCHIVE_PREFIX}${archiveId}/red.txt`;
		const redRaw = stub._store[redKey];
		if (!redRaw) throw new Error("red.txt should exist in archive");
		const redFile = JSON.parse(redRaw) as { conversationLog: unknown[] };
		const testEntry = {
			kind: "message",
			round: 0,
			from: "blue",
			to: "red",
			content: "Hello from archive",
		};
		redFile.conversationLog.push(testEntry);
		stub._store[redKey] = JSON.stringify(redFile);

		const freshState = makeFreshGame();
		const newId = seedFromArchive(archiveId, freshState);

		const newRedRaw = stub._store[`${SESSIONS_PREFIX}${newId}/red.txt`];
		expect(newRedRaw).toBeDefined();
		const newRedFile = JSON.parse(newRedRaw ?? "{}") as {
			conversationLog: Array<{ content?: string }>;
		};
		const hasTestEntry = newRedFile.conversationLog.some(
			(e) => e.content === "Hello from archive",
		);
		expect(hasTestEntry).toBe(true);
	});

	it("appends broadcast entry to every daemon log", async () => {
		const stub = installLocalStorageStub();
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId);
		const freshState = makeFreshGame();
		const newId = seedFromArchive(archiveId, freshState);

		const daemonKeys = Object.keys(stub._store).filter(
			(k) => k.startsWith(`${SESSIONS_PREFIX}${newId}/`) && k.endsWith(".txt"),
		);
		expect(daemonKeys.length).toBeGreaterThan(0);
		for (const key of daemonKeys) {
			const fileRaw = stub._store[key];
			expect(fileRaw).toBeDefined();
			const file = JSON.parse(fileRaw ?? "{}") as {
				conversationLog: Array<{ kind: string; content: string }>;
			};
			const lastEntry = file.conversationLog[file.conversationLog.length - 1];
			expect(lastEntry?.kind).toBe("broadcast");
			expect(lastEntry?.content).toBe("The sysadmin has created a new room.");
		}
	});

	it("does not touch the archived session after seeding", async () => {
		const stub = installLocalStorageStub();
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId);

		const archivePrefix = `${ARCHIVE_PREFIX}${archiveId}/`;
		const before: Record<string, string> = {};
		for (const [k, v] of Object.entries(stub._store)) {
			if (k.startsWith(archivePrefix)) before[k] = v;
		}
		expect(Object.keys(before).length).toBeGreaterThan(0);

		const freshState = makeFreshGame();
		seedFromArchive(archiveId, freshState);

		for (const [k, v] of Object.entries(before)) {
			expect(stub._store[k]).toBe(v);
		}
	});

	it("does not modify the active session pointer", async () => {
		const stub = installLocalStorageStub();
		stub._store[ACTIVE_KEY] = "0xZZZZ";
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId);
		const freshState = makeFreshGame();
		seedFromArchive(archiveId, freshState);
		expect(stub._store[ACTIVE_KEY]).toBe("0xZZZZ");
	});

	it("writes engine.dat as the last file in the new session namespace", async () => {
		const stub = installLocalStorageStub();
		const archiveId = "0xARCH";
		await seedArchivedSession(stub, archiveId);
		const freshState = makeFreshGame();

		stub.setItem.mockClear();
		const newId = seedFromArchive(archiveId, freshState);

		const newPrefix = `${SESSIONS_PREFIX}${newId}/`;
		const newCalls = stub.setItem.mock.calls
			.map((c) => c[0] as string)
			.filter((k) => k.startsWith(newPrefix));
		expect(newCalls[newCalls.length - 1]).toMatch(/engine\.dat$/);
	});
});

describe("v12 boundary (archive-only)", () => {
	function seedSessionAtSchema(
		stub: LocalStorageStub,
		schemaVersion: number,
	): { sessionId: string; bytes: Record<string, string> } {
		const sessionId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		const engineKey = `${SESSIONS_PREFIX}${sessionId}/engine.dat`;
		const engineBlob = stub._store[engineKey];
		if (!engineBlob) throw new Error("engine.dat should exist after save");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		sealed.schemaVersion = schemaVersion;
		stub._store[engineKey] = obfuscate(JSON.stringify(sealed));

		const prefix = `${SESSIONS_PREFIX}${sessionId}/`;
		const bytes: Record<string, string> = {};
		for (const [key, value] of Object.entries(stub._store)) {
			if (key.startsWith(prefix) && typeof value === "string") {
				bytes[key] = value;
			}
		}
		return { sessionId, bytes };
	}

	it("writes new saves at schema 12", () => {
		const stub = installLocalStorageStub();
		const sessionId = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame());

		const engineBlob = stub._store[`${SESSIONS_PREFIX}${sessionId}/engine.dat`];
		if (!engineBlob) throw new Error("engine.dat should exist after save");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		expect(sealed.schemaVersion).toBe(12);
		expect(loadActiveSession().kind).toBe("ok");
	});

	it("surfaces a session stamped 11 as a version-mismatch carrying the archived build", () => {
		const stub = installLocalStorageStub();
		const { sessionId } = seedSessionAtSchema(stub, 11);

		const info = getSessionInfo(sessionId);
		expect(info.kind).toBe("version-mismatch");
		if (info.kind === "version-mismatch") {
			expect(info.schemaVersion).toBe(11);
			expect(lookupArchiveVersion(info.schemaVersion)).toBe("0.0.2-beta.2");
		}
		expect(loadSession(sessionId).kind).toBe("version-mismatch");
	});

	it("preserves the original bytes when a stale session hits the mismatch route", () => {
		const stub = installLocalStorageStub();
		const { sessionId, bytes } = seedSessionAtSchema(stub, 11);
		expect(Object.keys(bytes).length).toBeGreaterThanOrEqual(5);

		expect(loadActiveSession().kind).toBe("version-mismatch");
		expect(getSessionInfo(sessionId).kind).toBe("version-mismatch");
		deactivateActiveSession();

		expect(getActiveSessionId()).toBeNull();
		for (const [key, value] of Object.entries(bytes)) {
			expect(stub._store[key], key).toBe(value);
		}
		expect(listSessions()).toContain(sessionId);
		expect(getSessionInfo(sessionId).kind).toBe("version-mismatch");
	});

	it("keeps a session stamped 4 (pre-horizon-landmark era) as an older mismatch too", () => {
		const stub = installLocalStorageStub();
		const { sessionId, bytes } = seedSessionAtSchema(stub, 4);

		expect(loadSession(sessionId).kind).toBe("version-mismatch");
		for (const [key, value] of Object.entries(bytes)) {
			expect(stub._store[key], key).toBe(value);
		}
	});
});
