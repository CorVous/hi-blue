export type {
  AiId,
  AiPersona,
  WorldItem,
  WorldState,
  ActionLogEntry,
  ChatMessage,
  WhisperMessage,
  AiBudget,
  PhaseConfig,
  PhaseState,
  GameState,
  ToolName,
  ToolCall,
  ToolResult,
  AiTurnAction,
  RoundResult,
} from "./types";

export {
  createGame,
  startPhase,
  getActivePhase,
  advanceRound,
  advancePhase,
  deductBudget,
  appendActionLog,
  appendChat,
  appendWhisper,
} from "./engine";

export {
  validateToolCall,
  executeToolCall,
  dispatchAiTurn,
} from "./dispatcher";
export type { ValidationResult, DispatchResult } from "./dispatcher";

export { buildAiContext } from "./context-builder";
export type { AiContext } from "./context-builder";
