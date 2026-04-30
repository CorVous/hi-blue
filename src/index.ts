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
export { ALL_AI_IDS } from "./types";

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
  addChatLockout,
  removeChatLockout,
  isChatLocked,
  isPhaseComplete,
  processPlayerMessage,
} from "./engine";

export {
  validateToolCall,
  executeToolCall,
  dispatchAiTurn,
  processRound,
} from "./dispatcher";
export type { ValidationResult, DispatchResult, ProcessRoundResult } from "./dispatcher";

export { buildAiContext } from "./context-builder";
export type { AiContext } from "./context-builder";

export { serializeEndgame } from "./endgame";
export type { AiSaveData, EndgameSave } from "./endgame";
