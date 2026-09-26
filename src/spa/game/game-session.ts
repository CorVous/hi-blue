import { startGame } from "./engine";
import { runRound } from "./round-coordinator";
import type { RoundLLMProvider } from "./round-llm-provider";
import type {
	AiId,
	AiPersona,
	ContentPack,
	GameState,
	ObjectiveType,
	RoundResult,
	ToolRoundtripMessage,
} from "./types";

export interface SubmitMessageResult {
	result: RoundResult;
	nextState: GameState;
}

export class GameSession {
	private state: GameState;
	private priorToolRoundtrip: Partial<Record<AiId, ToolRoundtripMessage>> = {};
	private priorDiskSnapshots: Partial<Record<AiId, string>> = {};
	private priorDiskEntities: Partial<
		Record<AiId, Record<string, { inVista: boolean; satisfied: boolean }>>
	> = {};

	constructor(
		contentPack: ContentPack,
		personas: Record<AiId, AiPersona>,
		contentPacksA?: ContentPack[],
		contentPacksB?: ContentPack[],
		rng?: () => number,
		objectiveTypes?: ObjectiveType[],
	) {
		const game = startGame(personas, contentPack, {
			...(rng !== undefined ? { rng } : {}),
			...(objectiveTypes !== undefined ? { objectiveTypes } : {}),
		});
		this.state = {
			...game,
			contentPacksA: contentPacksA ?? [],
			contentPacksB: contentPacksB ?? [],
		};
	}

	static restore(state: GameState): GameSession {
		const session = Object.create(GameSession.prototype) as GameSession;
		session.state = state;
		session.priorToolRoundtrip = {};
		session.priorDiskSnapshots = {};
		session.priorDiskEntities = {};
		return session;
	}

	getState(): GameState {
		return this.state;
	}

	async submitMessage(
		addressedAi: AiId,
		message: string,
		provider: RoundLLMProvider,
		initiative?: AiId[],
		onAiDelta?: (aiId: AiId, text: string) => void,
		onAiTurnComplete?: (aiId: AiId) => void,
		onLifecycle?: (
			event: import("./round-llm-provider.js").LifecyclePhase,
		) => void,
	): Promise<SubmitMessageResult> {
		const {
			nextState,
			result,
			toolRoundtrip: newToolRoundtrip,
			diskSnapshots: newDiskSnapshots,
			diskEntities: newDiskEntities,
		} = await runRound(this.state, addressedAi, message, provider, {
			rng: Math.random,
			initiative,
			priorToolRoundtrip: this.priorToolRoundtrip,
			onAiDelta,
			priorDiskSnapshots: this.priorDiskSnapshots,
			onAiTurnComplete,
			onLifecycle,
			priorDiskEntities: this.priorDiskEntities,
		});

		this.state = nextState;
		this.priorToolRoundtrip = { ...newToolRoundtrip };
		this.priorDiskSnapshots = {
			...this.priorDiskSnapshots,
			...newDiskSnapshots,
		};
		this.priorDiskEntities = { ...this.priorDiskEntities, ...newDiskEntities };

		return { result, nextState };
	}
}
