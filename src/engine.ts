import type {
	ActionLogEntry,
	AiBudget,
	AiId,
	AiPersona,
	ChatLockout,
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
		chatLockout: null,
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

// ─── Chat-lockout helpers ─────────────────────────────────────────────────────

export function setChatLockout(
	game: GameState,
	lockout: ChatLockout | null,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		chatLockout: lockout,
	}));
}

export function getChatLockout(game: GameState): ChatLockout | null {
	return getActivePhase(game).chatLockout;
}

/**
 * Decrements the chat-lockout round counter. If it reaches zero, clears the
 * lockout. Should be called once per round at the end of the round.
 */
export function tickChatLockout(game: GameState): GameState {
	const lockout = getChatLockout(game);
	if (!lockout) return game;
	if (lockout.roundsRemaining <= 1) {
		return setChatLockout(game, null);
	}
	return setChatLockout(game, {
		...lockout,
		roundsRemaining: lockout.roundsRemaining - 1,
	});
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
