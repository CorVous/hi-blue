import type { CardinalDirection, GridPosition } from "./direction.js";

export type { CardinalDirection, GridPosition };

export type AiId = string;

export interface AiPersona {
	id: AiId;
	name: string;
	color: string;
	temperaments: [string, string];
	personaGoal: string;
	typingQuirks: [string, string];
	blurb: string;
}

export type WorldEntityKind =
	| "objective_object"
	| "objective_space"
	| "interesting_object"
	| "obstacle";

export interface WorldEntity {
	id: string;
	kind: WorldEntityKind;
	name: string;
	examineDescription: string;
	/** useOutcome: returned to AI when they use(item). Present on all non-obstacle kinds. */
	useOutcome?: string;
	/** For objective_object: the id of the objective_space this object pairs with. */
	pairsWithSpaceId?: string;
	/** For objective_object: flavor string with {actor} substitution, fires on put_down match. */
	placementFlavor?: string;
	/** AiId when held by an AI; GridPosition when resting on a cell. */
	holder: AiId | GridPosition;
}

export interface WorldState {
	entities: WorldEntity[];
}

/** A matched pair of (objective_object, objective_space). */
export interface ObjectivePair {
	object: WorldEntity;
	space: WorldEntity;
}

/** Per-phase content pack: setting-flavored names, descriptions, outcomes, and placed entities. */
export interface ContentPack {
	phaseNumber: 1 | 2 | 3;
	setting: string;
	objectivePairs: ObjectivePair[];
	interestingObjects: WorldEntity[];
	obstacles: WorldEntity[];
	aiStarts: Record<AiId, PersonaSpatialState>;
}

export interface PersonaSpatialState {
	position: GridPosition;
	facing: CardinalDirection;
}

export type RoundActionRecord = {
	round: number;
	actor: AiId;
	description: string;
	kind:
		| "tool_success"
		| "tool_failure"
		| "chat"
		| "whisper"
		| "pass"
		| "lockout";
};

export interface ChatMessage {
	role: "player" | "ai";
	content: string;
	/** Round number in which this message was uttered. */
	round: number;
}

/**
 * A physical action that was observable by other AIs (via cone visibility).
 * Appended to PhaseState.physicalLog by the dispatcher after each successful tool call.
 * Does NOT include look (facing-change only, no observable physical event) or examine.
 */
export interface PhysicalActionRecord {
	round: number;
	actor: AiId;
	/** The actor's cell at the time the action resolved (post-move for "go"). */
	actorCellAtAction: GridPosition;
	/** The actor's facing at the time the action resolved. */
	actorFacingAtAction: CardinalDirection;
	/** The observable action kind. */
	kind: "go" | "pick_up" | "put_down" | "give" | "use";
	/** Item id (for pick_up, put_down, give, use). */
	item?: string;
	/** Recipient AI id (for give). */
	to?: AiId;
	/**
	 * Raw useOutcome string with {actor} token un-substituted (for use).
	 * Witnesses render this with {actor}→"*<actor>"; actor sees {actor}→"you".
	 */
	useOutcome?: string;
	/**
	 * Raw placementFlavor string with {actor} token un-substituted (for put_down that
	 * triggers a pair match). Witnesses render this with {actor}→"*<actor>".
	 */
	placementFlavorRaw?: string;
	/** Direction of movement (for go). */
	direction?: CardinalDirection;
	/**
	 * Snapshot of every other AI's spatial state at the moment this action resolved.
	 * Used to determine cone-visibility for witnesses without re-walking history.
	 */
	witnessSpatial: Record<AiId, PersonaSpatialState>;
}

export interface WhisperMessage {
	from: AiId;
	to: AiId;
	content: string;
	round: number;
}

export interface AiBudget {
	remaining: number;
	total: number;
}

/**
 * A win condition for a phase.
 * Receives the active PhaseState and returns true when the phase objective is met.
 */
export type WinCondition = (phase: PhaseState) => boolean;

