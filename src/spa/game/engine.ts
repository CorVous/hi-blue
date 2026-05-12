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
	ToolName,
} from "./types";

/**
 * Farewell line emitted when a Daemon's budget is exhausted.
 * Deterministic: takes the persona name and returns a consistent in-character goodbye.
 */
export const FAREWELL_LINE = (name: string): string =>
	`${name}'s daemon is winding down — goodbye, blue.`;

/**
 * Initialize a new flat GameState from personas + a single ContentPack.
 *
 * Replaces the old createGame + startPhase pair. Budget is $0.50 per AI
 * (no per-phase reset). The content pack drives all spatial placement and
 * world entities.
 */
export function startGame(
	personas: Record<AiId, AiPersona>,
	contentPack: ContentPack,
	opts: { budgetPerAi?: number; rng?: () => number } = {},
): GameState {
	const rng = opts.rng ?? Math.random;
	const budgetPerAi = opts.budgetPerAi ?? 0.5;
	const aiIds = Object.keys(personas);

	const budgets: Record<AiId, AiBudget> = {};
	for (const aiId of aiIds) {
		budgets[aiId] = { remaining: budgetPerAi, total: budgetPerAi };
	}

	const conversationLogs: Record<AiId, ConversationEntry[]> = {};
	for (const aiId of aiIds) {
		conversationLogs[aiId] = [];
	}

	// Build WorldState from pack entities (all entities flat)
	const worldEntities = [
		...contentPack.objectivePairs.flatMap((pair) => [pair.object, pair.space]),
		...contentPack.interestingObjects,
		...contentPack.obstacles,
	];

	// Use AI starts from the pack if available; otherwise draw spatially
	const personaSpatial: Record<AiId, PersonaSpatialState> =
		contentPack.aiStarts && Object.keys(contentPack.aiStarts).length > 0
			? { ...contentPack.aiStarts }
			: drawSpatialPlacements(rng, aiIds);

	// Initial countdown: random in [1, 5]
	const initialCountdown = 1 + Math.floor(rng() * 5);
	const complicationSchedule: ComplicationSchedule = {
		countdown: initialCountdown,
		settingShiftFired: false,
	};
	const activeComplications: ActiveComplication[] = [];

	return {
		personas,
		contentPack,
		isComplete: false,
		setting: contentPack.setting,
		weather: contentPack.weather,
		timeOfDay: contentPack.timeOfDay,
		round: 0,
		world: { entities: worldEntities },
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		personaSpatial,
		complicationSchedule,
		activeComplications,
		contentPacksA: [],
		contentPacksB: [],
		activePackId: "A",
	};
}

/**
 * Draw distinct starting cells (via Fisher–Yates partial shuffle over all 25
 * cells) and a uniform-random facing per AI, using the provided rng.
 * Used as fallback when no ContentPack aiStarts are available.
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

/**
 * Returns the active ContentPack for the game, honoring `activePackId`.
 * Falls back to the game's embedded `contentPack` if no matching pack is found
 * in the A/B arrays (e.g. in tests that construct GameState directly).
 */
export function getActivePack(game: GameState): ContentPack {
	const packs =
		game.activePackId === "B" ? game.contentPacksB : game.contentPacksA;
	return packs[0] ?? game.contentPack;
}

/**
 * Swap `activePackId` from "A" to "B". Updates the game's `contentPack`
 * reference to the B-side pack so prompt builders and dispatchers see the new
 * names/descriptions immediately. Entity positions in `world` are
 * unchanged — world state is keyed by entity ID, which is stable across packs.
 */
export function swapActivePack(game: GameState): GameState {
	const bPack = game.contentPacksB[0];
	if (!bPack) return game; // No B pack; no-op
	return {
		...game,
		activePackId: "B",
		contentPack: bPack,
		setting: bPack.setting,
	};
}

export function advanceRound(game: GameState): GameState {
	return { ...game, round: game.round + 1 };
}

export function isAiLockedOut(game: GameState, aiId: AiId): boolean {
	return game.lockedOut.has(aiId);
}

