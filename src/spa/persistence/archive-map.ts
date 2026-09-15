/**
 * Provenance: which released hi-blue build last shipped a given save-format
 * version. Used by the version-mismatch surface (and the version-boundary
 * compatibility helpers) to link a user's older save to the archived
 * `/v/<version>/` build that still reads it, rather than implying the save is
 * discarded.
 *
 * Two axes are tracked:
 *   - `SCHEMA_ARCHIVE_MAP` — the session schema (`SESSION_SCHEMA_VERSION`),
 *     i.e. the multi-file localStorage session format.
 *   - `GAME_SAVE_ARCHIVE_MAP` — the "Save the AIs to USB" game-save format
 *     (`GameSave.version`, "gs").
 *
 * Both maps key the OLD format version (no `v` prefix) to the version string
 * of the latest released build that shipped it. See
 * AGENTS.md → "Bumping SESSION_SCHEMA_VERSION".
 */

/**
 * Session-schema provenance. `11` (the last pre-boundary-bump schema) shipped
 * in the current release, `0.0.2-beta.2`; once the live boundary moves past
 * 11, saves sealed at 11 surface as a version-mismatch that links here.
 */
export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {
	11: "0.0.2-beta.2",
};

/**
 * Game-save ("gs") provenance. `4` (the current game-save format) shipped in
 * `0.0.2-beta.2`; once the live boundary moves the gs axis past 4, saves
 * stamped `4` link to that archived build.
 */
export const GAME_SAVE_ARCHIVE_MAP: Record<number, string> = {
	4: "0.0.2-beta.2",
};

/** Look up the archived version string for an old session schema number. */
export function lookupArchiveVersion(
	schemaVersion: number | undefined,
): string | null {
	if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
		return null;
	}
	return SCHEMA_ARCHIVE_MAP[schemaVersion] ?? null;
}

/** Look up the archived version string for an old game-save ("gs") version. */
export function lookupGameSaveArchiveVersion(
	ksVersion: number | undefined,
): string | null {
	if (typeof ksVersion !== "number" || !Number.isFinite(ksVersion)) {
		return null;
	}
	return GAME_SAVE_ARCHIVE_MAP[ksVersion] ?? null;
}
