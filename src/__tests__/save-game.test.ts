/**
 * Tests for serializeGame — pure serialization of game state to a saveable string.
 * Runs under jsdom (browser project), but has no DOM dependencies.
 */
import { describe, expect, it } from "vitest";
import { serializeGame } from "../save-game.js";
import type { AiPersona, GameState, PhaseState } from "../types";

function makePersona(id: "red" | "green" | "blue"): AiPersona {
	return {
		id,
		name: id === "red" ? "Ember" : id === "green" ? "Sage" : "Frost",
		color: id,
		personality: `${id}-personality`,
		goal: `${id}-goal`,
		budgetPerPhase: 100,
	};
}

function makePhase(phaseNumber: 1 | 2 | 3): PhaseState {
	return {
		phaseNumber,
		objective: `Phase ${phaseNumber} objective`,
		aiGoals: { red: "red-goal", green: "green-goal", blue: "blue-goal" },
		round: 2,
		world: { items: [] },
		budgets: {
			red: { remaining: 80, total: 100 },
			green: { remaining: 70, total: 100 },
			blue: { remaining: 60, total: 100 },
		},
		chatHistories: {
			red: [
				{ role: "player", content: `Phase ${phaseNumber} player to red` },
				{ role: "ai", content: `Phase ${phaseNumber} red reply` },
			],
			green: [
				{ role: "player", content: `Phase ${phaseNumber} player to green` },
			],
			blue: [],
		},
		whispers: [
			{
				from: "red",
				to: "green",
				content: `Phase ${phaseNumber} whisper`,
				round: 1,
			},
		],
		actionLog: [
			{
				round: 1,
				actor: "red",
				type: "pass",
				description: "Ember passed",
			},
		],
		lockedOut: new Set(),
	};
}

function makeGameState(): GameState {
	return {
		currentPhase: 3,
		phases: [makePhase(1), makePhase(2), makePhase(3)],
		personas: {
			red: makePersona("red"),
			green: makePersona("green"),
			blue: makePersona("blue"),
		},
		isComplete: true,
	};
}

describe("serializeGame", () => {
	it("returns valid JSON", () => {
		const game = makeGameState();
		const result = serializeGame(game, new Date("2026-04-30T12:00:00.000Z"));
		expect(() => JSON.parse(result)).not.toThrow();
	});

	it("serialized envelope has version 1", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		expect(parsed.version).toBe(1);
	});

	it("serialized envelope has savedAt from the provided timestamp", () => {
		const game = makeGameState();
		const now = new Date("2026-04-30T12:34:56.000Z");
		const parsed = JSON.parse(serializeGame(game, now));
		expect(parsed.savedAt).toBe("2026-04-30T12:34:56.000Z");
	});

	it("includes all three AI keys in the ais object", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		expect(Object.keys(parsed.ais).sort()).toEqual(["blue", "green", "red"]);
	});

	it("each AI entry includes the persona", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		expect(parsed.ais.red.persona).toEqual(game.personas.red);
		expect(parsed.ais.green.persona).toEqual(game.personas.green);
		expect(parsed.ais.blue.persona).toEqual(game.personas.blue);
	});

	it("each AI transcript has one entry per phase", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		expect(parsed.ais.red.transcript.length).toBe(3);
		expect(parsed.ais.green.transcript.length).toBe(3);
		expect(parsed.ais.blue.transcript.length).toBe(3);
	});

	it("transcript entries have phase number, chat history, and whispers", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		const redPhase1 = parsed.ais.red.transcript[0];
		expect(redPhase1.phase).toBe(1);
		expect(redPhase1.chat).toEqual([
			{ role: "player", content: "Phase 1 player to red" },
			{ role: "ai", content: "Phase 1 red reply" },
		]);
	});

	it("transcript includes whispers received by each AI", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		// In phase 1, red whispers to green — green should see it as received
		const greenPhase1 = parsed.ais.green.transcript[0];
		expect(greenPhase1.whispers_received.length).toBeGreaterThan(0);
		expect(greenPhase1.whispers_received[0].from).toBe("red");
	});

	it("whispers not addressed to an AI do not appear in that AI's transcript", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		// Red whispered to green, so red and blue should have no whispers_received in phase 1
		const redPhase1 = parsed.ais.red.transcript[0];
		expect(redPhase1.whispers_received).toEqual([]);
	});

	it("is deterministic — same input produces same output", () => {
		const game = makeGameState();
		const now = new Date("2026-04-30T12:00:00.000Z");
		expect(serializeGame(game, now)).toBe(serializeGame(game, now));
	});

	it("does not include the action log in per-AI transcript entries", () => {
		const game = makeGameState();
		const parsed = JSON.parse(
			serializeGame(game, new Date("2026-04-30T12:00:00.000Z")),
		);
		// Action log is a shared concern; per-AI transcripts should not contain it
		const redPhase1 = parsed.ais.red.transcript[0];
		expect(redPhase1).not.toHaveProperty("actionLog");
		expect(redPhase1).not.toHaveProperty("action_log");
	});
});
