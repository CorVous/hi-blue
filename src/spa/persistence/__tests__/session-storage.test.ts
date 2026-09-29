import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installLocalStorageStub,
	type LocalStorageStub,
} from "../../__tests__/fixtures/local-storage";
import { TEST_PERSONAS } from "../../game/__tests__/fixtures/make-game-state.js";
import { appendBroadcast } from "../../game/engine.js";
import { lookupArchiveVersion } from "../archive-map.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import { serializeSession } from "../session-codec.js";
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
import { makeFreshGame } from "./make-fresh-game.js";

const SESSION_ID_PATTERN = /^0x[0-9A-F]{4}$/;

let stub: LocalStorageStub;

beforeEach(() => {
	stub = installLocalStorageStub();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function saveFreshSession(): string {
	const id = mintAndActivateNewSession();
	saveActiveSession(makeFreshGame());
	return id;
}

async function archiveFreshSession(): Promise<string> {
	const id = saveFreshSession();
	await archiveSession(id);
	return id;
}

function sessionKey(id: string, file: string): string {
	return `${SESSIONS_PREFIX}${id}/${file}`;
}

function archiveKey(id: string, file: string): string {
	return `${ARCHIVE_PREFIX}${id}/${file}`;
}

function keysUnder(prefix: string): string[] {
	return Object.keys(stub._store).filter((k) => k.startsWith(prefix));
}

function setItemKeys(): string[] {
	return stub.setItem.mock.calls.map((c) => c[0] as string);
}

function readMeta(key: string): Record<string, unknown> {
	return JSON.parse(stub._store[key] ?? "{}") as Record<string, unknown>;
}

function patchSessionMeta(id: string, patch: Record<string, unknown>): void {
	const key = sessionKey(id, "meta.json");
	stub._store[key] = JSON.stringify({ ...readMeta(key), ...patch }, null, 2);
}

function stampSchemaVersion(engineKey: string, schemaVersion: number): void {
	const engineBlob = stub._store[engineKey];
	if (!engineBlob) throw new Error(`${engineKey} should exist`);
	const sealed = JSON.parse(deobfuscate(engineBlob));
	sealed.schemaVersion = schemaVersion;
	stub._store[engineKey] = obfuscate(JSON.stringify(sealed));
}

function failWritesEndingWith(
	suffix: string,
	error: DOMException = new DOMException("quota", "QuotaExceededError"),
): void {
	stub.setItem.mockImplementation((key: string, value: string) => {
		if (key.endsWith(suffix)) throw error;
		stub._store[key] = value;
	});
}

describe("mintSessionId", () => {
	it("matches /^0x[0-9A-F]{4}$/ and does NOT set the active pointer", () => {
		expect(mintSessionId()).toMatch(SESSION_ID_PATTERN);
		expect(getActiveSessionId()).toBeNull();
	});

	it("can mint 0xFFFF at the top of the range", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.99999999);
		expect(mintSessionId()).toBe("0xFFFF");
	});

	it("re-rolls while the id is taken under sessions/ or archive/", () => {
		installLocalStorageStub({
			[sessionKey("0x0000", "meta.json")]: "{}",
			[archiveKey("0x0001", "engine.dat")]: "x",
		});
		vi.spyOn(Math, "random")
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(1 / 0x10000)
			.mockReturnValueOnce(2 / 0x10000);
		expect(mintSessionId()).toBe("0x0002");
	});

	it("dupSession and seedFromArchive never reuse an existing id", async () => {
		const id = await archiveFreshSession();
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
	it("returns null when absent", () => {
		expect(getActiveSessionId()).toBeNull();
	});

	it("returns the stored value after setActiveSessionId", () => {
		setActiveSessionId("0xABCD");
		expect(getActiveSessionId()).toBe("0xABCD");
	});
});

describe("mintAndActivateNewSession", () => {
	it("sets pointer to /^0x[0-9A-F]{4}$/ format", () => {
		const id = mintAndActivateNewSession();
		expect(id).toMatch(SESSION_ID_PATTERN);
		expect(getActiveSessionId()).toBe(id);
	});
});

describe("saveActiveSession", () => {
	it("writes the saving marker, then meta → 3 daemons → engine, then removes the marker", () => {
		const id = mintAndActivateNewSession();
		const result = saveActiveSession(makeFreshGame());

		expect(result.ok).toBe(true);
		const calls = setItemKeys();
		const markerKey = sessionKey(id, "saving");
		expect(calls.filter((k) => k !== ACTIVE_KEY)[0]).toBe(markerKey);
		expect(stub.removeItem).toHaveBeenLastCalledWith(markerKey);
		expect(stub._store[markerKey]).toBeUndefined();
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

	it.each([
		["quota", "QuotaExceededError"],
		["unavailable", "SecurityError"],
	])("returns ok: false reason: %s on %s", (reason, errorName) => {
		failWritesEndingWith("engine.dat", new DOMException("x", errorName));
		mintAndActivateNewSession();
		const result = saveActiveSession(makeFreshGame());
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe(reason);
	});

	it.each([
		".txt",
		"engine.dat",
	])("a re-save that fails writing %s leaves the session broken, not the old engine", (failingSuffix) => {
		mintAndActivateNewSession();
		expect(saveActiveSession(makeFreshGame()).ok).toBe(true);
		expect(loadActiveSession().kind).toBe("ok");

		failWritesEndingWith(failingSuffix);
		const result = saveActiveSession(makeFreshGame());
		expect(result).toMatchObject({ ok: false, reason: "quota" });
		expect(loadActiveSession().kind).toBe("broken");
	});

	it.each([
		".txt",
		"engine.dat",
	])("a save that fails writing %s reports the lastSavedAt it wrote, so the next save is not stale", (failingSuffix) => {
		const id = mintAndActivateNewSession();
		const first = saveActiveSession(makeFreshGame());
		if (!first.ok) throw new Error("first save failed");

		const storeEveryWrite = stub.setItem.getMockImplementation();
		failWritesEndingWith(failingSuffix);
		vi.useFakeTimers({ now: Date.parse(first.lastSavedAt) + 1000 });
		const failed = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: first.lastSavedAt,
		});
		vi.useRealTimers();
		expect(failed.lastSavedAt).not.toBe(first.lastSavedAt);
		expect(failed.ok).toBe(false);
		expect(failed.lastSavedAt).toBe(readSessionLastSavedAt(id));
		if (storeEveryWrite) stub.setItem.mockImplementation(storeEveryWrite);

		const next = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: failed.lastSavedAt ?? first.lastSavedAt,
		});
		expect(next.ok).toBe(true);
		expect(isSessionSaveInProgress(id)).toBe(false);
		expect(loadActiveSession().kind).toBe("ok");

		patchSessionMeta(id, { lastSavedAt: "2099-01-01T00:00:00.000Z" });
		expect(
			saveActiveSession(makeFreshGame(), {
				expectedLastSavedAt: next.ok ? next.lastSavedAt : "",
			}),
		).toEqual({ ok: false, reason: "stale" });
	});

	it.each([
		["meta.json", "meta.json"],
		["the saving marker", "/saving"],
	])("a re-save that fails writing %s removes the marker and leaves the old save ok", (_file, failingSuffix) => {
		const id = mintAndActivateNewSession();
		const game = makeFreshGame();
		expect(saveActiveSession(game).ok).toBe(true);
		const before = { ...stub._store };

		failWritesEndingWith(failingSuffix);
		const result = saveActiveSession(game);
		expect(result).toEqual({ ok: false, reason: "quota" });
		expect(stub._store[sessionKey(id, "saving")]).toBeUndefined();
		expect(stub._store).toEqual(before);
		expect(loadActiveSession().kind).toBe("ok");
		expect(getSessionInfo(id).kind).toBe("ok");
	});

	it("the saving marker is not listed as a daemon file nor copied by dup or archive", async () => {
		const id = saveFreshSession();
		const dupId = dupSession(id);
		await archiveSession(id);
		stub._store[sessionKey(id, "saving")] = "x";

		const info = getSessionInfo(id);
		expect(info.kind).toBe("broken");
		expect(info.daemonFiles.map((f) => f.name)).toEqual([
			"cyan.txt",
			"green.txt",
			"red.txt",
		]);
		expect(listSessions().sort()).toEqual([id, dupId].sort());
		expect(stub._store[sessionKey(dupId, "saving")]).toBeUndefined();
		expect(stub._store[archiveKey(id, "saving")]).toBeUndefined();
		await expect(archiveSession(id)).rejects.toThrow(/incomplete/);
	});

	it("isSessionComplete is false exactly when archiveSession would refuse the session", () => {
		const id = mintAndActivateNewSession();
		expect(isSessionComplete(id)).toBe(false);
		saveActiveSession(makeFreshGame());
		expect(isSessionComplete(id)).toBe(true);
		stub._store[sessionKey(id, "saving")] = "x";
		expect(isSessionComplete(id)).toBe(false);
	});

	it("preserves createdAt from the existing meta.json on re-save", () => {
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
});

describe("loadActiveSession", () => {
	it("returns 'none' when pointer absent", () => {
		expect(loadActiveSession().kind).toBe("none");
	});

	it("returns 'broken' when engine.dat is missing", () => {
		const id = saveFreshSession();
		stub.removeItem(sessionKey(id, "engine.dat"));
		expect(loadActiveSession().kind).toBe("broken");
	});

	it("returns 'broken' when engine.dat fails deobfuscation", () => {
		const id = saveFreshSession();
		stub._store[sessionKey(id, "engine.dat")] = "not-valid-base64$$$";
		expect(loadActiveSession().kind).toBe("broken");
	});

	it("returns 'version-mismatch' when sealed schemaVersion is stale", () => {
		const id = saveFreshSession();
		stampSchemaVersion(sessionKey(id, "engine.dat"), 999);

		const result = loadActiveSession();
		expect(result.kind).toBe("version-mismatch");
		if (result.kind === "version-mismatch") {
			expect(result.schemaVersion).toBe(999);
		}
	});

	it("save → load round-trip returns ok with correct state", () => {
		saveFreshSession();
		const result = loadActiveSession();
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.isComplete).toBe(false);
			expect(result.state.round).toBe(0);
		}
	});
});

