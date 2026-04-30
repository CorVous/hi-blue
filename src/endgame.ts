/**
 * Endgame save serialization (issue #19).
 *
 * buildEndgameSave(game) produces a plain JSON-serializable object capturing
 * each AI's persona and accumulated chat transcripts across all three phases.
 *
 * Save file shape:
 * {
 *   version: 1,                     // format version for forward compatibility
 *   savedAt: "<ISO 8601 string>",   // timestamp of serialization
 *   ais: [
 *     {
 *       id: "red" | "green" | "blue",
 *       name: string,
 *       personality: string,
 *       goal: string,
 *       transcripts: {
 *         phase1: Array<{ role: "player" | "ai"; content: string }>,
 *         phase2: Array<{ role: "player" | "ai"; content: string }>,
 *         phase3: Array<{ role: "player" | "ai"; content: string }>,
 *       }
 *     },
 *     // … one entry per AI (red, green, blue)
 *   ]
 * }
 *
 * Notes:
 * - If fewer than three phases have been played (e.g. game ends early), the
 *   missing phase transcript arrays are empty.
 * - The save file contains only what the player experienced: chat messages.
 *   World state, whispers, and action log are intentionally omitted to keep
 *   the keepsake human-readable.
 */

import type { AiId, ChatMessage, GameState, PhaseState } from "./types";

const AI_IDS: AiId[] = ["red", "green", "blue"];

export interface AiSaveEntry {
	id: AiId;
	name: string;
	personality: string;
	goal: string;
	transcripts: {
		phase1: ChatMessage[];
		phase2: ChatMessage[];
		phase3: ChatMessage[];
	};
}

export interface EndgameSave {
	version: 1;
	savedAt: string;
	ais: AiSaveEntry[];
}

/**
 * Build the endgame save object from a completed (or near-complete) game state.
 *
 * Returns a plain JSON-serializable object. Call JSON.stringify() on the result
 * to get the download file contents.
 */
export function buildEndgameSave(game: GameState): EndgameSave {
	const phaseByNumber = new Map<number, PhaseState>();
	for (const phase of game.phases) {
		phaseByNumber.set(phase.phaseNumber, phase);
	}

	const getTranscript = (phaseNumber: 1 | 2 | 3, aiId: AiId): ChatMessage[] => {
		const phase = phaseByNumber.get(phaseNumber);
		if (!phase) return [];
		return [...(phase.chatHistories[aiId] ?? [])];
	};

	const ais: AiSaveEntry[] = AI_IDS.map((aiId) => {
		const persona = game.personas[aiId];
		return {
			id: aiId,
			name: persona.name,
			personality: persona.personality,
			goal: persona.goal,
			transcripts: {
				phase1: getTranscript(1, aiId),
				phase2: getTranscript(2, aiId),
				phase3: getTranscript(3, aiId),
			},
		};
	});

	return {
		version: 1,
		savedAt: new Date().toISOString(),
		ais,
	};
}
