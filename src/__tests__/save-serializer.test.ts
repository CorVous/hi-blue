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
import { DEFAULT_LANDMARKS } from "../spa/game/direction";
import { appendMessage, startGame } from "../spa/game/engine";
import type { AiPersona, ContentPack } from "../spa/game/types";

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
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
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
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: {},
};

describe("serializeGameSave", () => {
	it("includes each AI's persona in the output", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const save = serializeGameSave(game);
		expect(save.ais).toHaveLength(3);
		const ids = save.ais.map((a) => a.persona.id);
		expect(ids).toContain("red");
		expect(ids).toContain("green");
		expect(ids).toContain("cyan");
	});

	it("includes persona fields (name, color, blurb, personaGoal)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.persona.name).toBe("Ember");
		expect(ember?.persona.color).toBe("#e07a5f");
		expect(ember?.persona.blurb).toBe(
			"Ember is hot-headed and zealous. Hold the flower at phase end.",
		);
		expect(ember?.persona.personaGoal).toBe("Hold the flower at phase end.");
	});

	it("includes the per-phase transcript for each AI", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "blue", "red", "Hello Ember");
		game = appendMessage(game, "red", "blue", "Greetings, player");
		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		expect(ember?.phases).toHaveLength(1);
		expect(ember?.phases[0]?.phaseNumber).toBe(1);
		expect(ember?.phases[0]?.conversationLog).toHaveLength(2);
		expect(ember?.phases[0]?.conversationLog[0]).toEqual({
			kind: "message",
			from: "blue",
			to: "red",
			content: "Hello Ember",
			round: 0,
		});
	});

	it("includes peer messages in the per-phase conversationLog (via per-Daemon log)", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "red", "cyan", "Secret plan");
		const save = serializeGameSave(game);
		// Message from red appears in red's conversationLog (sender's log gets the entry)
		const ember = save.ais.find((a) => a.persona.id === "red");
		const redMessages = ember?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "message",
		);
		expect(redMessages).toHaveLength(1);
		expect(redMessages?.[0]?.kind === "message" && redMessages[0].content).toBe(
			"Secret plan",
		);
		// No separate `whispers` field — it's all in conversationLog
		expect("whispers" in (ember?.phases[0] ?? {})).toBe(false);
	});

	it("accumulates transcripts in a single phase (flat model, #295)", () => {
		// In the flat single-game model (issue #295), all conversation accumulates
		// in one phase.
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "blue", "red", "Message 1");
		game = appendMessage(game, "blue", "red", "Message 2");
		game = appendMessage(game, "blue", "red", "Message 3");
		game = { ...game, isComplete: true };

		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
		// Flat model: single phase with all messages accumulated
		expect(ember?.phases).toHaveLength(1);
		expect(ember?.phases[0]?.phaseNumber).toBe(1);
		expect(ember?.phases[0]?.conversationLog).toHaveLength(3);
		expect(
			ember?.phases[0]?.conversationLog[0]?.kind === "message" &&
				ember?.phases[0]?.conversationLog[0]?.content,
		).toBe("Message 1");
		expect(
			ember?.phases[0]?.conversationLog[1]?.kind === "message" &&
				ember?.phases[0]?.conversationLog[1]?.content,
		).toBe("Message 2");
		expect(
			ember?.phases[0]?.conversationLog[2]?.kind === "message" &&
				ember?.phases[0]?.conversationLog[2]?.content,
		).toBe("Message 3");
	});

	it("produces a serializable (round-trippable) payload", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const save = serializeGameSave(game);
		const json = JSON.stringify(save);
		const parsed = JSON.parse(json);
		expect(parsed.ais).toHaveLength(3);
	});

	it("output has a version field of 4 (v4 = chat/whisper collapsed into message primitive)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const save = serializeGameSave(game);
		expect(save.version).toBe(4);
	});

	it("peer message in green's log only if green is sender or recipient", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		// Message between red and cyan — should appear in red and cyan, not green
		game = appendMessage(game, "red", "cyan", "Our secret");
		const save = serializeGameSave(game);
		const sage = save.ais.find((a) => a.persona.id === "green");
		const greenMessages = sage?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "message",
		);
		expect(greenMessages).toHaveLength(0);
	});
});
