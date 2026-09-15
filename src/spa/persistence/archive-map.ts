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
 * AGENTS.md → "Bumping save-format versions".
 */

/**
 * Session-schema provenance for the live boundary (`SESSION_SCHEMA_VERSION`
 * is 12). `SCHEMA_ARCHIVE_MAP` keys the retired schema number `11` — the last
 * schema the released build `0.0.2-beta.2` shipped — to that build, so a save
 * sealed at 11 surfaces as a version-mismatch that links to
 * `/v/0.0.2-beta.2/` rather than being rewritten.
 *
 * `0.0.2-beta.2` is the latest released build that shipped schema 11:
 *   - `git describe --tags --abbrev=0 --match 'v*' HEAD~1` → `v0.0.2-beta.2`
 *     (the newest `v*` tag).
 *   - The *tagged tree* reads `SESSION_SCHEMA_VERSION = 11`, and the commit
 *     that introduced 11 is an ancestor of the tag. The tagged commit's own
 *     `package.json` still says `0.0.2-beta.1` — the release bump is a later
 *     child commit — so the tag name, not `package.json`, names the release.
 *   - `origin/gh-pages` publishes `/v/0.0.2-beta.2/`, the archive the
 *     version-mismatch surface links to.
 */
export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {
	11: "0.0.2-beta.2",
};

/**
 * Game-save ("gs") provenance for the live boundary (`GAME_SAVE_VERSION` is
 * 5). `GAME_SAVE_ARCHIVE_MAP` keys the retired game-save number `4` to the
 * released build `0.0.2-beta.2`, which shipped it, so a save stamped `4`
 * identifies that build as the one that still reads it.
 *
 * Same evidence as the session axis above: the `v0.0.2-beta.2` tagged tree is
 * the latest release and writes `version: 4` in `src/save-serializer.ts`,
 * while its `package.json` lags one release behind at `0.0.2-beta.1` because
 * the version bump lands in a child commit.
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

/** Look up the archived version string for an old game-save (`gs`) version. */
export function lookupGameSaveArchiveVersion(
	gsVersion: number | undefined,
): string | null {
	if (typeof gsVersion !== "number" || !Number.isFinite(gsVersion)) {
		return null;
	}
	return GAME_SAVE_ARCHIVE_MAP[gsVersion] ?? null;
}
