/**
 * Save-file serializer for the endgame "Save the AIs to USB" feature (issue #19).
 *
 * Takes a completed (or in-progress) GameState and produces a deterministic,
 * JSON-serializable payload containing:
 * - Each AI's persona
 * - Each AI's per-phase transcript (unified conversationLog including chat,
 *   whispers, and witnessed events, grouped by phase)
 * - All three ContentPacks (setting, entities, placements)
 *
 * The format is versioned (v3) so future schema changes can be detected.
 * v2 → v3: whispers moved inline into conversationLog (per-Daemon logs).
 */

import type {
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
} from "./spa/game/types";

export interface PhaseTranscript {
	phaseNumber: 1 | 2 | 3;
	conversationLog: ConversationEntry[];
}

export interface AiSaveEntry {
	persona: AiPersona;
	phases: PhaseTranscript[];
}

export interface GameSave {
	/** Schema version. v3 = whispers moved inline into conversationLog. */
	version: 3;
	ais: AiSaveEntry[];
	/** All three content packs (generated at game start). */
	contentPacks: ContentPack[];
}

/**
 * Serialize a GameState into a save-file payload.
 *
 * Works on both complete and in-progress states so it can be called at
 * any point, though the intent is to call it at game completion.
 */
export function serializeGameSave(game: GameState): GameSave {
	const ais: AiSaveEntry[] = Object.keys(game.personas).map((aiId) => {
		// biome-ignore lint/style/noNonNullAssertion: key comes from Object.keys so always defined
		const persona = game.personas[aiId]!;

		const phases: PhaseTranscript[] = game.phases.map((phase) => {
			const conversationLog = phase.conversationLogs[aiId] ?? [];
			return {
				phaseNumber: phase.phaseNumber,
				conversationLog: conversationLog.map((e) => ({ ...e })),
			};
		});

		return { persona: { ...persona }, phases };
	});

	return { version: 3, ais, contentPacks: game.contentPacks };
}
