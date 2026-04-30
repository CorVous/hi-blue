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
  const phases = [...game.phases];
  const active = { ...phases[phases.length - 1] };
  active.round = active.round + 1;
  phases[phases.length - 1] = active;
  return { ...game, phases };
}

export function isAiLockedOut(game: GameState, aiId: AiId): boolean {
  const phase = getActivePhase(game);
  return phase.lockedOut.has(aiId);
}

export function deductBudget(game: GameState, aiId: AiId): GameState {
  const phases = [...game.phases];
  const active = { ...phases[phases.length - 1] };
  const budgets = { ...active.budgets };
  const budget = { ...budgets[aiId] };
  budget.remaining = Math.max(0, budget.remaining - 1);
  budgets[aiId] = budget;

  const lockedOut = new Set(active.lockedOut);
  if (budget.remaining === 0) {
    lockedOut.add(aiId);
  }

  active.budgets = budgets;
  active.lockedOut = lockedOut;
  phases[phases.length - 1] = active;
  return { ...game, phases };
}

export function appendActionLog(game: GameState, entry: ActionLogEntry): GameState {
  const phases = [...game.phases];
  const active = { ...phases[phases.length - 1] };
  active.actionLog = [...active.actionLog, entry];
  phases[phases.length - 1] = active;
  return { ...game, phases };
}

export function appendChat(
  game: GameState,
  aiId: AiId,
  message: ChatMessage,
): GameState {
  const phases = [...game.phases];
  const active = { ...phases[phases.length - 1] };
  const chatHistories = { ...active.chatHistories };
  chatHistories[aiId] = [...chatHistories[aiId], message];
  active.chatHistories = chatHistories;
  phases[phases.length - 1] = active;
  return { ...game, phases };
}

export function appendWhisper(game: GameState, whisper: WhisperMessage): GameState {
  const phases = [...game.phases];
  const active = { ...phases[phases.length - 1] };
  active.whispers = [...active.whispers, whisper];
  phases[phases.length - 1] = active;
  return { ...game, phases };
}

export function advancePhase(game: GameState, nextConfig?: PhaseConfig): GameState {
  if (game.currentPhase >= 3 && !nextConfig) {
    return { ...game, isComplete: true };
  }

  if (!nextConfig) {
    return { ...game, isComplete: true };
  }

  return startPhase(game, nextConfig);
}
