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
  | { type: "tool_failure"; toolName: string; args: Record<string, string>; reason: string }
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

export interface PhaseConfig {
  phaseNumber: 1 | 2 | 3;
  objective: string;
  aiGoals: Record<AiId, string>;
  initialWorld: WorldState;
  budgetPerAi: number;
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
  lockedOut: Set<AiId>;
  chatLockouts: Set<AiId>;
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
}
