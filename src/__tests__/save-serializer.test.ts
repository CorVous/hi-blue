import { describe, expect, it } from "vitest";
import { GAME_SAVE_VERSION, serializeGameSave } from "../save-serializer";
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
	setting: "",
	weather: "",
	timeOfDay: "",
	entities: [],
	wallName: "wall",
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
		const ember = save.ais.find((a) => a.persona.id === "red");
		const redMessages = ember?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "message",
		);
		expect(redMessages).toHaveLength(1);
		expect(redMessages?.[0]?.kind === "message" && redMessages[0].content).toBe(
			"Secret plan",
		);
		expect("whispers" in (ember?.phases[0] ?? {})).toBe(false);
	});

	it("accumulates transcripts in a single phase (flat model, #295)", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "blue", "red", "Message 1");
		game = appendMessage(game, "blue", "red", "Message 2");
		game = appendMessage(game, "blue", "red", "Message 3");
		game = { ...game, isComplete: true };

		const save = serializeGameSave(game);
		const ember = save.ais.find((a) => a.persona.id === "red");
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

	it("output has a version field of 5 (v5 = facing and horizon landmarks retired, #539)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const save = serializeGameSave(game);
		expect(save.version).toBe(5);
	});

	it("stamps the exported GAME_SAVE_VERSION constant", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const save = serializeGameSave(game);
		expect(GAME_SAVE_VERSION).toBe(5);
		expect(save.version).toBe(GAME_SAVE_VERSION);
	});

	it("exports neither facing nor landmark fields (ADR 0015)", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		game = appendMessage(game, "blue", "red", "Hello Ember");
		const save = serializeGameSave(game);
		const json = JSON.stringify(save);
		expect(json).not.toMatch(/facing/i);
		expect(json).not.toMatch(/landmark/i);

		const seenKeys = new Set<string>();
		const collectNestedKeys = (value: unknown): void => {
			if (Array.isArray(value)) {
				for (const item of value) collectNestedKeys(item);
				return;
			}
			if (value && typeof value === "object") {
				for (const [key, nested] of Object.entries(value)) {
					seenKeys.add(key);
					collectNestedKeys(nested);
				}
			}
		};
		collectNestedKeys(save);
		for (const key of seenKeys) {
			expect(key).not.toMatch(/facing/i);
			expect(key).not.toMatch(/landmark/i);
		}
	});

	it("peer message in green's log only if green is sender or recipient", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "red", "cyan", "Our secret");
		const save = serializeGameSave(game);
		const sage = save.ais.find((a) => a.persona.id === "green");
		const greenMessages = sage?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "message",
		);
		expect(greenMessages).toHaveLength(0);
	});
});
