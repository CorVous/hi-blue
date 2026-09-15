/**
 * Save-file serializer for the endgame "Save the AIs to USB" feature (issue #19).
 *
 * Takes a completed (or in-progress) GameState and produces a deterministic,
 * JSON-serializable payload containing:
 * - Each AI's persona
 * - Each AI's conversation transcript — the unified per-Daemon conversationLog
 *   (directional messages and witnessed events). Carried inside a vestigial
 *   single-element `phases` array: the three-phase model is retired but the
 *   save shape kept the wrapper.
 * - The Setting A and Setting B ContentPacks.
 *
 * The format is versioned (`GameSave.version`) so future schema changes can be
 * detected. v2 → v3: whispers moved inline into conversationLog. v3 → v4:
 * chat/whisper collapsed into the directional message primitive. v4 → v5
 * (issue #539): facing and horizon landmarks are retired from the persisted
 * spatial state, so a save stamped 4 is no longer readable here.
 *
 * The gs axis has no in-place migration: a save stamped with an older
 * `version` is identified as older and pointed at the archived build that
 * still reads it (see `GAME_SAVE_ARCHIVE_MAP` in
 * `src/spa/persistence/archive-map.ts`).
 */

import type {
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
} from "./spa/game/types";

/**
 * The game-save format version this build writes (`GameSave.version`).
 * Exposed as a named constant so the version-boundary compatibility helpers
 * (see `src/spa/persistence/version-boundary.ts`) can reason about "is this
 * save from the current build?" without hardcoding the number in two places.
 */
export const GAME_SAVE_VERSION = 5 as const;

interface PhaseTranscript {
	phaseNumber: 1 | 2 | 3;
	conversationLog: ConversationEntry[];
}

interface AiSaveEntry {
	persona: AiPersona;
	phases: PhaseTranscript[];
}

export interface GameSave {
	/** Schema version. v5 = facing and horizon landmarks retired from the payload. */
	version: typeof GAME_SAVE_VERSION;
	ais: AiSaveEntry[];
	/** Setting A content packs (generated at game start). */
	contentPacksA: ContentPack[];
	/** Setting B content packs (generated at game start). */
	contentPacksB: ContentPack[];
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

		const conversationLog = game.conversationLogs[aiId] ?? [];
		const phases: PhaseTranscript[] = [
			{
				phaseNumber: 1,
				conversationLog: conversationLog.map((e) => ({ ...e })),
			},
		];

		return { persona: { ...persona }, phases };
	});

	return {
		version: GAME_SAVE_VERSION,
		ais,
		contentPacksA: game.contentPacksA,
		contentPacksB: game.contentPacksB,
	};
}
