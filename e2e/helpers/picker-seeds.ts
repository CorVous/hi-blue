/**
 * Session fixtures for the sessions-picker spec.
 *
 * The picker classifies a row by asking the live version boundary whether the
 * sealed save is current, so the "ok" seed must be sealed in the shape
 * `serializeSession` writes at the live session schema (session v12,
 * `SESSION_SCHEMA_VERSION` in `src/spa/persistence/version-constants.ts`).
 * Sealing an older payload and leaning on the historical migration chain does
 * NOT work: that chain stops at 11, and v11 → v12 is archive-only, so a
 * migrated save is reported as `version-mismatch` and the row loses its
 * `[ load ]` / `[ dup ]` / `[ rm ]` buttons.
 *
 * `src/spa/persistence/__tests__/picker-ok-seed.test.ts` binds this literal to
 * the live boundary: it asserts the stamp equals `SESSION_SCHEMA_VERSION` and
 * that `deserializeSession` / `getSessionInfo` classify these exact bytes as
 * `ok`. A schema bump that this fixture does not follow therefore fails the
 * unit suite rather than silently breaking the picker assertions in CI.
 */
import { obfuscateEngineBlob } from "./engine-blob.js";

/**
 * The sealed `engine.dat` payload for the picker's "ok" seed: the live
 * `SealedEngine` shape (session-codec.ts) at the live session schema.
 */
function okSealedEnginePayload(): Record<string, unknown> {
	const stubPack = {
		setting: "test setting",
		weather: "clear",
		timeOfDay: "morning",
		entities: [],
		wallName: "",
		aiStarts: {},
	};
	return {
		schemaVersion: 12,
		isComplete: false,
		world: { entities: [] },
		budgets: { red: { remaining: 50, total: 50 } },
		lockedOut: [],
		personaSpatial: { red: { position: { row: 2, col: 2 } } },
		contentPacksA: [stubPack],
		contentPacksB: [{ ...stubPack, setting: "test setting B" }],
		activePackId: "A",
		weather: "clear",
		objectives: [],
		complicationSchedule: { countdown: 5, settingShiftFired: false },
		activeComplications: [],
	};
}

/**
 * Every file of an "ok" session, keyed by file name: `meta.json`, one
 * `<aiId>.txt` per Daemon, and the sealed `engine.dat` (obfuscated here, so a
 * caller writes the values verbatim).
 */
export function pickerOkSessionFiles(
	lastSavedAt: string,
): Record<string, string> {
	return {
		"meta.json": JSON.stringify({
			createdAt: "2025-01-01T00:00:00.000Z",
			lastSavedAt,
			epoch: 1,
			round: 0,
			personaOrder: ["red"],
		}),
		"red.txt": JSON.stringify({
			aiId: "red",
			persona: {
				id: "red",
				name: "Red",
				color: "#ff0000",
				temperaments: ["bold", "calm"],
				personaGoal: "stub",
				blurb: "stub",
				typingQuirks: ["...", "!"],
				voiceExamples: ["Hello.", "Indeed.", "Farewell."],
			},
			conversationLog: [],
		}),
		"engine.dat": obfuscateEngineBlob(JSON.stringify(okSealedEnginePayload())),
	};
}

/**
 * The `addInitScript` source that writes the "ok" session into localStorage
 * under `hi-blue:sessions/<id>/`. Specs inject it with
 * `page.addInitScript(new Function(script))`, and the unit check runs this same
 * source against a localStorage, so what it proves is what the browser seeds.
 */
export function pickerOkSessionSeedScript(
	id: string,
	lastSavedAt: string,
): string {
	const files = pickerOkSessionFiles(lastSavedAt);
	return `
		(function() {
			const prefix = 'hi-blue:sessions/${id}/';
			const files = ${JSON.stringify(files)};
			for (const [name, content] of Object.entries(files)) {
				localStorage.setItem(prefix + name, content);
			}
		})();
	`;
}