describe("clearActiveSession", () => {
	it("removes pointer + all session files", () => {
		saveFreshSession();

		clearActiveSession();

		expect(stub._store[ACTIVE_KEY]).toBeUndefined();
		expect(keysUnder(SESSIONS_PREFIX)).toHaveLength(0);
	});

	it("is a no-op (no throw) when no active session", () => {
		expect(() => clearActiveSession()).not.toThrow();
	});
});

describe("hasLegacySave / deleteLegacySaveKey", () => {
	it("hasLegacySave returns false when legacy key absent", () => {
		expect(hasLegacySave()).toBe(false);
	});

	it("hasLegacySave returns true when legacy key present", () => {
		installLocalStorageStub({ [LEGACY_KEY]: '{"old":"save"}' });
		expect(hasLegacySave()).toBe(true);
	});

	it("deleteLegacySaveKey removes the legacy key", () => {
		const seeded = installLocalStorageStub({ [LEGACY_KEY]: '{"old":"save"}' });
		deleteLegacySaveKey();
		expect(seeded._store[LEGACY_KEY]).toBeUndefined();
	});

	it("deleteLegacySaveKey is a no-op when legacy key absent", () => {
		expect(() => deleteLegacySaveKey()).not.toThrow();
	});
});

describe("saveActiveSession expectedLastSavedAt", () => {
	beforeEach(() => {
		vi.useFakeTimers();
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
		const metaBefore = localStorage.getItem(sessionKey(id, "meta.json"));
		vi.setSystemTime(new Date("2025-01-01T00:00:09.000Z"));

		const result = saveActiveSession(makeFreshGame(), {
			expectedLastSavedAt: loadedWith.lastSavedAt,
		});

		expect(result).toEqual({ ok: false, reason: "stale" });
		expect(localStorage.getItem(sessionKey(id, "meta.json"))).toBe(metaBefore);
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
		vi.useFakeTimers();
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
		localStorage.setItem(sessionKey(id, "meta.json"), "{not json");

		expect(sessionChangedSince(id, saved.lastSavedAt)).toBe(false);
	});
});

