/**
 * version-boundary.ts
 *
 * A "version boundary" is the pair of save-format versions a build considers
 * "current" (natively readable) — one per axis: the session schema
 * (`SESSION_SCHEMA_VERSION`, the multi-file localStorage format) and the
 * "Save the AIs to USB" game-save format (`GameSave.version`, "gs").
 *
 * A save stamped at a *different* version on either axis is "older". Older
 * saves are not discarded: they surface as a version-mismatch that links the
 * user to the archived build that still reads them (the provenance maps in
 * `archive-map.ts`).
 *
 * The boundary is a plain, pure value — the point being that it is
 * *testable*. Production calls the helpers with `liveVersionBoundary()`;
 * tests construct a boundary at some other cutoff (e.g. `{ session: 12, gs: 5 }`)
 * to reason about the v12/v5 contract without touching the live constants.
 */

import { GAME_SAVE_VERSION } from "../../save-serializer.js";
import {
	lookupArchiveVersion,
	lookupGameSaveArchiveVersion,
} from "./archive-map.js";
import { SESSION_SCHEMA_VERSION } from "./session-codec.js";

/** The two save-format version axes a boundary spans. */
export type VersionAxis = "session" | "gs";

/** The save-format version(s) a build treats as "current". */
export interface VersionBoundary {
	/** `SESSION_SCHEMA_VERSION` for this build. */
	session: number;
	/** `GameSave.version` for this build. */
	gs: number;
}

/**
 * The boundary the live build uses, sourced from the real version constants.
 * Exposed as a function (not a top-level `const`) so the constants are read
 * at call-time, which keeps the `session-codec` ↔ `version-boundary` import
 * edge free of a temporal-dead-zone surprise.
 */
export function liveVersionBoundary(): VersionBoundary {
	return { session: SESSION_SCHEMA_VERSION, gs: GAME_SAVE_VERSION };
}

/** The compatibility decision for a single save-format version. */
export type CompatibilityVerdict =
	| { kind: "current" }
	| { kind: "mismatch"; archivedBuild: string | null };

/**
 * Compatibility helper: given a save's version on a given axis and the
 * version boundary, decide whether the save is "current" or a mismatch.
 *
 * A mismatch carries the *archived build* that still reads the save (its
 * provenance), or `null` when no archived build is known for that version —
 * in which case the caller should fall back to a generic "older version"
 * message rather than implying a specific build.
 */
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
