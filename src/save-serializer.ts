import type {
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
} from "./spa/game/types";

export const GAME_SAVE_VERSION = 5 as const;

const VESTIGIAL_SINGLE_PHASE_NUMBER = 1;

interface PhaseTranscript {
	phaseNumber: 1 | 2 | 3;
	conversationLog: ConversationEntry[];
}

interface AiSaveEntry {
	persona: AiPersona;
	phases: PhaseTranscript[];
}

export interface GameSave {
	version: typeof GAME_SAVE_VERSION;
	ais: AiSaveEntry[];
	contentPacksA: ContentPack[];
	contentPacksB: ContentPack[];
}

export function serializeGameSave(game: GameState): GameSave {
	const ais: AiSaveEntry[] = Object.keys(game.personas).map((aiId) => {
		// biome-ignore lint/style/noNonNullAssertion: key comes from Object.keys so always defined
		const persona = game.personas[aiId]!;

		const conversationLog = game.conversationLogs[aiId] ?? [];
		const phases: PhaseTranscript[] = [
			{
				phaseNumber: VESTIGIAL_SINGLE_PHASE_NUMBER,
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
