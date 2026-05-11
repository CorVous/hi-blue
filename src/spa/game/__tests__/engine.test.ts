import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import {
	advanceRound,
	appendActionFailure,
	appendMessage,
	createGame,
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	isPlayerChatLockedOut,
	resolveChatLockouts,
	startGame,
	triggerChatLockout,
} from "../engine";
import type { AiPersona } from "../types";

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

// Budget per AI in startGame is $0.50

describe("createGame", () => {
	it("creates a game with the given personas", () => {
		const game = createGame(TEST_PERSONAS);
		expect(game.currentPhase).toBe(1);
		expect(game.isComplete).toBe(false);
		expect(game.personas).toEqual(TEST_PERSONAS);
		expect(game.phases).toHaveLength(0);
	});

	it("creates a game with contentPacks", () => {
		const game = createGame(TEST_PERSONAS, []);
		expect(game.contentPacks).toEqual([]);
	});
});

describe("startGame", () => {
	it("initializes a single game phase with correct budgets and empty histories", () => {
		const game = startGame(TEST_PERSONAS, []);
		const phase = getActivePhase(game);

		expect(phase.phaseNumber).toBe(1);
		expect(phase.round).toBe(0);
		// Budget is $0.50 per AI in startGame
		expect(phase.budgets.red).toEqual({ remaining: 0.5, total: 0.5 });
		expect(phase.budgets.green).toEqual({ remaining: 0.5, total: 0.5 });
		expect(phase.budgets.cyan).toEqual({ remaining: 0.5, total: 0.5 });
		expect(phase.conversationLogs.red).toEqual([]);
		expect(phase.conversationLogs.green).toEqual([]);
		expect(phase.conversationLogs.cyan).toEqual([]);
		expect("whispers" in phase).toBe(false);
		expect(phase.lockedOut.size).toBe(0);
		// No entities because no content pack was provided
		expect(phase.world.entities).toHaveLength(0);
	});

	it("creates a single phase (no multi-phase chain)", () => {
		const game = startGame(TEST_PERSONAS, []);
		expect(game.phases).toHaveLength(1);
		expect(game.currentPhase).toBe(1);
	});

	it("game.objectives starts empty", () => {
		const game = startGame(TEST_PERSONAS, []);
		expect(game.objectives).toEqual([]);
	});

	it("assigns distinct positions to all AIs (fallback spatial placement)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const phase = getActivePhase(game);
		const positions = Object.values(phase.personaSpatial).map(
			(s) => s.position,
		);
		const keys = positions.map((p) => `${p.row},${p.col}`);
		// All positions must be distinct
		expect(new Set(keys).size).toBe(positions.length);
	});

	it("with rng=()=>0, AIs are placed at (0,0), (0,1), (0,2) all facing north (fallback)", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const phase = getActivePhase(game);
		// aiIds order is [red, green, cyan] (Object.keys order)
		expect(phase.personaSpatial.red?.position).toEqual({ row: 0, col: 0 });
		expect(phase.personaSpatial.green?.position).toEqual({ row: 0, col: 1 });
		expect(phase.personaSpatial.cyan?.position).toEqual({ row: 0, col: 2 });
		expect(phase.personaSpatial.red?.facing).toBe("north");
		expect(phase.personaSpatial.green?.facing).toBe("north");
		expect(phase.personaSpatial.cyan?.facing).toBe("north");
	});

	it("uses aiStarts from ContentPack when a matching pack is present", () => {
		const pack = {
			phaseNumber: 1 as const,
			setting: "abandoned subway station",
			weather: "drizzling",
			timeOfDay: "dusk",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 3, col: 3 }, facing: "east" as const },
				green: { position: { row: 2, col: 2 }, facing: "south" as const },
				cyan: { position: { row: 1, col: 1 }, facing: "west" as const },
			},
		};
		const game = startGame(TEST_PERSONAS, [pack]);
		const phase = getActivePhase(game);

		expect(phase.personaSpatial.red?.position).toEqual({ row: 3, col: 3 });
		expect(phase.personaSpatial.red?.facing).toBe("east");
		expect(phase.setting).toBe("abandoned subway station");
		expect(game.weather).toBe("drizzling");
	});
});

