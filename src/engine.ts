import type {
	ActionLogEntry,
	AiBudget,
	AiId,
	AiPersona,
	ChatMessage,
	GameState,
	PhaseConfig,
	PhaseState,
	WhisperMessage,
} from "./types";

export function updateActivePhase(
	game: GameState,
	updater: (phase: PhaseState) => PhaseState,
): GameState {
	const phases = [...game.phases];
	const active = phases[phases.length - 1];
	if (!active) throw new Error("No active phase");
	phases[phases.length - 1] = updater({ ...active });
	return { ...game, phases };
}

export function createGame(personas: Record<string, AiPersona>): GameState {
	return {
		currentPhase: 1,
		phases: [],
		personas: personas as Record<AiId, AiPersona>,
		isComplete: false,
	};
}

export function startPhase(game: GameState, config: PhaseConfig): GameState {
	const budgets: Record<AiId, AiBudget> = {
		red: { remaining: config.budgetPerAi, total: config.budgetPerAi },
		green: { remaining: config.budgetPerAi, total: config.budgetPerAi },
		blue: { remaining: config.budgetPerAi, total: config.budgetPerAi },
	};

	const chatHistories: Record<AiId, ChatMessage[]> = {
		red: [],
		green: [],
		blue: [],
	};

	const phase: PhaseState = {
		phaseNumber: config.phaseNumber,
		objective: config.objective,
		aiGoals: { ...config.aiGoals },
		round: 0,
		world: structuredClone(config.initialWorld),
		budgets,
		chatHistories,
		whispers: [],
		actionLog: [],
		lockedOut: new Set(),
		chatLockouts: new Map(),
		...(config.winCondition !== undefined
			? { winCondition: config.winCondition }
			: {}),
		...(config.nextPhaseConfig !== undefined
			? { nextPhaseConfig: config.nextPhaseConfig }
			: {}),
	};

	return {
		...game,
		currentPhase: config.phaseNumber,
		phases: [...game.phases, phase],
	};
}

export function getActivePhase(game: GameState): PhaseState {
	const phase = game.phases[game.phases.length - 1];
	if (!phase) throw new Error("No active phase");
	return phase;
}

export function advanceRound(game: GameState): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		round: phase.round + 1,
	}));
}

export function isAiLockedOut(game: GameState, aiId: AiId): boolean {
	const phase = getActivePhase(game);
	return phase.lockedOut.has(aiId);
}

export function deductBudget(game: GameState, aiId: AiId): GameState {
	return updateActivePhase(game, (phase) => {
		const remaining = Math.max(0, phase.budgets[aiId].remaining - 1);
		const lockedOut = new Set(phase.lockedOut);
		if (remaining === 0) {
			lockedOut.add(aiId);
		}
		return {
			...phase,
			budgets: {
				...phase.budgets,
				[aiId]: { ...phase.budgets[aiId], remaining },
			},
			lockedOut,
		};
	});
}

export function appendActionLog(
	game: GameState,
	entry: ActionLogEntry,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		actionLog: [...phase.actionLog, entry],
	}));
}

export function appendChat(
	game: GameState,
	aiId: AiId,
	message: ChatMessage,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		chatHistories: {
			...phase.chatHistories,
			[aiId]: [...phase.chatHistories[aiId], message],
		},
	}));
}

export function appendWhisper(
	game: GameState,
	whisper: WhisperMessage,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		whispers: [...phase.whispers, whisper],
	}));
}

export function advancePhase(
	game: GameState,
	nextConfig?: PhaseConfig,
): GameState {
	if (!nextConfig) {
		return { ...game, isComplete: true };
	}

	return startPhase(game, nextConfig);
}

/**
 * Trigger a player-chat lockout for the given AI.
 *
 * @param resolveAtRound  The round number at which the lockout expires.
 *   The lockout is active while `phase.round < resolveAtRound`.
 *   It resolves (is removed) when `phase.round >= resolveAtRound`.
 */
export function triggerChatLockout(
	game: GameState,
	aiId: AiId,
	resolveAtRound: number,
): GameState {
	return updateActivePhase(game, (phase) => {
		const chatLockouts = new Map(phase.chatLockouts);
		chatLockouts.set(aiId, resolveAtRound);
		return { ...phase, chatLockouts };
	});
}

/**
 * Returns true when the player's chat channel to the given AI is currently
 * locked out (i.e. `phase.chatLockouts` has an entry for `aiId` that has
 * not yet expired).
 *
 * Distinct from `isAiLockedOut` (budget-exhaustion): a chat-locked AI still
 * takes turns, whispers, and calls tools.
 */
export function isPlayerChatLockedOut(game: GameState, aiId: AiId): boolean {
	const phase = getActivePhase(game);
	const resolveAtRound = phase.chatLockouts.get(aiId);
	if (resolveAtRound === undefined) return false;
	return phase.round < resolveAtRound;
}

/**
 * Remove all chat lockouts whose `resolveAtRound` has been reached
 * (i.e. `phase.round >= resolveAtRound`).
 *
 * Call this after `advanceRound` so that a lockout set to resolve at round N
 * is cleared when `phase.round === N`.
 */
export function resolveChatLockouts(game: GameState): GameState {
	return updateActivePhase(game, (phase) => {
		const chatLockouts = new Map<AiId, number>();
		for (const [aiId, resolveAtRound] of phase.chatLockouts) {
			if (phase.round < resolveAtRound) {
				chatLockouts.set(aiId, resolveAtRound);
			}
		}
		return { ...phase, chatLockouts };
	});
}
