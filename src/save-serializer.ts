/**
 * Save-file serializer for the endgame "Save the AIs to USB" feature (issue #19).
 *
 * Takes a completed (or in-progress) GameState and produces a deterministic,
 * JSON-serializable payload containing:
 * - Each AI's persona
 * - Each AI's per-phase transcript (chat history + whispers that involve that AI,
 *   grouped by phase)
 *
 * The format is versioned (v1) so future schema changes can be detected.
 */

import type {
	AiId,
	AiPersona,
	ChatMessage,
	GameState,
	WhisperMessage,
} from "./spa/game/types";

export interface PhaseTranscript {
	phaseNumber: 1 | 2 | 3;
	chatHistory: ChatMessage[];
	/** Whispers where this AI is either sender or recipient. */
	whispers: WhisperMessage[];
}

export interface AiSaveEntry {
	persona: AiPersona;
	phases: PhaseTranscript[];
}

export interface GameSave {
	/** Schema version. v1 = this shape. */
	version: 1;
	ais: AiSaveEntry[];
}

const AI_ORDER: AiId[] = ["red", "green", "blue"];

/**
 * Serialize a GameState into a save-file payload.
 *
 * Works on both complete and in-progress states so it can be called at
 * any point, though the intent is to call it at game completion.
 */
export function serializeGameSave(game: GameState): GameSave {
	const ais: AiSaveEntry[] = AI_ORDER.map((aiId) => {
		const persona = game.personas[aiId];

		const phases: PhaseTranscript[] = game.phases.map((phase) => {
			const chatHistory = phase.chatHistories[aiId] ?? [];
			const whispers = phase.whispers.filter(
				(w) => w.from === aiId || w.to === aiId,
			);
			return {
				phaseNumber: phase.phaseNumber,
				chatHistory: chatHistory.map((m) => ({ ...m })),
				whispers: whispers.map((w) => ({ ...w })),
			};
		});

		return { persona: { ...persona }, phases };
	});

	return { version: 1, ais };
}
