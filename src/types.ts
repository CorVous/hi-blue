export type AiId = "red" | "green" | "blue";

export interface AiPersona {
	id: AiId;
	name: string;
	color: AiId;
	personality: string;
	goal: string;
	budgetPerPhase: number;
	/** In-character line shown when this AI's budget is exhausted (consumed by round-coordinator). */
	budgetExhaustionLine?: string;
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
	aiGoals: Record<AiId, string>;
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