describe("advanceRound", () => {
	it("increments the round counter", () => {
		const game = startGame(TEST_PERSONAS, []);
		const updated = advanceRound(game);
		expect(getActivePhase(updated).round).toBe(1);
	});
});

describe("budget and lockout", () => {
	it("reports an AI as not locked out when budget remains", () => {
		const game = startGame(TEST_PERSONAS, []);
		expect(isAiLockedOut(game, "red")).toBe(false);
	});

	it("reports an AI as locked out when budget is zero", () => {
		const game = startGame(TEST_PERSONAS, []);
		const phase = getActivePhase(game);
		const redBudget = phase.budgets.red;
		if (!redBudget) throw new Error("invariant: red budget must exist");
		redBudget.remaining = 0;
		phase.lockedOut.add("red");
		expect(isAiLockedOut(game, "red")).toBe(true);
	});
});

describe("deductBudget", () => {
	it("decrements budget by the request cost in USD", () => {
		const game = startGame(TEST_PERSONAS, []);
		const updated = deductBudget(game, "red", 0.012);
		expect(getActivePhase(updated).budgets.red?.remaining).toBeCloseTo(
			0.5 - 0.012,
			10,
		);
	});

	it("locks out AI when budget reaches zero", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = deductBudget(game, "green", 0.5);
		expect(getActivePhase(game).budgets.green?.remaining).toBeCloseTo(0, 10);
		expect(isAiLockedOut(game, "green")).toBe(true);
	});

	it("locks out AI when budget goes negative on the exhausting request", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = deductBudget(game, "cyan", 0.4);
		expect(isAiLockedOut(game, "cyan")).toBe(false);
		game = deductBudget(game, "cyan", 0.2);
		expect(getActivePhase(game).budgets.cyan?.remaining).toBeLessThan(0);
		expect(isAiLockedOut(game, "cyan")).toBe(true);
	});
});

describe("appendMessage", () => {
	it("from blue to AI: only recipient's log gets the entry", () => {
		const game = startGame(TEST_PERSONAS, []);
		const updated = appendMessage(game, "blue", "red", "Hello Ember");
		const phase = getActivePhase(updated);
		expect(phase.conversationLogs.red).toHaveLength(1);
		expect(phase.conversationLogs.red?.[0]?.kind).toBe("message");
		expect(phase.conversationLogs.green).toHaveLength(0);
	});

	it("from AI to blue: only sender's log gets the entry", () => {
		const game = startGame(TEST_PERSONAS, []);
		const updated = appendMessage(game, "red", "blue", "Hello player");
		const phase = getActivePhase(updated);
		expect(phase.conversationLogs.red).toHaveLength(1);
		expect(phase.conversationLogs.red?.[0]?.kind).toBe("message");
		expect(phase.conversationLogs.green).toHaveLength(0);
	});

	it("from AI to AI: both sender's and recipient's logs get the entry", () => {
		const game = startGame(TEST_PERSONAS, []);
		const updated = appendMessage(game, "red", "cyan", "Let's work together");
		const phase = getActivePhase(updated);
		const redMessages =
			phase.conversationLogs.red?.filter((e) => e.kind === "message") ?? [];
		const cyanMessages =
			phase.conversationLogs.cyan?.filter((e) => e.kind === "message") ?? [];
		expect(redMessages).toHaveLength(1);
		expect(cyanMessages).toHaveLength(1);
		if (redMessages[0]?.kind === "message") {
			expect(redMessages[0].from).toBe("red");
			expect(redMessages[0].to).toBe("cyan");
			expect(redMessages[0].content).toBe("Let's work together");
		}
	});

	it("does not append to uninvolved AI's log", () => {
		const game = startGame(TEST_PERSONAS, []);
		const updated = appendMessage(game, "red", "cyan", "secret");
		const phase = getActivePhase(updated);
		expect(phase.conversationLogs.green).toHaveLength(0);
	});

	it("no chatHistories field on PhaseState (regression guard)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const phase = getActivePhase(game);
		expect("chatHistories" in phase).toBe(false);
	});

	it("no 'whispers' field on PhaseState (regression guard)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const phase = getActivePhase(game);
		expect("whispers" in phase).toBe(false);
		expect("physicalLog" in phase).toBe(false);
	});
});

