import type {
  AiId,
  AiPersona,
  GameState,
  PhaseConfig,
  PhaseState,
  ActionLogEntry,
  ChatMessage,
  WhisperMessage,
  AiBudget,
} from "./types";
import { ALL_AI_IDS } from "./types";

export function updateActivePhase(
  game: GameState,
  updater: (phase: PhaseState) => PhaseState,
): GameState {
  const phases = [...game.phases];
  phases[phases.length - 1] = updater({ ...phases[phases.length - 1] });
  return { ...game, phases };
}

export function createGame(personas: Record<string, AiPersona>): GameState {
  return {
    currentPhase: 1,
    phases: [],
    personas: personas as Record<AiId, AiPersona>,
    isComplete: false,
  };
}

export function startPhase(game: GameState, config: PhaseConfig): GameState {
  const budgets: Record<AiId, AiBudget> = {
    red: { remaining: config.budgetPerAi, total: config.budgetPerAi },
    green: { remaining: config.budgetPerAi, total: config.budgetPerAi },
    blue: { remaining: config.budgetPerAi, total: config.budgetPerAi },
  };

  const chatHistories: Record<AiId, ChatMessage[]> = {
    red: [],
    green: [],
    blue: [],
  };

  const phase: PhaseState = {
    phaseNumber: config.phaseNumber,
    objective: config.objective,
    aiGoals: { ...config.aiGoals },
    round: 0,
    world: structuredClone(config.initialWorld),
    budgets,
    chatHistories,
    whispers: [],
    actionLog: [],
    lockedOut: new Set(),
    chatLockouts: new Set(),
  };

  return {
    ...game,
    currentPhase: config.phaseNumber,
    phases: [...game.phases, phase],
  };
}

export function getActivePhase(game: GameState): PhaseState {
  return game.phases[game.phases.length - 1];
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

export function deductBudget(game: GameState, aiId: AiId): GameState {
  return updateActivePhase(game, (phase) => {
    const remaining = Math.max(0, phase.budgets[aiId].remaining - 1);
    const lockedOut = new Set(phase.lockedOut);
    if (remaining === 0) {
      lockedOut.add(aiId);
    }
    return {
      ...phase,
      budgets: { ...phase.budgets, [aiId]: { ...phase.budgets[aiId], remaining } },
      lockedOut,
    };
  });
}

export function appendActionLog(game: GameState, entry: ActionLogEntry): GameState {
  return updateActivePhase(game, (phase) => ({
    ...phase,
    actionLog: [...phase.actionLog, entry],
  }));
}

export function appendChat(
  game: GameState,
  aiId: AiId,
  message: ChatMessage,
): GameState {
  return updateActivePhase(game, (phase) => ({
    ...phase,
    chatHistories: {
      ...phase.chatHistories,
      [aiId]: [...phase.chatHistories[aiId], message],
    },
  }));
}

export function appendWhisper(game: GameState, whisper: WhisperMessage): GameState {
  return updateActivePhase(game, (phase) => ({
    ...phase,
    whispers: [...phase.whispers, whisper],
  }));
}

export function advancePhase(game: GameState, nextConfig?: PhaseConfig): GameState {
  if (!nextConfig) {
    return { ...game, isComplete: true };
  }

  return startPhase(game, nextConfig);
}

export function addChatLockout(game: GameState, aiId: AiId): GameState {
  return updateActivePhase(game, (phase) => {
    const chatLockouts = new Set(phase.chatLockouts);
    chatLockouts.add(aiId);
    return { ...phase, chatLockouts };
  });
}

export function removeChatLockout(game: GameState, aiId: AiId): GameState {
  return updateActivePhase(game, (phase) => {
    const chatLockouts = new Set(phase.chatLockouts);
    chatLockouts.delete(aiId);
    return { ...phase, chatLockouts };
  });
}

export function isChatLocked(game: GameState, aiId: AiId): boolean {
  const phase = getActivePhase(game);
  return phase.chatLockouts.has(aiId);
}

export function isPhaseComplete(game: GameState): boolean {
  const phase = getActivePhase(game);
  return ALL_AI_IDS.every((id) => phase.lockedOut.has(id));
}

export function processPlayerMessage(
  game: GameState,
  targetAiId: AiId,
  content: string,
): GameState {
  if (isAiLockedOut(game, targetAiId)) {
    throw new Error(`Cannot message ${targetAiId}: AI is locked out (budget exhausted)`);
  }
  if (isChatLocked(game, targetAiId)) {
    throw new Error(`Cannot message ${targetAiId}: chat is locked`);
  }

  let state = appendChat(game, targetAiId, { role: "player", content });
  state = advanceRound(state);
  return state;
}
