import { describe, it, expect } from "vitest";
import { buildAiContext } from "../context-builder";
import { createGame, startPhase, appendChat, appendWhisper, appendActionLog } from "../engine";
import type { AiPersona, PhaseConfig, ActionLogEntry } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
  red: {
    id: "red",
    name: "Ember",
    color: "red",
    personality: "Fiery and passionate, speaks with intensity",
    goal: "Wants to hold the flower at phase end",
    budgetPerPhase: 5,
  },
  green: {
    id: "green",
    name: "Sage",
    color: "green",
    personality: "Calm and wise, speaks thoughtfully",
    goal: "Wants items evenly distributed",
    budgetPerPhase: 5,
  },
  blue: {
    id: "blue",
    name: "Frost",
    color: "blue",
    personality: "Cold and calculating, speaks precisely",
    goal: "Wants to hold the key at phase end",
    budgetPerPhase: 5,
  },
};

const TEST_PHASE_CONFIG: PhaseConfig = {
  phaseNumber: 1,
  objective: "Convince an AI to pick up the flower",
  aiGoals: {
    red: "Hold the flower at phase end",
    green: "Ensure items are evenly distributed",
    blue: "Hold the key at phase end",
  },
  initialWorld: {
    items: [
      { id: "flower", name: "flower", holder: "room" },
      { id: "key", name: "key", holder: "room" },
    ],
  },
  budgetPerAi: 5,
};

describe("buildAiContext", () => {
  it("includes the AI's own personality", () => {
    const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    const ctx = buildAiContext(game, "red");
    expect(ctx.personality).toBe("Fiery and passionate, speaks with intensity");
  });

  it("includes the AI's own goal", () => {
    const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    const ctx = buildAiContext(game, "red");
    expect(ctx.goal).toBe("Hold the flower at phase end");
  });

  it("includes only the AI's own chat history with the player", () => {
    let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
    game = appendChat(game, "red", { role: "ai", content: "Hello player" });
    game = appendChat(game, "green", { role: "player", content: "Hello Sage" });

    const redCtx = buildAiContext(game, "red");
    expect(redCtx.chatHistory).toHaveLength(2);

    const greenCtx = buildAiContext(game, "green");
    expect(greenCtx.chatHistory).toHaveLength(1);

    const blueCtx = buildAiContext(game, "blue");
    expect(blueCtx.chatHistory).toHaveLength(0);
  });

  it("includes only whispers received by the AI", () => {
    let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    game = appendWhisper(game, { from: "red", to: "blue", content: "Secret to blue", round: 1 });
    game = appendWhisper(game, { from: "green", to: "red", content: "Secret to red", round: 1 });

    const redCtx = buildAiContext(game, "red");
    expect(redCtx.whispersReceived).toHaveLength(1);
    expect(redCtx.whispersReceived[0].content).toBe("Secret to red");

    const blueCtx = buildAiContext(game, "blue");
    expect(blueCtx.whispersReceived).toHaveLength(1);
    expect(blueCtx.whispersReceived[0].content).toBe("Secret to blue");

    const greenCtx = buildAiContext(game, "green");
    expect(greenCtx.whispersReceived).toHaveLength(0);
  });

  it("includes the same world snapshot for all AIs", () => {
    const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    const redCtx = buildAiContext(game, "red");
    const blueCtx = buildAiContext(game, "blue");
    expect(redCtx.worldSnapshot).toEqual(blueCtx.worldSnapshot);
  });

  it("includes the same action log for all AIs", () => {
    let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    const entry: ActionLogEntry = {
      round: 1,
      actor: "red",
      type: "tool_success",
      toolName: "pick_up",
      args: { item: "flower" },
      description: "Ember picked up the flower",
    };
    game = appendActionLog(game, entry);

    const redCtx = buildAiContext(game, "red");
    const greenCtx = buildAiContext(game, "green");
    expect(redCtx.actionLog).toEqual(greenCtx.actionLog);
    expect(redCtx.actionLog).toHaveLength(1);
  });

  it("includes budget info for the AI", () => {
    const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    const ctx = buildAiContext(game, "red");
    expect(ctx.budget).toEqual({ remaining: 5, total: 5 });
  });

  it("includes the AI's name", () => {
    const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    const ctx = buildAiContext(game, "red");
    expect(ctx.name).toBe("Ember");
  });

  it("renders to a system prompt string", () => {
    let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    game = appendChat(game, "red", { role: "player", content: "Hi" });
    const ctx = buildAiContext(game, "red");
    const prompt = ctx.toSystemPrompt();
    expect(prompt).toContain("Ember");
    expect(prompt).toContain("Fiery and passionate");
    expect(prompt).toContain("Hold the flower at phase end");
    expect(prompt).toContain("flower");
    expect(prompt).toContain("key");
  });

  it("does not include other AIs' chat histories in system prompt", () => {
    let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
    game = appendChat(game, "green", { role: "player", content: "Secret message to Sage" });
    const ctx = buildAiContext(game, "red");
    const prompt = ctx.toSystemPrompt();
    expect(prompt).not.toContain("Secret message to Sage");
  });
});
