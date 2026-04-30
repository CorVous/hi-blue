import { describe, expect, it } from "vitest";
import { serializeEndgame } from "../endgame";
import {
	advancePhase,
	appendChat,
	appendWhisper,
	createGame,
	startPhase,
} from "../engine";
import type { AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Wants to hold the flower at phase end",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Wants items evenly distributed",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Wants to hold the key at phase end",
		budgetPerPhase: 5,
	},
};

const PHASE_1: PhaseConfig = {
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

describe("serializeEndgame", () => {
	it("includes all three AI personas", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1);
		game = advancePhase(game);
		const save = serializeEndgame(game);
		expect(save.ais).toHaveLength(3);
		expect(save.ais.map((a) => a.id).sort()).toEqual(["blue", "green", "red"]);
	});

	it("includes persona details for each AI", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1);
		game = advancePhase(game);
		const save = serializeEndgame(game);
		const ember = save.ais.find((a) => a.id === "red")!;
		expect(ember.name).toBe("Ember");
		expect(ember.personality).toBe("Fiery and passionate");
	});

	it("includes chat transcripts across all phases", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1);
		game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
		game = appendChat(game, "red", { role: "ai", content: "Hello, player" });
		game = advancePhase(game);
		const save = serializeEndgame(game);
		const ember = save.ais.find((a) => a.id === "red")!;
		expect(ember.transcript).toHaveLength(2);
		expect(ember.transcript[0]?.content).toBe("Hello Ember");
	});

	it("accumulates transcripts across multiple phases", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1);
		game = appendChat(game, "red", { role: "player", content: "Phase 1 msg" });
		game = advancePhase(game, { ...PHASE_1, phaseNumber: 2, objective: "P2" });
		game = appendChat(game, "red", { role: "player", content: "Phase 2 msg" });
		game = advancePhase(game);
		const save = serializeEndgame(game);
		const ember = save.ais.find((a) => a.id === "red")!;
		expect(ember.transcript).toHaveLength(2);
	});

	it("serializes to a JSON string", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1);
		game = advancePhase(game);
		const save = serializeEndgame(game);
		const json = JSON.stringify(save);
		const parsed = JSON.parse(json);
		expect(parsed.ais).toHaveLength(3);
	});

	it("includes phase count", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE_1);
		game = advancePhase(game, { ...PHASE_1, phaseNumber: 2, objective: "P2" });
		game = advancePhase(game);
		const save = serializeEndgame(game);
		expect(save.phasesPlayed).toBe(2);
	});
});
