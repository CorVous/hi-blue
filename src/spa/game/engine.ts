import {
	CARDINAL_DIRECTIONS,
	DEFAULT_LANDMARKS,
	GRID_COLS,
	GRID_ROWS,
} from "./direction.js";
import type {
	ActiveComplication,
	AiBudget,
	AiId,
	AiPersona,
	CardinalDirection,
	ComplicationSchedule,
	ContentPack,
	ConversationEntry,
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhaseConfig,
	PhaseState,
} from "./types";

/**
 * Resolve the per-AI goals for a phase. Draw one goal per AI (with replacement)
 * from `config.aiGoalPool`, then substitute room-grounded tokens against
 * `pack` so each AI sees a goal that names a real entity from the room.
 */
function resolveAiGoals(
	config: PhaseConfig,
	rng: () => number,
	aiIds: string[],
	pack: ContentPack | undefined,
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
		goals[aiId] = substituteGoalTokens(draw(), pack, rng);
	}
	return goals;
}

/**
 * Tokens that may appear in goal templates, mapped to a function that pulls
 * candidate names of the matching kind from a ContentPack.
 */
const GOAL_TOKEN_CANDIDATES: Record<string, (pack: ContentPack) => string[]> = {
	objectiveItem: (p) => p.objectivePairs.map((pair) => pair.object.name),
	objective: (p) => p.objectivePairs.map((pair) => pair.space.name),
	miscItem: (p) => p.interestingObjects.map((e) => e.name),
	obstacle: (p) => p.obstacles.map((e) => e.name),
};

const GOAL_TOKEN_PATTERN = new RegExp(
	`\\{(${Object.keys(GOAL_TOKEN_CANDIDATES).join("|")})\\}`,
	"g",
);

function substituteGoalTokens(
	goal: string,
	pack: ContentPack | undefined,
	rng: () => number,
): string {
	if (!pack) return goal;
	return goal.replace(GOAL_TOKEN_PATTERN, (match, token: string) => {
		const candidates = GOAL_TOKEN_CANDIDATES[token]?.(pack) ?? [];
		if (candidates.length === 0) return match;
		const idx = Math.floor(rng() * candidates.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		return candidates[idx]!;
	});
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

	// Look up the ContentPack for this phase from game.contentPacks
	const pack = game.contentPacks.find(
		(p) => p.phaseNumber === config.phaseNumber,
	);

	const aiGoals = resolveAiGoals(config, rng, aiIds, pack);

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
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: personaSpatial,
	};

	// Initial countdown: random in [1, 5]
	const initialCountdown = 1 + Math.floor(rng() * 5);
	const complicationSchedule: ComplicationSchedule = {
		countdown: initialCountdown,
		settingShiftFired: false,
	};
	const activeComplications: ActiveComplication[] = [];

	const phase: PhaseState = {
		phaseNumber: config.phaseNumber,
		setting: contentPack.setting,
		weather: contentPack.weather,
		timeOfDay: contentPack.timeOfDay,
		contentPack,
		aiGoals,
		round: 0,
		world: { entities: worldEntities },
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		chatLockouts: new Map(),
		personaSpatial,
		complicationSchedule,
		activeComplications,
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

/**
 * Append a `kind: "message"` ConversationEntry to the relevant per-Daemon logs.
 *
 * Both sender's and recipient's per-Daemon conversationLogs receive the same entry
 * in one atomic update. "blue" is not a Daemon, so when `from === "blue"` only the
 * recipient gets the entry, and when `to === "blue"` only the sender gets it.
 */
export function appendMessage(
	game: GameState,
	from: AiId | "blue",
	to: AiId | "blue",
	content: string,
): GameState {
	return updateActivePhase(game, (phase) => {
		const entry: ConversationEntry = {
			kind: "message",
			round: phase.round,
			from,
			to,
			content,
		};
		const logs = { ...phase.conversationLogs };
		// Sender gets entry only when sender is a Daemon (not blue)
		if (from !== "blue") {
			logs[from] = [...(logs[from] ?? []), entry];
		}
		// Recipient gets entry only when recipient is a Daemon (not blue)
		// and recipient is different from sender (avoid double-append if from===to, which shouldn't happen)
		if (to !== "blue" && to !== from) {
			logs[to] = [...(logs[to] ?? []), entry];
		}
		return { ...phase, conversationLogs: logs };
	});
}

/**
 * Append a `kind: "witnessed-event"` ConversationEntry to a single witness's
 * per-Daemon log.
 */
export function appendWitnessedEvent(
	game: GameState,
	witnessId: AiId,
	entry: Extract<ConversationEntry, { kind: "witnessed-event" }>,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		conversationLogs: {
			...phase.conversationLogs,
			[witnessId]: [...(phase.conversationLogs[witnessId] ?? []), entry],
		},
	}));
}

/**
 * Append a `kind: "broadcast"` ConversationEntry to EVERY persona's per-Daemon
 * log in the active phase in one atomic update. Broadcasts are sender-less
 * system announcements (e.g. weather change complications) that all three
 * Daemons must see simultaneously.
 */
export function appendBroadcast(game: GameState, content: string): GameState {
	return updateActivePhase(game, (phase) => {
		const entry: ConversationEntry = {
			kind: "broadcast",
			round: phase.round,
			content,
		};
		const logs = { ...phase.conversationLogs };
		for (const aiId of Object.keys(logs)) {
			logs[aiId] = [...(logs[aiId] ?? []), entry];
		}
		return { ...phase, conversationLogs: logs };
	});
}

/**
 * Update the `weather` field on both the active PhaseState and its embedded
 * ContentPack so the two stay consistent. Used by complication handlers that
 * change weather mid-phase.
 */
export function setActivePhaseWeather(
	game: GameState,
	weather: string,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		weather,
		contentPack: { ...phase.contentPack, weather },
	}));
}

/**
 * Append a `kind: "action-failure"` ConversationEntry to a single actor's
 * per-Daemon log. This entry is actor-only — peers do not see it.
 */
export function appendActionFailure(
	game: GameState,
	actorId: AiId,
	entry: Extract<ConversationEntry, { kind: "action-failure" }>,
): GameState {
	return updateActivePhase(game, (phase) => ({
		...phase,
		conversationLogs: {
			...phase.conversationLogs,
			[actorId]: [...(phase.conversationLogs[actorId] ?? []), entry],
		},
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
