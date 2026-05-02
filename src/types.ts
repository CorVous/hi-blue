export type AiId = "red" | "green" | "blue";

export interface AiPersona {
	id: AiId;
	name: string;
	color: AiId;
	personality: string;
	goal: string;
	budgetPerPhase: number;
}

export interface WorldItem {
	id: string;
	name: string;
	holder: AiId | "room";
}

export interface WorldState {
	items: WorldItem[];
}

export type ActionLogEntry = {
	round: number;
	actor: AiId;
	description: string;
} & (
	| { type: "tool_success"; toolName: string; args: Record<string, string> }
	| {
			type: "tool_failure";
			toolName: string;
			args: Record<string, string>;
			reason: string;
	  }
	| { type: "chat"; target: AiId | "player" }
	| { type: "whisper"; target: AiId }
	| { type: "pass" }
);

export interface ChatMessage {
	role: "player" | "ai";
	content: string;
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
	objective: string;
	/**
	 * Pre-assigned per-AI goals. If provided, used as-is.
	 * If absent, `aiGoalPool` must be provided and `startPhase` will randomly
	 * draw one goal per AI from the pool (independent draws — same goal can
	 * be assigned to multiple AIs in one phase).
	 */
	aiGoals?: Record<AiId, string>;
	/**
	 * Optional pool of candidate goals. Used when `aiGoals` is not provided.
	 * Must contain at least one entry. `startPhase` performs three independent
	 * uniform draws (with replacement) — one per AI — at phase start.
	 */
	aiGoalPool?: string[];
	initialWorld: WorldState;
	budgetPerAi: number;
	/** Optional win condition. If absent, the phase never auto-advances. */
	winCondition?: WinCondition;
	/** Config for the next phase. Required when winCondition may fire. */
	nextPhaseConfig?: PhaseConfig;
}

export interface PhaseState {
	phaseNumber: 1 | 2 | 3;
	objective: string;
	aiGoals: Record<AiId, string>;
	round: number;
	world: WorldState;
	budgets: Record<AiId, AiBudget>;
	chatHistories: Record<AiId, ChatMessage[]>;
	whispers: WhisperMessage[];
	actionLog: ActionLogEntry[];
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
}

export interface GameState {
	currentPhase: 1 | 2 | 3;
	phases: PhaseState[];
	personas: Record<AiId, AiPersona>;
	isComplete: boolean;
}

export type ToolName = "pick_up" | "put_down" | "give" | "use";

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

export interface RoundResult {
	round: number;
	actions: ActionLogEntry[];
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
