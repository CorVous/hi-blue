import { describe, expect, it } from "vitest";
import { GAME_SAVE_VERSION } from "../../../save-serializer.js";
import {
	GAME_SAVE_ARCHIVE_MAP,
	lookupArchiveVersion,
	lookupGameSaveArchiveVersion,
	SCHEMA_ARCHIVE_MAP,
} from "../archive-map.js";
import { SESSION_SCHEMA_VERSION } from "../session-codec.js";
import {
	checkVersionCompatibility,
	liveVersionBoundary,
	type VersionBoundary,
} from "../version-boundary.js";

const V12_V5: VersionBoundary = { session: 12, gs: 5 };

describe("live boundary constants (#539)", () => {
	it("is schema 12 on the session axis", () => {
		expect(SESSION_SCHEMA_VERSION).toBe(12);
	});

	it("is game-save 5 on the USB axis", () => {
		expect(GAME_SAVE_VERSION).toBe(5);
	});

	it("activates both axes together", () => {
		expect(liveVersionBoundary()).toEqual({ session: 12, gs: 5 });
	});
});

describe("liveVersionBoundary", () => {
	it("is sourced from the live version constants", () => {
		expect(liveVersionBoundary()).toEqual({
			session: SESSION_SCHEMA_VERSION,
			gs: GAME_SAVE_VERSION,
		});
	});

	it("treats the live format versions as current", () => {
		expect(
			checkVersionCompatibility("session", SESSION_SCHEMA_VERSION).kind,
		).toBe("current");
		expect(checkVersionCompatibility("gs", GAME_SAVE_VERSION).kind).toBe(
			"current",
		);
	});
});

describe("checkVersionCompatibility (live boundary)", () => {
	it("treats a current session schema as 'current'", () => {
		expect(
			checkVersionCompatibility("session", SESSION_SCHEMA_VERSION),
		).toEqual({
			kind: "current",
		});
	});

	it("treats a current game-save version as 'current'", () => {
		expect(checkVersionCompatibility("gs", GAME_SAVE_VERSION)).toEqual({
			kind: "current",
		});
	});

	it("surfaces a session stamped 11 as a mismatch carrying the archived build", () => {
		expect(checkVersionCompatibility("session", 11)).toEqual({
			kind: "mismatch",
			archivedBuild: "0.0.2-beta.2",
		});
	});

	it("surfaces a USB save stamped 4 as a mismatch carrying the archived build", () => {
		expect(checkVersionCompatibility("gs", 4)).toEqual({
			kind: "mismatch",
			archivedBuild: "0.0.2-beta.2",
		});
	});

	it("surfaces unknown versions as mismatches with no known provenance", () => {
		expect(checkVersionCompatibility("session", 100)).toEqual({
			kind: "mismatch",
			archivedBuild: null,
		});
		expect(checkVersionCompatibility("gs", 99)).toEqual({
			kind: "mismatch",
			archivedBuild: null,
		});
	});

	it("treats a missing/non-numeric version as a mismatch with no provenance", () => {
		expect(checkVersionCompatibility("session", undefined)).toEqual({
			kind: "mismatch",
			archivedBuild: null,
		});
		expect(checkVersionCompatibility("gs", Number.NaN)).toEqual({
			kind: "mismatch",
			archivedBuild: null,
		});
	});
});

describe("checkVersionCompatibility (explicit v12/v5 boundary)", () => {
	it("at (12, 5): a v11 session is a mismatch linking to 0.0.2-beta.2", () => {
		expect(checkVersionCompatibility("session", 11, V12_V5)).toEqual({
			kind: "mismatch",
			archivedBuild: "0.0.2-beta.2",
		});
	});

	it("at (12, 5): a v12 session is current", () => {
		expect(checkVersionCompatibility("session", 12, V12_V5)).toEqual({
			kind: "current",
		});
	});

	it("at (12, 5): a v4 game save is a mismatch linking to 0.0.2-beta.2", () => {
		expect(checkVersionCompatibility("gs", 4, V12_V5)).toEqual({
			kind: "mismatch",
			archivedBuild: "0.0.2-beta.2",
		});
	});

	it("at (12, 5): a v5 game save is current", () => {
		expect(checkVersionCompatibility("gs", 5, V12_V5)).toEqual({
			kind: "current",
		});
	});
});

describe("provenance maps", () => {
	it("maps the retired session schema 11 to the archived build that shipped it", () => {
		expect(lookupArchiveVersion(11)).toBe("0.0.2-beta.2");
		expect(SCHEMA_ARCHIVE_MAP[11]).toBe("0.0.2-beta.2");
	});

	it("maps the retired game-save format 4 to the archived build that shipped it", () => {
		expect(lookupGameSaveArchiveVersion(4)).toBe("0.0.2-beta.2");
		expect(GAME_SAVE_ARCHIVE_MAP[4]).toBe("0.0.2-beta.2");
	});

	it("does not map the live versions as archived", () => {
		expect(lookupArchiveVersion(SESSION_SCHEMA_VERSION)).toBeNull();
		expect(lookupGameSaveArchiveVersion(GAME_SAVE_VERSION)).toBeNull();
	});

	it("returns null for versions with no known archived build", () => {
		expect(lookupArchiveVersion(1000)).toBeNull();
		expect(lookupArchiveVersion(undefined)).toBeNull();
		expect(lookupArchiveVersion(Number.NaN)).toBeNull();
		expect(lookupGameSaveArchiveVersion(1000)).toBeNull();
	});
});
