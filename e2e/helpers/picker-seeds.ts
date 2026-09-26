import { obfuscateEngineBlob } from "./engine-blob.js";

const LIVE_SESSION_SCHEMA_VERSION = 12;

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
		schemaVersion: LIVE_SESSION_SCHEMA_VERSION,
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