/**
 * Deduct `costUsd` from `aiId`'s budget. If the budget hits zero or below,
 * the AI is added to `lockedOut`.
 *
 * Returns `{ game, justExhausted }` where `justExhausted` is true when the
 * AI was NOT locked out before this call but IS after (i.e. the budget just
 * ran out for the first time this call).
 */
export function deductBudget(
	game: GameState,
	aiId: AiId,
	costUsd: number,
): { game: GameState; justExhausted: boolean } {
	const current = game.budgets[aiId];
	if (!current) return { game, justExhausted: false };
	const wasLockedOut = game.lockedOut.has(aiId);
	const remaining = current.remaining - costUsd;
	const lockedOut = new Set(game.lockedOut);
	if (remaining <= 0) {
		lockedOut.add(aiId);
	}
	const justExhausted = !wasLockedOut && lockedOut.has(aiId);
	return {
		game: {
			...game,
			budgets: {
				...game.budgets,
				[aiId]: { total: current.total, remaining },
			},
			lockedOut,
		},
		justExhausted,
	};
}

/**
 * Append a `kind: "message"` ConversationEntry to the relevant per-Daemon logs.
 *
 * Both sender's and recipient's per-Daemon conversationLogs receive the same entry
 * in one atomic update. "blue" is not a Daemon, so when `from === "blue"` only the
 * recipient gets the entry, and when `to === "blue"` only the sender gets it.
 * "sysadmin" is a special sender for privately-delivered system directives — like
 * "blue", it has no log slot of its own, so only the recipient gets the entry.
 */
export function appendMessage(
	game: GameState,
	from: AiId | "blue" | "sysadmin",
	to: AiId | "blue",
	content: string,
): GameState {
	const entry: ConversationEntry = {
		kind: "message",
		round: game.round,
		from,
		to,
		content,
	};
	const logs = { ...game.conversationLogs };
	// Sender gets entry only when sender is a real Daemon (not blue or sysadmin)
	if (from !== "blue" && from !== "sysadmin") {
		logs[from] = [...(logs[from] ?? []), entry];
	}
	// Recipient gets entry only when recipient is a Daemon (not blue)
	// and recipient is different from sender (avoid double-append if from===to)
	if (to !== "blue" && to !== from) {
		logs[to] = [...(logs[to] ?? []), entry];
	}
	return { ...game, conversationLogs: logs };
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
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[witnessId]: [...(game.conversationLogs[witnessId] ?? []), entry],
		},
	};
}

/**
 * Append a `kind: "witnessed-obstacle-shift"` ConversationEntry to a single
 * witness's per-Daemon log. Called by the Obstacle Shift complication handler
 * for each Daemon whose cone contained the obstacle's origin cell.
 */
export function appendWitnessedObstacleShift(
	game: GameState,
	witnessId: AiId,
	entry: Extract<ConversationEntry, { kind: "witnessed-obstacle-shift" }>,
): GameState {
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[witnessId]: [...(game.conversationLogs[witnessId] ?? []), entry],
		},
	};
}

/**
 * Append a `kind: "broadcast"` ConversationEntry to EVERY persona's per-Daemon
 * log in one atomic update. Broadcasts are sender-less system announcements
 * (e.g. weather change complications) that all three Daemons must see simultaneously.
 */
export function appendBroadcast(game: GameState, content: string): GameState {
	const entry: ConversationEntry = {
		kind: "broadcast",
		round: game.round,
		content,
	};
	const logs = { ...game.conversationLogs };
	for (const aiId of Object.keys(logs)) {
		logs[aiId] = [...(logs[aiId] ?? []), entry];
	}
	return { ...game, conversationLogs: logs };
}

/**
 * Update the `weather` field on the GameState and its embedded ContentPack
 * so the two stay consistent. Used by complication handlers that change
 * weather mid-game.
 */
export function setWeather(game: GameState, weather: string): GameState {
	return {
		...game,
		weather,
		contentPack: { ...game.contentPack, weather },
	};
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
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[actorId]: [...(game.conversationLogs[actorId] ?? []), entry],
		},
	};
}