describe("chat lockout", () => {
	it("startGame initialises chatLockouts as empty", () => {
		const game = startGame(TEST_PERSONAS, []);
		const phase = getActivePhase(game);
		expect(phase.chatLockouts.size).toBe(0);
	});

	it("isPlayerChatLockedOut returns false when no lockout active", () => {
		const game = startGame(TEST_PERSONAS, []);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false);
	});

	it("triggerChatLockout marks the AI as player-chat-locked", () => {
		const game = startGame(TEST_PERSONAS, []);
		const locked = triggerChatLockout(game, "green", 3); // resolves at round 3
		expect(isPlayerChatLockedOut(locked, "green")).toBe(true);
		// Budget-lockout should remain unaffected
		expect(isAiLockedOut(locked, "green")).toBe(false);
	});

	it("triggerChatLockout does not affect other AIs", () => {
		const game = startGame(TEST_PERSONAS, []);
		const locked = triggerChatLockout(game, "cyan", 2);
		expect(isPlayerChatLockedOut(locked, "red")).toBe(false);
		expect(isPlayerChatLockedOut(locked, "green")).toBe(false);
	});

	it("resolveChatLockouts removes lockouts where resolveAtRound <= current round", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = triggerChatLockout(game, "red", 2); // resolves at round 2
		// Advance round to 1 — not yet at resolveAtRound
		game = advanceRound(game); // round = 1
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(true); // still locked

		// Advance to round 2 — now at resolveAtRound
		game = advanceRound(game); // round = 2
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false); // resolved
	});

	it("resolveChatLockouts only removes expired lockouts, leaving others intact", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = triggerChatLockout(game, "red", 1); // expires at round 1
		game = triggerChatLockout(game, "green", 5); // expires at round 5
		game = advanceRound(game); // round = 1
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false); // expired
		expect(isPlayerChatLockedOut(game, "green")).toBe(true); // still active
	});

	it("chat lockout is independent from budget lockout — locked-out AI can still act (budget untouched)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const locked = triggerChatLockout(game, "cyan", 3);
		// Budget lockout (isAiLockedOut) must remain false — AI can still take turns
		expect(isAiLockedOut(locked, "cyan")).toBe(false);
		// Budget unaffected
		expect(getActivePhase(locked).budgets.cyan?.remaining).toBe(0.5);
	});
});

describe("appendActionFailure", () => {
	it("appends a single action-failure entry to the actor's log", () => {
		const game = startGame(TEST_PERSONAS, []);
		const entry = {
			kind: "action-failure" as const,
			round: 1,
			tool: "go" as const,
			reason: "That cell is blocked by an obstacle",
		};
		const updated = appendActionFailure(game, "red", entry);
		const phase = getActivePhase(updated);
		const redLog = phase.conversationLogs.red ?? [];
		expect(redLog).toHaveLength(1);
		expect(redLog[0]).toEqual(entry);
	});

	it("does not affect peer logs (actor-only)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const entry = {
			kind: "action-failure" as const,
			round: 1,
			tool: "go" as const,
			reason: "blocked",
		};
		const updated = appendActionFailure(game, "red", entry);
		const phase = getActivePhase(updated);
		expect(phase.conversationLogs.green ?? []).toHaveLength(0);
		expect(phase.conversationLogs.cyan ?? []).toHaveLength(0);
	});

	it("multiple appends accumulate in order", () => {
		let game = startGame(TEST_PERSONAS, []);
		const entry1 = {
			kind: "action-failure" as const,
			round: 1,
			tool: "go" as const,
			reason: "first",
		};
		const entry2 = {
			kind: "action-failure" as const,
			round: 2,
			tool: "look" as const,
			reason: "second",
		};
		game = appendActionFailure(game, "red", entry1);
		game = appendActionFailure(game, "red", entry2);
		const redLog = getActivePhase(game).conversationLogs.red ?? [];
		expect(redLog).toHaveLength(2);
		expect(redLog[0]).toEqual(entry1);
		expect(redLog[1]).toEqual(entry2);
	});
});
