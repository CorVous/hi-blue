export type { DispatchResult, ValidationResult } from "./spa/game/dispatcher";
export {
	dispatchAiTurn,
	executeToolCall,
	validateToolCall,
} from "./spa/game/dispatcher";
export {
	advanceRound,
	appendMessage,
	appendWitnessedEvent,
	createGame,
	deductBudget,
	getActivePhase,
	startGame,
} from "./spa/game/engine";
export type { AiContext } from "./spa/game/prompt-builder";
export { buildAiContext } from "./spa/game/prompt-builder";
export type {
	AiBudget,
	AiId,
	AiPersona,
	AiTurnAction,
	GameState,
	Objective,
	PhaseState,
	RoundActionRecord,
	RoundResult,
	ToolCall,
	ToolName,
	ToolResult,
	WorldEntity,
	WorldState,
} from "./spa/game/types";
export {
	checkLoseCondition,
	checkWinCondition,
} from "./spa/game/win-condition";
