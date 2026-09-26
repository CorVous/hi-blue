import type { LoadResult } from "./session-storage.js";

export type DispatcherReason =
	| "populated"
	| "empty"
	| "broken"
	| "version-mismatch"
	| "no-active-pointer";

export interface DispatcherVerdict {
	route: "#/start" | "#/game" | "#/sessions";
	reason: DispatcherReason;
	needsMint: boolean;
	schemaVersion?: number;
}

export interface DispatcherSnapshot {
	activeSessionId: string | null;
	loadResult: LoadResult;
}

export function dispatchActiveSession(
	snapshot: DispatcherSnapshot,
): DispatcherVerdict {
	const { activeSessionId, loadResult } = snapshot;

	if (activeSessionId === null) {
		return { route: "#/start", reason: "no-active-pointer", needsMint: true };
	}

	switch (loadResult.kind) {
		case "ok":
			return { route: "#/game", reason: "populated", needsMint: false };

		case "none":
			return { route: "#/start", reason: "empty", needsMint: false };

		case "broken":
			return { route: "#/sessions", reason: "broken", needsMint: false };

		case "version-mismatch":
			return {
				route: "#/sessions",
				reason: "version-mismatch",
				needsMint: false,
				schemaVersion: loadResult.schemaVersion,
			};
	}
}
