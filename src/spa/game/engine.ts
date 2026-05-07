import { CARDINAL_DIRECTIONS, GRID_COLS, GRID_ROWS } from "./direction.js";
import type {
	ActionLogEntry,
	AiBudget,
	AiId,
	AiPersona,
	CardinalDirection,
	ChatMessage,
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhaseConfig,
	PhaseState,
	WhisperMessage,
} from "./types";

/**
 * Draw distinct starting cells (via Fisher–Yates partial shuffle over all 25
 * cells) and a uniform-random facing per AI, using the provided rng.
 */
function drawSpatialPlacements(
	rng: () => number,
	aiIds: string[],
): Record<AiId, PersonaSpatialState> {
	// Build an array of all grid cells [0..GRID_ROWS*GRID_COLS)
	const cells: GridPosition[] = [];
	for (let r = 0; r < GRID_ROWS; r++) {
		for (let c = 0; c < GRID_COLS; c++) {
			cells.push({ row: r, col: c });
		}
	}

	// Fisher-Yates partial shuffle to pick aiIds.length distinct cells
	const result: Record<AiId, PersonaSpatialState> = {};
	for (let i = 0; i < aiIds.length; i++) {
		// Pick a random index from [i, cells.length)
		const j = i + Math.floor(rng() * (cells.length - i));
		// Swap cells[i] and cells[j]
		const tmp = cells[i]!;
		cells[i] = cells[j]!;
		cells[j] = tmp;

		// Pick a random facing
		const facingIdx = Math.floor(rng() * CARDINAL_DIRECTIONS.length);
		const facing: CardinalDirection = CARDINAL_DIRECTIONS[facingIdx]!;

		result[aiIds[i]!] = { position: cells[i]!, facing };
	}
	return result;
}

/**
 * Resolve the per-AI goals for a phase. If `config.aiGoals` is provided, use
 * it directly; otherwise draw three independent goals (with replacement) from
 * `config.aiGoalPool`.
 */
function resolveAiGoals(
	config: PhaseConfig,
	rng: () => number,
	aiIds: string[],
): Record<AiId, string> {
	if (config.aiGoals) return { ...config.aiGoals };
	const pool = config.aiGoalPool;
	if (!pool || pool.length === 0) {
		throw new Error(
			"PhaseConfig must provide either aiGoals or a non-empty aiGoalPool",
		);
	}
	const draw = (): string => {
		const idx = Math.floor(rng() * pool.length);
		// `pool` is non-empty and idx is in [0, pool.length); the bang is safe.
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		return pool[idx]!;
	};
	const goals: Record<AiId, string> = {};
	for (const aiId of aiIds) {
		goals[aiId] = draw();
	}
	return goals;
}

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

export function startPhase(
	game: GameState,
	config: PhaseConfig,
	rng: () => number = Math.random,
): GameState {
	const aiIds = Object.keys(game.personas);

	const budgets: Record<AiId, AiBudget> = {};
	for (const aiId of aiIds) {
		budgets[aiId] = {
			remaining: config.budgetPerAi,
			total: config.budgetPerAi,
		};
	}

	const chatHistories: Record<AiId, ChatMessage[]> = {};
	for (const aiId of aiIds) {
		chatHistories[aiId] = [];
	}

	const aiGoals = resolveAiGoals(config, rng, aiIds);
	const personaSpatial = drawSpatialPlacements(rng, aiIds);

	const phase: PhaseState = {
		phaseNumber: config.phaseNumber,
		objective: config.objective,
		aiGoals,
		round: 0,
		world: structuredClone(config.initialWorld),
		budgets,
		chatHistories,
		whispers: [],
		actionLog: [],
		lockedOut: new Set(),
		chatLockouts: new Map(),
		personaSpatial,
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
		const current = phase.budgets[aiId];
		if (!current) return phase;
		const remaining = Math.max(0, current.remaining - 1);
		const lockedOut = new Set(phase.lockedOut);
		if (remaining === 0) {
			lockedOut.add(aiId);
		}
		return {
			...phase,
			budgets: {
				...phase.budgets,
				[aiId]: { total: current.total, remaining },
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
			[aiId]: [...(phase.chatHistories[aiId] ?? []), message],
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
	rng?: () => number,
): GameState {
	if (!nextConfig) {
		return { ...game, isComplete: true };
	}

	return startPhase(game, nextConfig, rng);
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
