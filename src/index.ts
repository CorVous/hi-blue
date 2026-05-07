export type { DispatchResult, ValidationResult } from "./spa/game/dispatcher";
export {
	dispatchAiTurn,
	executeToolCall,
	validateToolCall,
} from "./spa/game/dispatcher";
export {
	advancePhase,
	advanceRound,
	appendChat,
	appendWhisper,
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
	ChatMessage,
	GameState,
	PhaseConfig,
	PhaseState,
	RoundActionRecord,
	RoundResult,
	ToolCall,
	ToolName,
	ToolResult,
	WhisperMessage,
	WorldItem,
	WorldState,
} from "./spa/game/types";
