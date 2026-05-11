export type { DispatchResult, ValidationResult } from "./spa/game/dispatcher";
export {
	dispatchAiTurn,
	executeToolCall,
	validateToolCall,
} from "./spa/game/dispatcher";
export {
	advancePhase,
	advanceRound,
	appendMessage,
	appendWitnessedEvent,
	createGame,
	deductBudget,
	getActivePhase,
	startPhase,
} from "./spa/game/engine";
export type { AiContext } from "./spa/game/prompt-builder";
export { buildAiContext } from "./spa/game/prompt-builder";
export type {
	AiBudget,
	AiId,
	AiPersona,
	AiTurnAction,
	GameState,
	PhaseConfig,
	PhaseState,
	RoundActionRecord,
	RoundResult,
	ToolCall,
	ToolName,
	ToolResult,
	WorldEntity,
	WorldState,
} from "./spa/game/types";
