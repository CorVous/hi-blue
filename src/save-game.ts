/**
 * Game-state serialization for the "USB save" feature.
 *
 * serializeGame() is a pure function — it accepts a `now` Date so it's
 * fully deterministic and trivially testable. Call sites pass `new Date()`.
 *
 * Save-file format (version 1):
 * {
 *   "version": 1,
 *   "ais": {
 *     "red":   { "persona": <AiPersona>, "transcript": [{ "phase": 1, "chat": [...], "whispers_received": [...] }, ...] },
 *     "green": { ... },
 *     "blue":  { ... }
 *   },
 *   "savedAt": "<ISO timestamp>"
 * }
 *
 * Design notes:
 * - The action log is a shared concern (not per-AI), so it is NOT included
 *   in the per-AI transcript entries. This keeps each AI's record focused
 *   on what that AI saw and said.
 * - whispers_received per phase contains only whispers where `to === aiId`.
 */

import type { AiId, GameState } from "./types";

interface PhaseTranscriptEntry {
	phase: 1 | 2 | 3;
	chat: { role: "player" | "ai"; content: string }[];
	whispers_received: { from: AiId; to: AiId; content: string; round: number }[];
}

interface AiSaveEntry {
	persona: GameState["personas"][AiId];
	transcript: PhaseTranscriptEntry[];
}

interface SaveFile {
	version: 1;
	ais: Record<AiId, AiSaveEntry>;
	savedAt: string;
}

/**
 * Serialize the full game state into a JSON string suitable for download.
 *
 * @param game  The current GameState (must have all three phases populated).
 * @param now   Timestamp to embed as `savedAt`. Pass `new Date()` at call sites.
 */
export function serializeGame(game: GameState, now: Date): string {
	const aiIds: AiId[] = ["red", "green", "blue"];

	const ais = {} as Record<AiId, AiSaveEntry>;

	for (const aiId of aiIds) {
		const transcript: PhaseTranscriptEntry[] = game.phases.map((phase) => ({
			phase: phase.phaseNumber,
			chat: phase.chatHistories[aiId] ?? [],
			whispers_received: phase.whispers.filter((w) => w.to === aiId),
		}));

		ais[aiId] = {
			persona: game.personas[aiId],
			transcript,
		};
	}

	const saveFile: SaveFile = {
		version: 1,
		ais,
		savedAt: now.toISOString(),
	};

	return JSON.stringify(saveFile, null, 2);
}
