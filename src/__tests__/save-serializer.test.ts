import { describe, expect, it } from "vitest";
import { GAME_SAVE_VERSION, serializeGameSave } from "../save-serializer";
import { TEST_PERSONAS } from "../spa/game/__tests__/fixtures/make-game-state";
import { makeTestPack } from "../spa/game/__tests__/fixtures/make-test-pack";
import { appendMessage, startGame } from "../spa/game/engine";
import type { GameState } from "../spa/game/types";

function newGame(): GameState {
	return startGame(TEST_PERSONAS, makeTestPack([], { wallName: "wall" }), {
		budgetPerAi: 5,
	});
}

describe("serializeGameSave", () => {
	it("includes each AI's persona in the output", () => {
		const game = newGame();
		const save = serializeGameSave(game);
		expect(save.ais).toHaveLength(3);
		const ids = save.ais.map((a) => a.persona.id);
		expect(ids).toContain("red");
		expect(ids).toContain("green");
		expect(ids).toContain("cyan");
	});

	it("includes persona fields (name, color, blurb, personaGoal)", () => {
		const game = newGame();
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
		let game = newGame();
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
		let game = newGame();
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
		let game = newGame();
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
		const game = newGame();
		const save = serializeGameSave(game);
		const json = JSON.stringify(save);
		const parsed = JSON.parse(json);
		expect(parsed.ais).toHaveLength(3);
	});

	it("stamps the exported GAME_SAVE_VERSION constant, 5 (v5 = facing and horizon landmarks retired, #539)", () => {
		const game = newGame();
		const save = serializeGameSave(game);
		expect(GAME_SAVE_VERSION).toBe(5);
		expect(save.version).toBe(GAME_SAVE_VERSION);
	});

	it("exports neither facing nor landmark fields (ADR 0015)", () => {
		let game = newGame();
		game = appendMessage(game, "blue", "red", "Hello Ember");
		const save = serializeGameSave(game);
		const json = JSON.stringify(save);
		expect(json).not.toMatch(/facing/i);
		expect(json).not.toMatch(/landmark/i);
	});

	it("peer message in green's log only if green is sender or recipient", () => {
		let game = newGame();
		game = appendMessage(game, "red", "cyan", "Our secret");
		const save = serializeGameSave(game);
		const sage = save.ais.find((a) => a.persona.id === "green");
		const greenMessages = sage?.phases[0]?.conversationLog.filter(
			(e) => e.kind === "message",
		);
		expect(greenMessages).toHaveLength(0);
	});
});
