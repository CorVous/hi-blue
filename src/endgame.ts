import type { AiId, GameState, ChatMessage } from "./types";

export interface AiSaveData {
  id: AiId;
  name: string;
  personality: string;
  transcript: ChatMessage[];
}

export interface EndgameSave {
  ais: AiSaveData[];
  phasesPlayed: number;
}

const ALL_AI_IDS: AiId[] = ["red", "green", "blue"];

export function serializeEndgame(game: GameState): EndgameSave {
  const ais: AiSaveData[] = ALL_AI_IDS.map((id) => {
    const persona = game.personas[id];
    const transcript: ChatMessage[] = [];
    for (const phase of game.phases) {
      transcript.push(...phase.chatHistories[id]);
    }
    return {
      id,
      name: persona.name,
      personality: persona.personality,
      transcript,
    };
  });

  return {
    ais,
    phasesPlayed: game.phases.length,
  };
}