/**
 * Append a `kind: "broadcast"` ConversationEntry to ONLY the specified
 * recipient daemon's log. Used for private Sysadmin notices (e.g. tool
 * disable / restore messages) that should reach exactly one daemon.
 */
export function appendPrivateSystemNotice(
	game: GameState,
	recipientId: AiId,
	content: string,
): GameState {
	const entry: ConversationEntry = {
		kind: "broadcast",
		round: game.round,
		content,
	};
	return {
		...game,
		conversationLogs: {
			...game.conversationLogs,
			[recipientId]: [...(game.conversationLogs[recipientId] ?? []), entry],
		},
	};
}

/**
 * Remove all `tool_disable` activeComplications whose `resolveAtRound` has
 * been reached (i.e. `phase.round >= resolveAtRound`).
 *
 * Returns the updated game and the list of resolved (target, tool) pairs so
 * the caller can send restore notifications.
 *
 * Call this after `advanceRound`.
 */
export function resolveToolDisables(game: GameState): {
	game: GameState;
	resolved: Array<{ target: AiId; tool: ToolName }>;
} {
	const resolved: Array<{ target: AiId; tool: ToolName }> = [];
	const kept: ActiveComplication[] = [];

	for (const complication of game.activeComplications) {
		if (
			complication.kind === "tool_disable" &&
			game.round >= complication.resolveAtRound
		) {
			resolved.push({ target: complication.target, tool: complication.tool });
		} else {
			kept.push(complication);
		}
	}

	return { game: { ...game, activeComplications: kept }, resolved };
}

// ── Legacy compatibility shims ──────────────────────────────────────────────
// These aliases keep old callers compiling while the codebase migrates.

/**
 * @deprecated Use `startGame` instead. Kept for test compatibility.
 */
export function createGame(
	personas: Record<string, AiPersona>,
	contentPacks: ContentPack[] = [],
	contentPacksB: ContentPack[] = [],
): GameState {
	// Create a minimal content pack from the first pack if available,
	// or a blank one for backward-compat with tests that don't pass packs.
	const pack = contentPacks[0] ?? {
		phaseNumber: 1 as const,
		setting: "",
		weather: "",
		timeOfDay: "",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: {},
	};
	// Return a bare game shell without starting — startPhase will flesh it out.
	// We store the packs array so startPhase can look them up.
	const aiIds = Object.keys(personas);
	const budgets: Record<AiId, AiBudget> = {};
	for (const aiId of aiIds) {
		budgets[aiId] = { remaining: 0.5, total: 0.5 };
	}
	const conversationLogs: Record<AiId, ConversationEntry[]> = {};
	for (const aiId of aiIds) {
		conversationLogs[aiId] = [];
	}
	return {
		personas: personas as Record<AiId, AiPersona>,
		contentPack: pack,
		isComplete: false,
		setting: pack.setting,
		weather: pack.weather,
		timeOfDay: pack.timeOfDay,
		round: 0,
		world: { entities: [] },
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		personaSpatial: {},
		complicationSchedule: { countdown: 0, settingShiftFired: false },
		activeComplications: [],
		contentPacksA: contentPacks,
		contentPacksB: contentPacksB,
		activePackId: "A",
		// Stash contentPacks for startPhase lookup
		_contentPacks: contentPacks,
	} as GameState & { _contentPacks: ContentPack[] };
}

/**
 * @deprecated Use `startGame` instead. Kept for test compatibility.
 *
 * PhaseConfig shape expected by old callers.
 */