describe("listSessions", () => {
	it("returns empty array when no sessions exist", () => {
		expect(listSessions()).toEqual([]);
	});

	it("returns each minted-then-saved session id once, however many files it has", () => {
		const id1 = saveFreshSession();
		const id2 = saveFreshSession();
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
		expect(listSessions()).toEqual([]);
	});
});

describe("loadSession", () => {
	it("returns 'none' for an id with no data", () => {
		expect(loadSession("0x9999").kind).toBe("none");
	});

	it("returns 'ok' for a saved session", () => {
		const id = saveFreshSession();
		expect(loadSession(id).kind).toBe("ok");
	});

	it("returns 'broken' when engine.dat is missing", () => {
		const id = saveFreshSession();
		delete stub._store[sessionKey(id, "engine.dat")];
		expect(loadSession(id).kind).toBe("broken");
	});

	it("returns 'version-mismatch' when schemaVersion is stale", () => {
		const id = saveFreshSession();
		stampSchemaVersion(sessionKey(id, "engine.dat"), 999);
		expect(loadSession(id).kind).toBe("version-mismatch");
	});

	it("does NOT touch the active pointer", () => {
		const activeId = saveFreshSession();
		loadSession("0x1234");
		expect(getActiveSessionId()).toBe(activeId);
	});
});

