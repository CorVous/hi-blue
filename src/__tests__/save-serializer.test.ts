/**
 * Tests for the save-file serializer (issue #19, updated for #195).
 *
 * The serializer takes a completed GameState and produces a deterministic
 * JSON-serializable payload containing:
 * - Each AI's persona
 * - Each AI's per-phase transcript (unified conversationLog including chat,
 *   whispers, and witnessed events, in round order)
 *
 * The payload must be stable for round-tripping.
 */
import { describe, expect, it } from "vitest";
import { serializeGameSave } from "../save-serializer";
import {
	advancePhase,
	appendChat,
	appendWhisperEntry,
	createGame,
	startPhase,
} from "../spa/game/engine";
import type { AiPersona, PhaseConfig } from "../spa/game/types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
		],
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-blue", "ex2-blue", "ex3-blue"],
	},
};

const PHASE1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [1, 1],
	nRange: [1, 1],
	mRange: [0, 0],
	aiGoalPool: [
		"Hold the flower at phase end",
		"Ensure items are evenly distributed",
		"Hold the key at phase end",
	],
	budgetPerAi: 5,
};

const PHASE2_CONFIG: PhaseConfig = {
	...PHASE1_CONFIG,
	phaseNumber: 2,
};

const PHASE3_CONFIG: PhaseConfig = {
	...PHASE1_CONFIG,
	phaseNumber: 3,
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

	it("includes persona fields (name, color, blurb, personaGoal)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.persona.name).toBe("Ember");
		expect(ember?.persona.color).toBe("#e07a5f");
		expect(ember?.persona.blurb).toBe(
			"You are hot-headed and zealous. Hold the flower at phase end.",
		);
		expect(ember?.persona.personaGoal).toBe("Hold the flower at phase end.");
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
		expect(ember?.phases[0]?.conversationLog).toHaveLength(2);
		expect(ember?.phases[0]?.conversationLog[0]).toEqual({
			kind: "chat",
			role: "player",
			content: "Hello Ember",
			round: 0,
		});
	});

	it("includes whispers in the per-phase conversationLog (via per-Daemon log)", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		game = appendWhisperEntry(game, "red", "blue", "Secret plan");
		const save = serializeGameSave(game);
		// Whisper from red appears in red's conversationLog (sender's log also gets the entry)
		const ember = save.ais.find((a) => a.persona.id === "red");
		const redWhispers = ember?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "whisper",
		);
		expect(redWhispers).toHaveLength(1);
		expect(redWhispers?.[0]?.kind === "whisper" && redWhispers[0].content).toBe(
			"Secret plan",
		);
		// No separate `whispers` field — it's all in conversationLog
		expect("whispers" in (ember?.phases[0] ?? {})).toBe(false);
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
		expect(
			ember?.phases[0]?.conversationLog[0]?.kind === "chat" &&
				ember?.phases[0]?.conversationLog[0]?.content,
		).toBe("Phase 1 message");
		expect(
			ember?.phases[1]?.conversationLog[0]?.kind === "chat" &&
				ember?.phases[1]?.conversationLog[0]?.content,
		).toBe("Phase 2 message");
		expect(
			ember?.phases[2]?.conversationLog[0]?.kind === "chat" &&
				ember?.phases[2]?.conversationLog[0]?.content,
		).toBe("Phase 3 message");
	});

	it("produces a serializable (round-trippable) payload", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		const json = JSON.stringify(save);
		const parsed = JSON.parse(json);
		expect(parsed.ais).toHaveLength(3);
	});

	it("output has a version field of 3 (v3 = whispers moved inline into conversationLog)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		const save = serializeGameSave(game);
		expect(save.version).toBe(3);
	});

	it("whisper in green's log only if green is sender or recipient", () => {
		let game = startPhase(createGame(TEST_PERSONAS), PHASE1_CONFIG);
		// Whisper between red and blue — should appear in red and blue, not green
		game = appendWhisperEntry(game, "red", "blue", "Our secret");
		const save = serializeGameSave(game);
		const sage = save.ais.find((a) => a.persona.id === "green");
		const greenWhispers = sage?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "whisper",
		);
		expect(greenWhispers).toHaveLength(0);
	});
});
