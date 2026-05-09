import { CARDINAL_DIRECTIONS, GRID_COLS, GRID_ROWS } from "./direction.js";
import type {
	AiBudget,
	AiId,
	AiPersona,
	CardinalDirection,
	ConversationEntry,
	ContentPack,
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhaseConfig,
	PhaseState,
	PhysicalActionRecord,
	WhisperMessage,
} from "./types";

/**
 * Resolve the per-AI goals for a phase. Draw one goal per AI (with replacement)
 * from `config.aiGoalPool`.
 */
function resolveAiGoals(
	config: PhaseConfig,
	rng: () => number,
	aiIds: string[],
): Record<AiId, string> {
	const pool = config.aiGoalPool;
	if (!pool || pool.length === 0) {
		throw new Error("PhaseConfig must provide a non-empty aiGoalPool");
	}
	const draw = (): string => {
		const idx = Math.floor(rng() * pool.length);
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

export function createGame(
	personas: Record<string, AiPersona>,
	contentPacks: ContentPack[] = [],
): GameState {
	return {
		currentPhase: 1,
		phases: [],
		personas: personas as Record<AiId, AiPersona>,
		isComplete: false,
		contentPacks,
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

	const conversationLogs: Record<AiId, ConversationEntry[]> = {};
	for (const aiId of aiIds) {
		conversationLogs[aiId] = [];
	}

	const aiGoals = resolveAiGoals(config, rng, aiIds);

	// Look up the ContentPack for this phase from game.contentPacks
	const pack = game.contentPacks.find(
		(p) => p.phaseNumber === config.phaseNumber,
	);

	// Build WorldState from pack entities (all entities flat)
	const worldEntities = pack
		? [
				...pack.objectivePairs.flatMap((pair) => [pair.object, pair.space]),
				...pack.interestingObjects,
				...pack.obstacles,
			]
		: [];

	// Use AI starts from the pack if available; otherwise draw spatially
	const personaSpatial: Record<AiId, PersonaSpatialState> = pack?.aiStarts
		? { ...pack.aiStarts }
		: drawSpatialPlacements(rng, aiIds);

	// Create a minimal content pack if none exists (for backward-compat with tests)
	const contentPack: ContentPack = pack ?? {
		phaseNumber: config.phaseNumber,
		setting: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		aiStarts: personaSpatial,
	};

	const phase: PhaseState = {
		phaseNumber: config.phaseNumber,
		setting: contentPack.setting,
		contentPack,
		aiGoals,
		round: 0,
		world: { entities: worldEntities },
		budgets,
		whispers: [],
		physicalLog: [],
		conversationLogs,
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

/**
 * Draw distinct starting cells (via Fisher–Yates partial shuffle over all 25
 * cells) and a uniform-random facing per AI, using the provided rng.
 * Used as fallback when no ContentPack is available (e.g., legacy tests).
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
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const tmp = cells[i]!;
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		cells[i] = cells[j]!;
		cells[j] = tmp;

		// Pick a random facing
		const facingIdx = Math.floor(rng() * CARDINAL_DIRECTIONS.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		const facing: CardinalDirection = CARDINAL_DIRECTIONS[facingIdx]!;

		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		result[aiIds[i]!] = { position: cells[i]!, facing };
	}
	return result;
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

export function deductBudget(
	game: GameState,
	aiId: AiId,
	costUsd: number,
): GameState {
	return updateActivePhase(game, (phase) => {
		const current = phase.budgets[aiId];
		if (!current) return phase;
		const remaining = current.remaining - costUsd;
		const lockedOut = new Set(phase.lockedOut);
		if (remaining <= 0) {
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

export function appendChat(
	game: GameState,
	aiId: AiId,
	message: { role: "player" | "ai"; content: string },
): GameState {
	return updateActivePhase(game, (phase) => {
		const entry: ConversationEntry = {
			kind: "chat",
			round: phase.round,
			role: message.role,
			content: message.content,
		};
		return {
			...phase,
			conversationLogs: {
				...phase.conversationLogs,
				[aiId]: [...(phase.conversationLogs[aiId] ?? []), entry],
			},
		};
	});
}

export function appendPhysicalAction(
	game: GameState,
	record: PhysicalActionRecord,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		physicalLog: [...phase.physicalLog, record],
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
