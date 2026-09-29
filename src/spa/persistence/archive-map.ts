export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {
	11: "0.0.2-beta.2",
};

export const GAME_SAVE_ARCHIVE_MAP: Record<number, string> = {
	4: "0.0.2-beta.2",
};

function lookupArchivedBuild(
	map: Record<number, string>,
	version: number | undefined,
): string | null {
	if (typeof version !== "number" || !Number.isFinite(version)) return null;
	return map[version] ?? null;
}

export function lookupArchiveVersion(
	schemaVersion: number | undefined,
): string | null {
	return lookupArchivedBuild(SCHEMA_ARCHIVE_MAP, schemaVersion);
}

export function lookupGameSaveArchiveVersion(
	gsVersion: number | undefined,
): string | null {
	return lookupArchivedBuild(GAME_SAVE_ARCHIVE_MAP, gsVersion);
}
