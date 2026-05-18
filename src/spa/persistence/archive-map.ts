/**
 * Maps an old SESSION_SCHEMA_VERSION to the version string (no `v` prefix)
 * of the latest released hi-blue build that shipped that schema. Used by
 * the version-mismatch banner to link users to an archived /v/<version>/
 * build that can still read their save.
 *
 * When you bump SESSION_SCHEMA_VERSION, see AGENTS.md.
 */
export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {
	// 9: "0.1.1",  // example: schema 9 last shipped in v0.1.1
};

/** Look up the archived version string for an old schema number. */
export function lookupArchiveVersion(
	schemaVersion: number | undefined,
): string | null {
	if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
		return null;
	}
	return SCHEMA_ARCHIVE_MAP[schemaVersion] ?? null;
}