describe("dupSession", () => {
	it("produces a new id distinct from the source", () => {
		const srcId = saveFreshSession();
		const newId = dupSession(srcId);
		expect(newId).not.toBe(srcId);
		expect(newId).toMatch(SESSION_ID_PATTERN);
	});

	it("new session keys are deep-independent: mutating new engine.dat does not affect original", () => {
		const srcId = saveFreshSession();
		const newId = dupSession(srcId);

		stub._store[sessionKey(newId, "engine.dat")] = "corrupted";

		expect(loadSession(srcId).kind).toBe("ok");
		expect(loadSession(newId).kind).toBe("broken");
	});

	it("engine.dat is written LAST (commit signal)", () => {
		const srcId = saveFreshSession();

		stub.setItem.mockClear();
		const newId = dupSession(srcId);

		const newCalls = setItemKeys().filter((k) =>
			k.startsWith(sessionKey(newId, "")),
		);
		expect(newCalls[newCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("active pointer is unchanged after dup", () => {
		const srcId = saveFreshSession();
		dupSession(srcId);
		expect(getActiveSessionId()).toBe(srcId);
	});

	it("throws on broken source session", () => {
		const srcId = saveFreshSession();
		delete stub._store[sessionKey(srcId, "engine.dat")];
		expect(() => dupSession(srcId)).toThrow();
	});

	it("throws on version-mismatch source session", () => {
		const srcId = saveFreshSession();
		stampSchemaVersion(sessionKey(srcId, "engine.dat"), 999);
		expect(() => dupSession(srcId)).toThrow();
	});
});

describe("rmSession", () => {
	it("removes only the named id's keys", () => {
		const id1 = saveFreshSession();
		const id2 = saveFreshSession();

		rmSession(id1);

		expect(keysUnder(sessionKey(id1, ""))).toHaveLength(0);
		expect(keysUnder(sessionKey(id2, "")).length).toBeGreaterThan(0);
	});

	it("clears active pointer when removing the active session", () => {
		const id = saveFreshSession();
		expect(getActiveSessionId()).toBe(id);

		rmSession(id);

		expect(getActiveSessionId()).toBeNull();
	});

	it("does NOT clear active pointer when removing a non-active session", () => {
		const id1 = saveFreshSession();
		const id2 = saveFreshSession();
		expect(getActiveSessionId()).toBe(id2);

		rmSession(id1);

		expect(getActiveSessionId()).toBe(id2);
	});
});

describe("getSessionInfo", () => {
	it("returns kind=ok for a valid session", () => {
		const id = saveFreshSession();
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
		const id = saveFreshSession();
		delete stub._store[sessionKey(id, "engine.dat")];
		expect(getSessionInfo(id).kind).toBe("broken");
	});

	it("returns kind=version-mismatch when schemaVersion is stale", () => {
		const id = saveFreshSession();
		stampSchemaVersion(sessionKey(id, "engine.dat"), 999);
		const info = getSessionInfo(id);
		expect(info.kind).toBe("version-mismatch");
		if (info.kind === "version-mismatch") {
			expect(info.schemaVersion).toBe(999);
			expect(Array.isArray(info.daemonFiles)).toBe(true);
		}
	});
});

describe("archiveSession", () => {
	it("copies meta, daemon .txt files, and engine.dat to archive namespace, leaving the source loadable and active", async () => {
		const id = saveFreshSession();

		const result = archiveSession(id);
		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toBeUndefined();

		expect(stub._store[archiveKey(id, "meta.json")]).toBeDefined();
		expect(stub._store[archiveKey(id, "engine.dat")]).toBeDefined();
		const daemonKeys = keysUnder(archiveKey(id, "")).filter((k) =>
			k.endsWith(".txt"),
		);
		expect(daemonKeys.length).toBeGreaterThan(0);
		expect(loadSession(id).kind).toBe("ok");
		expect(getActiveSessionId()).toBe(id);
	});

	it("replaces an existing archive under the same id instead of merging", async () => {
		const id = saveFreshSession();
		stub._store[archiveKey(id, "stale.txt")] = JSON.stringify({
			aiId: "stale",
			persona: TEST_PERSONAS.red,
			conversationLog: [],
		});

		await archiveSession(id);

		expect(stub._store[archiveKey(id, "stale.txt")]).toBeUndefined();
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
		const id = saveFreshSession();

		stub.setItem.mockClear();
		await archiveSession(id);

		const archiveCalls = setItemKeys().filter((k) =>
			k.startsWith(archiveKey(id, "")),
		);
		expect(archiveCalls[archiveCalls.length - 1]).toMatch(/engine\.dat$/);
	});

	it("archived meta has readonly: true and lastPlayedAt === source meta lastSavedAt", async () => {
		const id = mintAndActivateNewSession();
		saveActiveSession(makeFreshGame(), {
			createdAt: "2024-01-01T00:00:00.000Z",
		});
		const srcLastSavedAt = readMeta(sessionKey(id, "meta.json")).lastSavedAt;

		await archiveSession(id);

		const archivedMeta = readMeta(archiveKey(id, "meta.json"));
		expect(archivedMeta.readonly).toBe(true);
		expect(archivedMeta.lastPlayedAt).toBe(srcLastSavedAt);
	});

	it("archived meta retains epoch from source", async () => {
		const id = saveFreshSession();
		patchSessionMeta(id, { epoch: 7 });

		await archiveSession(id);

		expect(readMeta(archiveKey(id, "meta.json")).epoch).toBe(7);
	});

	it.each([
		"meta.json",
		"engine.dat",
	])("throws when source %s is missing", async (file) => {
		const id = saveFreshSession();
		delete stub._store[sessionKey(id, file)];

		await expect(archiveSession(id)).rejects.toThrow();
	});
});

describe("listArchivedSessions", () => {
	it("returns empty when none", () => {
		expect(listArchivedSessions()).toEqual([]);
	});

	it("returns archived session ids after archiveSession", async () => {
		const id = await archiveFreshSession();
		expect(listArchivedSessions()).toContain(id);
	});

	it("does not return sessions/ namespace ids", () => {
		const id = saveFreshSession();
		expect(listArchivedSessions()).not.toContain(id);
	});
});

describe("loadArchivedSession", () => {
	it("returns ok for a valid archived session", async () => {
		const id = await archiveFreshSession();
		expect(loadArchivedSession(id).kind).toBe("ok");
	});

	it("returns broken when archived engine.dat is missing", async () => {
		const id = await archiveFreshSession();
		delete stub._store[archiveKey(id, "engine.dat")];
		expect(loadArchivedSession(id).kind).toBe("broken");
	});

	it("returns version-mismatch when schemaVersion is stale", async () => {
		const id = await archiveFreshSession();
		stampSchemaVersion(archiveKey(id, "engine.dat"), 999);
		expect(loadArchivedSession(id).kind).toBe("version-mismatch");
	});
});

describe("getArchivedSessionInfo", () => {
	it("returns kind=archived with epoch, lastPlayedAt, round for valid archived session", async () => {
		const id = await archiveFreshSession();

		const info = getArchivedSessionInfo(id);
		expect(info.kind).toBe("archived");
		if (info.kind === "archived") {
			expect(typeof info.epoch).toBe("number");
			expect(typeof info.lastPlayedAt).toBe("string");
			expect(typeof info.round).toBe("number");
		}
	});

	it("returns kind=broken when archived engine.dat is missing", async () => {
		const id = await archiveFreshSession();
		delete stub._store[archiveKey(id, "engine.dat")];
		expect(getArchivedSessionInfo(id).kind).toBe("broken");
	});

	it("returns kind=version-mismatch when schemaVersion is stale", async () => {
		const id = await archiveFreshSession();
		stampSchemaVersion(archiveKey(id, "engine.dat"), 999);

		const info = getArchivedSessionInfo(id);
		expect(info.kind).toBe("version-mismatch");
		if (info.kind === "version-mismatch") {
			expect(info.schemaVersion).toBe(999);
		}
	});
});

describe("rmArchivedSession", () => {
	it("removes only that archive id's keys, not sessions/ keys or the active pointer", async () => {
		const id = await archiveFreshSession();

		rmArchivedSession(id);

		expect(keysUnder(archiveKey(id, ""))).toHaveLength(0);
		expect(keysUnder(sessionKey(id, "")).length).toBeGreaterThan(0);
		expect(getActiveSessionId()).toBe(id);
	});
});

describe("epoch in active sessions", () => {
	it("re-save preserves the epoch (seed meta with epoch=7, re-save, epoch stays 7)", () => {
		const id = saveFreshSession();
		patchSessionMeta(id, { epoch: 7 });

		saveActiveSession(makeFreshGame());

		expect(readMeta(sessionKey(id, "meta.json")).epoch).toBe(7);
	});

	it("a new save writes epoch 1 and advanceEpoch saves the session under the next epoch", () => {
		const id = saveFreshSession();
		expect(readMeta(sessionKey(id, "meta.json")).epoch).toBe(1);

		saveActiveSession(makeFreshGame(), { advanceEpoch: true });

		expect(readMeta(sessionKey(id, "meta.json")).epoch).toBe(2);
	});
});

const ARCHIVE_ID = "0xARCH";

function seedArchivedSession(epochOverride = 1): void {
	const now = "2024-01-01T00:00:00.000Z";
	const files = serializeSession(makeFreshGame(), now, now, epochOverride);
	const meta = JSON.parse(files.meta) as Record<string, unknown>;
	meta.readonly = true;
	meta.lastPlayedAt = now;
	stub._store[archiveKey(ARCHIVE_ID, "meta.json")] = JSON.stringify(
		meta,
		null,
		2,
	);
	for (const [aiId, daemonJson] of Object.entries(files.daemons)) {
		stub._store[archiveKey(ARCHIVE_ID, `${aiId}.txt`)] = daemonJson;
	}
	// biome-ignore lint/style/noNonNullAssertion: serializeSession always returns a non-null engine string
	stub._store[archiveKey(ARCHIVE_ID, "engine.dat")] = files.engine!;
}

describe("seedFromArchive", () => {
	it("mints a new session id that matches /^0x[0-9A-F]{4}$/ and differs from archiveId", () => {
		seedArchivedSession();
		const newId = seedFromArchive(ARCHIVE_ID, makeFreshGame());
		expect(newId).toMatch(SESSION_ID_PATTERN);
		expect(newId).not.toBe(ARCHIVE_ID);
	});

	it("new session has epoch = archive.epoch + 1", () => {
		seedArchivedSession(3);
		const newId = seedFromArchive(ARCHIVE_ID, makeFreshGame());
		expect(stub._store[sessionKey(newId, "meta.json")]).toBeDefined();
		expect(readMeta(sessionKey(newId, "meta.json")).epoch).toBe(4);
	});

	it("copies all archived daemon conversation logs into the new session", () => {
		seedArchivedSession();

		const redKey = archiveKey(ARCHIVE_ID, "red.txt");
		const redRaw = stub._store[redKey];
		if (!redRaw) throw new Error("red.txt should exist in archive");
		const redFile = JSON.parse(redRaw) as { conversationLog: unknown[] };
		redFile.conversationLog.push({
			kind: "message",
			round: 0,
			from: "blue",
			to: "red",
			content: "Hello from archive",
		});
		stub._store[redKey] = JSON.stringify(redFile);

		const newId = seedFromArchive(ARCHIVE_ID, makeFreshGame());

		const newRedRaw = stub._store[sessionKey(newId, "red.txt")];
		expect(newRedRaw).toBeDefined();
		const newRedFile = JSON.parse(newRedRaw ?? "{}") as {
			conversationLog: Array<{ content?: string }>;
		};
		expect(
			newRedFile.conversationLog.some(
				(e) => e.content === "Hello from archive",
			),
		).toBe(true);
	});

	it("appends broadcast entry to every daemon log", () => {
		seedArchivedSession();
		const newId = seedFromArchive(ARCHIVE_ID, makeFreshGame());

		const daemonKeys = keysUnder(sessionKey(newId, "")).filter((k) =>
			k.endsWith(".txt"),
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

	it("does not touch the archived session or the active session pointer", () => {
		stub._store[ACTIVE_KEY] = "0xZZZZ";
		seedArchivedSession();

		const before: Record<string, string> = {};
		for (const k of keysUnder(archiveKey(ARCHIVE_ID, ""))) {
			before[k] = stub._store[k] as string;
		}
		expect(Object.keys(before).length).toBeGreaterThan(0);

		seedFromArchive(ARCHIVE_ID, makeFreshGame());

		for (const [k, v] of Object.entries(before)) {
			expect(stub._store[k]).toBe(v);
		}
		expect(stub._store[ACTIVE_KEY]).toBe("0xZZZZ");
	});

	it("writes engine.dat as the last file in the new session namespace", () => {
		seedArchivedSession();

		stub.setItem.mockClear();
		const newId = seedFromArchive(ARCHIVE_ID, makeFreshGame());

		const newCalls = setItemKeys().filter((k) =>
			k.startsWith(sessionKey(newId, "")),
		);
		expect(newCalls[newCalls.length - 1]).toMatch(/engine\.dat$/);
	});
});

describe("v12 boundary (archive-only)", () => {
	function seedSessionAtSchema(schemaVersion: number): {
		sessionId: string;
		bytes: Record<string, string>;
	} {
		const sessionId = saveFreshSession();
		stampSchemaVersion(sessionKey(sessionId, "engine.dat"), schemaVersion);

		const bytes: Record<string, string> = {};
		for (const key of keysUnder(sessionKey(sessionId, ""))) {
			bytes[key] = stub._store[key] as string;
		}
		return { sessionId, bytes };
	}

	it("writes new saves at schema 12", () => {
		const sessionId = saveFreshSession();

		const engineBlob = stub._store[sessionKey(sessionId, "engine.dat")];
		if (!engineBlob) throw new Error("engine.dat should exist after save");
		const sealed = JSON.parse(deobfuscate(engineBlob));
		expect(sealed.schemaVersion).toBe(12);
		expect(loadActiveSession().kind).toBe("ok");
	});

	it("surfaces a session stamped 11 as a version-mismatch carrying the archived build", () => {
		const { sessionId } = seedSessionAtSchema(11);

		const info = getSessionInfo(sessionId);
		expect(info.kind).toBe("version-mismatch");
		if (info.kind === "version-mismatch") {
			expect(info.schemaVersion).toBe(11);
			expect(lookupArchiveVersion(info.schemaVersion)).toBe("0.0.2-beta.2");
		}
		expect(loadSession(sessionId).kind).toBe("version-mismatch");
	});

	it("preserves the original bytes when a stale session hits the mismatch route", () => {
		const { sessionId, bytes } = seedSessionAtSchema(11);
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
		const { sessionId, bytes } = seedSessionAtSchema(4);

		expect(loadSession(sessionId).kind).toBe("version-mismatch");
		for (const [key, value] of Object.entries(bytes)) {
			expect(stub._store[key], key).toBe(value);
		}
	});
});
