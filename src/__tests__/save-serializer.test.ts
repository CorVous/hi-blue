/**
 * Tests for the save-file serializer (issue #19).
 *
 * The serializer takes a completed GameState and produces a deterministic
 * JSON-serializable payload containing:
 * - Each AI's persona
 * - Each AI's per-phase transcript (chat history + whispers, in round order)
 *
 * The payload must be stable for round-tripping.
 */
import { describe, expect, it } from "vitest";
import { serializeGameSave } from "../save-serializer";
import {
	advancePhase,
	appendChat,
	appendWhisper,
	createGame,
	startPhase,
} from "../spa/game/engine";
import type { AiPersona, PhaseConfig } from "../spa/game/types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Hold the flower at phase end",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Ensure items are evenly distributed",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Hold the key at phase end",
		budgetPerPhase: 5,
	},
};

const PHASE1_CONFIG: PhaseConfig = {
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

const PHASE2_CONFIG: PhaseConfig = {
	...PHASE1_CONFIG,
	phaseNumber: 2,
	objective: "Phase 2 objective",
};

const PHASE3_CONFIG: PhaseConfig = {
	...PHASE1_CONFIG,
	phaseNumber: 3,
	objective: "Phase 3 final objective",
};

describe("serializeGameSave", () => {
	it("includes each AI's persona in the output", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		expect(save.ais).toHaveLength(3);
		const ids = save.ais.map((a) => a.persona.id);
		expect(ids).toContain("red");
		expect(ids).toContain("green");
		expect(ids).toContain("blue");
	});

	it("includes persona fields (name, color, personality, goal)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.persona.name).toBe("Ember");
		expect(ember?.persona.color).toBe("red");
		expect(ember?.persona.personality).toBe("Fiery and passionate");
		expect(ember?.persona.goal).toBe("Hold the flower at phase end");
	});

	it("includes the per-phase transcript for each AI", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
		game = appendChat(game, "red", {
			role: "ai",
			content: "Greetings, player",
		});
		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.phases).toHaveLength(1);
		expect(ember?.phases[0]?.phaseNumber).toBe(1);
		expect(ember?.phases[0]?.chatHistory).toHaveLength(2);
		expect(ember?.phases[0]?.chatHistory[0]).toEqual({
			role: "player",
			content: "Hello Ember",
		});
	});

	it("includes whispers in the per-phase transcript", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		game = appendWhisper(game, {
			from: "red",
			to: "blue",
			content: "Secret plan",
			round: 1,
		});
		const save = serializeGameSave(game);
		// Whispers from/to an AI appear in their respective transcripts
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.phases[0]?.whispers).toHaveLength(1);
		expect(ember?.phases[0]?.whispers[0]?.content).toBe("Secret plan");
	});

	it("accumulates transcripts across multiple phases", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		game = appendChat(game, "red", {
			role: "player",
			content: "Phase 1 message",
		});
		game = advancePhase(game, PHASE2_CONFIG);
		game = appendChat(game, "red", {
			role: "player",
			content: "Phase 2 message",
		});
		game = advancePhase(game, PHASE3_CONFIG);
		game = appendChat(game, "red", {
			role: "player",
			content: "Phase 3 message",
		});
		game = advancePhase(game); // complete

		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.phases).toHaveLength(3);
		expect(ember?.phases[0]?.phaseNumber).toBe(1);
		expect(ember?.phases[1]?.phaseNumber).toBe(2);
		expect(ember?.phases[2]?.phaseNumber).toBe(3);
		expect(ember?.phases[0]?.chatHistory[0]?.content).toBe("Phase 1 message");
		expect(ember?.phases[1]?.chatHistory[0]?.content).toBe("Phase 2 message");
		expect(ember?.phases[2]?.chatHistory[0]?.content).toBe("Phase 3 message");
	});

	it("produces a serializable (round-trippable) payload", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		const json = JSON.stringify(save);
		const parsed = JSON.parse(json);
		expect(parsed.ais).toHaveLength(3);
	});

	it("output has a version field for forward compatibility", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		expect(save.version).toBe(1);
	});

	it("whispers in one AI's phase include only whispers that involve that AI", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		// Whisper between red and blue — should appear in both red and blue, not green
		game = appendWhisper(game, {
			from: "red",
			to: "blue",
			content: "Our secret",
			round: 1,
		});
		const save = serializeGameSave(game);
		const sage = save.ais.find((a) => a.persona.id === "green");
		expect(sage?.phases[0]?.whispers).toHaveLength(0);
	});
});
