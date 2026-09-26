export const SCHEMA_ARCHIVE_MAP: Record<number, string> = {
	11: "0.0.2-beta.2",
};

export const GAME_SAVE_ARCHIVE_MAP: Record<number, string> = {
	4: "0.0.2-beta.2",
};

export function lookupArchiveVersion(
	schemaVersion: number | undefined,
): string | null {
	if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
		return null;
	}
	return SCHEMA_ARCHIVE_MAP[schemaVersion] ?? null;
}

export function lookupGameSaveArchiveVersion(
	gsVersion: number | undefined,
): string | null {
	if (typeof gsVersion !== "number" || !Number.isFinite(gsVersion)) {
		return null;
	}
	return GAME_SAVE_ARCHIVE_MAP[gsVersion] ?? null;
}