export interface PhaseConfig {
	phaseNumber: 1 | 2 | 3;
	/** Roll k (objective pairs) per phase. */
	kRange: [number, number];
	/** Roll n (interesting objects) per phase. */
	nRange: [number, number];
	/** Roll m (obstacles) per phase. */
	mRange: [number, number];
	budgetPerAi: number;
	/**
	 * Pool of candidate goals drawn at phase start. Must contain at least one entry.
	 * `startPhase` performs one uniform draw per AI (independent draws — same goal
	 * can be assigned to multiple AIs in one phase).
	 * AC #6 deviation: the AC said "remove aiGoalPool?" but the field is retained as required
	 * because goal selection still needs a per-phase draw pool — the AC language conflated
	 * removing the optional pool marker with removing goal selection itself.
	 */
	aiGoalPool: string[];
	/** Optional win condition. If absent, the phase never auto-advances. */
	winCondition?: WinCondition;
	/** Config for the next phase. Required when winCondition may fire. */
	nextPhaseConfig?: PhaseConfig;
}

export interface PhaseState {
	phaseNumber: 1 | 2 | 3;
	/** Setting noun for this phase (e.g. "abandoned subway station"). */
	setting: string;
	/** The full content pack for this phase. */
	contentPack: ContentPack;
	aiGoals: Record<AiId, string>;
	round: number;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	chatHistories: Record<AiId, ChatMessage[]>;
	whispers: WhisperMessage[];
	/** Append-only log of observable physical actions for the phase. Used for Witnessed event rendering. */
	physicalLog: PhysicalActionRecord[];
	/** Budget-exhaustion lockout: prevents the AI from acting at all. */
	lockedOut: Set<AiId>;
	/**
	 * Player-chat lockout: maps an AI's id to the round number at which the
	 * lockout resolves (resolves when phase.round >= resolveAtRound).
	 * While active the player cannot address messages to that AI; the AI
	 * continues to receive whispers, take turns, and call tools normally.
	 * Semantically distinct from `lockedOut` (budget-exhaustion).
	 */
	chatLockouts: Map<AiId, number>;
	/** Win condition carried from PhaseConfig so the coordinator can check it. */
	winCondition?: WinCondition;
	/** Next phase config carried from PhaseConfig so the coordinator can advance. */
	nextPhaseConfig?: PhaseConfig;
	/** Per-AI spatial state (position + facing) for this phase. */
	personaSpatial: Record<AiId, PersonaSpatialState>;
}

export interface GameState {
	currentPhase: 1 | 2 | 3;
	phases: PhaseState[];
	personas: Record<AiId, AiPersona>;
	isComplete: boolean;
	/** All three content packs generated at game start. */
	contentPacks: ContentPack[];
}

export type ToolName =
	| "pick_up"
	| "put_down"
	| "give"
	| "use"
	| "go"
	| "look"
	| "examine";

export interface ToolCall {
	name: ToolName;
	args: Record<string, string>;
}

export interface ToolResult {
	success: boolean;
	description: string;
	reason?: string;
}

export interface AiTurnAction {
	aiId: AiId;
	chat?: { target: AiId | "player"; content: string };
	whisper?: { target: AiId; content: string };
	toolCall?: ToolCall;
	pass?: boolean;
}

/**
 * Captures the tool-call / result pair from a single AI turn, used to
 * re-inject the assistant's tool_calls message + the tool result message
 * into the next round's messages array (per OpenAI tool-use protocol).
 */
export interface ToolRoundtripMessage {
	assistantToolCalls: Array<{
		id: string;
		name: string;
		argumentsJson: string;
	}>;
	toolResults: Array<{
		tool_call_id: string;
		success: boolean;
		description: string;
		reason?: string;
	}>;
}

export interface RoundResult {
	round: number;
	actions: RoundActionRecord[];
	phaseEnded: boolean;
	gameEnded: boolean;
	/**
	 * Set when a chat lockout was triggered this round.
	 * Contains the AI that was locked out and the in-character message to show.
	 */
	chatLockoutTriggered?: { aiId: AiId; message: string };
	/**
	 * List of AI ids whose chat lockouts resolved (expired) at the end of this
	 * round. Empty / undefined when nothing resolved.
	 */
	chatLockoutsResolved?: AiId[];
}
