import { GAME_SAVE_VERSION } from "../../save-serializer.js";
import {
	lookupArchiveVersion,
	lookupGameSaveArchiveVersion,
} from "./archive-map.js";
import { SESSION_SCHEMA_VERSION } from "./version-constants.js";

export type VersionAxis = "session" | "gs";

export interface VersionBoundary {
	session: number;
	gs: number;
}

export function liveVersionBoundary(): VersionBoundary {
	return { session: SESSION_SCHEMA_VERSION, gs: GAME_SAVE_VERSION };
}

export type CompatibilityVerdict =
	| { kind: "current" }
	| { kind: "mismatch"; archivedBuild: string | null };

export function checkVersionCompatibility(
	axis: VersionAxis,
	saveVersion: number | undefined,
	boundary: VersionBoundary = liveVersionBoundary(),
): CompatibilityVerdict {
	const archivedBuild =
		axis === "session"
			? lookupArchiveVersion(saveVersion)
			: lookupGameSaveArchiveVersion(saveVersion);
	if (
		typeof saveVersion === "number" &&
		Number.isFinite(saveVersion) &&
		saveVersion === boundary[axis]
	) {
		return { kind: "current" };
	}
	return { kind: "mismatch", archivedBuild };
}