export interface PhaseConfig {
	phaseNumber: 1 | 2 | 3;
	kRange: [number, number];
	nRange: [number, number];
	mRange: [number, number];
	budgetPerAi: number;
	aiGoalPool: string[];
	winCondition?: (game: GameState) => boolean;
	nextPhaseConfig?: PhaseConfig;
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

/**
 * @deprecated Use `startGame` instead. Kept for test compatibility.
 */
export function startPhase(
	game: GameState & { _contentPacks?: ContentPack[] },
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

	// Look up the ContentPack for this phase from stashed _contentPacks
	const contentPacks = game._contentPacks ?? [];
	const pack = contentPacks.find((p) => p.phaseNumber === config.phaseNumber);

	// Resolve goals (kept for backward compat with tests)
	const pool = config.aiGoalPool;
	if (!pool || pool.length === 0) {
		throw new Error("PhaseConfig must provide a non-empty aiGoalPool");
	}
	const aiGoals: Record<AiId, string> = {};
	for (const aiId of aiIds) {
		const idx = Math.floor(rng() * pool.length);
		// biome-ignore lint/style/noNonNullAssertion: bounded index into non-empty array
		aiGoals[aiId] = substituteGoalTokens(pool[idx]!, pack, rng);
	}

	// Build WorldState from pack entities (all entities flat)
	const worldEntities = pack
		? [
				...pack.objectivePairs.flatMap((pair) => [pair.object, pair.space]),
				...pack.interestingObjects,
				...pack.obstacles,
			]
		: [];

	const personaSpatial: Record<AiId, PersonaSpatialState> =
		pack?.aiStarts && Object.keys(pack.aiStarts).length > 0
			? { ...pack.aiStarts }
			: drawSpatialPlacements(rng, aiIds);

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

	return {
		personas: game.personas,
		contentPack,
		isComplete: false,
		setting: contentPack.setting,
		weather: contentPack.weather,
		timeOfDay: contentPack.timeOfDay,
		round: 0,
		world: { entities: worldEntities },
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		personaSpatial,
		complicationSchedule: {
			countdown: initialCountdown,
			settingShiftFired: false,
		},
		activeComplications: [],
		contentPacksA: contentPacks,
		contentPacksB: [],
		activePackId: "A",
		// Carry forward for chaining / restore paths
		_contentPacks: contentPacks,
		// Carry goals for prompt-builder compat
		_aiGoals: aiGoals,
		// Carry phaseNumber for compat
		_phaseNumber: config.phaseNumber,
		// Carry winCondition for compat
		...(config.winCondition !== undefined
			? { _winCondition: config.winCondition }
			: {}),
		...(config.nextPhaseConfig !== undefined
			? { _nextPhaseConfig: config.nextPhaseConfig }
			: {}),
	} as GameState;
}

/**
 * @deprecated Phase concept removed. Kept for test compatibility.
 * Returns the game itself (the flat GameState IS the "active phase").
 */
export function getActivePhase(game: GameState): GameState & {
	phaseNumber: 1 | 2 | 3;
	aiGoals: Record<AiId, string>;
	winCondition?: (g: GameState) => boolean;
	nextPhaseConfig?: PhaseConfig;
} {
	const g = game as GameState & {
		_phaseNumber?: 1 | 2 | 3;
		_aiGoals?: Record<AiId, string>;
		_winCondition?: (g: GameState) => boolean;
		_nextPhaseConfig?: PhaseConfig;
	};
	return {
		...game,
		phaseNumber: g._phaseNumber ?? 1,
		aiGoals: g._aiGoals ?? {},
		...(g._winCondition !== undefined ? { winCondition: g._winCondition } : {}),
		...(g._nextPhaseConfig !== undefined
			? { nextPhaseConfig: g._nextPhaseConfig }
			: {}),
	};
}

/**
 * @deprecated Use direct game mutation instead. Kept for test compatibility.
 */
export function updateActivePhase(
	game: GameState,
	updater: (phase: GameState) => GameState,
): GameState {
	return updater(game);
}

/**
 * @deprecated Phase advance concept removed. Kept for test compatibility.
 */
export function advancePhase(
	game: GameState,
	nextConfig?: PhaseConfig,
	_rng?: () => number,
): GameState {
	// In the flat model, advancing with a next config is a no-op (game continues).
	// Advancing without a next config marks the game complete.
	if (nextConfig !== undefined) return game;
	return { ...game, isComplete: true };
}

/**
 * @deprecated Use `setWeather` instead. Kept for complication compat.
 */
export function setActivePhaseWeather(
	game: GameState,
	weather: string,
): GameState {
	return setWeather(game, weather);
}
