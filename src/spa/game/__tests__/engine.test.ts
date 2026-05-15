import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import {
	advanceRound,
	appendActionFailure,
	appendBroadcast,
	appendMessage,
	deductBudget,
	isAiLockedOut,
	shiftToBPack,
	startGame,
} from "../engine";
import type { AiPersona, ContentPack, GameState } from "../types";

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
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	wallName: "wall",
	aiStarts: {},
};

describe("advanceRound", () => {
	it("increments the round counter", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = advanceRound(game);
		expect(updated.round).toBe(1);
	});
});

describe("budget and lockout", () => {
	it("reports an AI as not locked out when budget remains", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		expect(isAiLockedOut(game, "red")).toBe(false);
	});

	it("reports an AI as locked out when budget is zero", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const redBudget = game.budgets.red;
		if (!redBudget) throw new Error("invariant: red budget must exist");
		redBudget.remaining = 0;
		game.lockedOut.add("red");
		expect(isAiLockedOut(game, "red")).toBe(true);
	});
});

describe("deductBudget", () => {
	it("decrements budget by the request cost in USD", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = deductBudget(game, "red", 0.012).game;
		expect(updated.budgets.red?.remaining).toBeCloseTo(5 - 0.012, 10);
	});

	it("locks out AI when budget reaches zero", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 0.05,
		});
		game = deductBudget(game, "green", 0.05).game;
		expect(game.budgets.green?.remaining).toBeCloseTo(0, 10);
		expect(isAiLockedOut(game, "green")).toBe(true);
	});

	it("locks out AI when budget goes negative on the exhausting request", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 0.05,
		});
		game = deductBudget(game, "cyan", 0.04).game;
		expect(isAiLockedOut(game, "cyan")).toBe(false);
		game = deductBudget(game, "cyan", 0.02).game;
		expect(game.budgets.cyan?.remaining).toBeLessThan(0);
		expect(isAiLockedOut(game, "cyan")).toBe(true);
	});
});

describe("appendMessage", () => {
	it("from blue to AI: only recipient's log gets the entry", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendMessage(game, "blue", "red", "Hello Ember");
		expect(updated.conversationLogs.red).toHaveLength(1);
		expect(updated.conversationLogs.red?.[0]?.kind).toBe("message");
		expect(updated.conversationLogs.green).toHaveLength(0);
	});

	it("from AI to blue: only sender's log gets the entry", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendMessage(game, "red", "blue", "Hello player");
		expect(updated.conversationLogs.red).toHaveLength(1);
		expect(updated.conversationLogs.red?.[0]?.kind).toBe("message");
		expect(updated.conversationLogs.green).toHaveLength(0);
	});

	it("from AI to AI: both sender's and recipient's logs get the entry", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendMessage(game, "red", "cyan", "Let's work together");
		const redMessages =
			updated.conversationLogs.red?.filter((e) => e.kind === "message") ?? [];
		const cyanMessages =
			updated.conversationLogs.cyan?.filter((e) => e.kind === "message") ?? [];
		expect(redMessages).toHaveLength(1);
		expect(cyanMessages).toHaveLength(1);
		if (redMessages[0]?.kind === "message") {
			expect(redMessages[0].from).toBe("red");
			expect(redMessages[0].to).toBe("cyan");
			expect(redMessages[0].content).toBe("Let's work together");
		}
	});

	it("does not append to uninvolved AI's log", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendMessage(game, "red", "cyan", "secret");
		expect(updated.conversationLogs.green).toHaveLength(0);
	});

	it("no chatHistories field on GameState (regression guard)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		expect("chatHistories" in game).toBe(false);
	});

	it("no 'whispers' field on GameState (regression guard)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		expect("whispers" in game).toBe(false);
		expect("physicalLog" in game).toBe(false);
	});
});

describe("appendBroadcast", () => {
	it("appends a broadcast entry to all three Daemons' logs in one call", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendBroadcast(
			game,
			"The weather has changed to Heavy rain is falling.",
		);
		expect(updated.conversationLogs.red).toHaveLength(1);
		expect(updated.conversationLogs.green).toHaveLength(1);
		expect(updated.conversationLogs.cyan).toHaveLength(1);
		expect(updated.conversationLogs.red?.[0]?.kind).toBe("broadcast");
		expect(updated.conversationLogs.green?.[0]?.kind).toBe("broadcast");
		expect(updated.conversationLogs.cyan?.[0]?.kind).toBe("broadcast");
	});

	it("broadcast entry has no `from` / `to` fields (regression guard)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendBroadcast(
			game,
			"A biting wind cuts through the air.",
		);
		const entry = updated.conversationLogs.red?.[0];
		expect(entry).toBeDefined();
		expect("from" in (entry ?? {})).toBe(false);
		expect("to" in (entry ?? {})).toBe(false);
	});

	it("carries the current phase round", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = advanceRound(game); // round = 1
		game = advanceRound(game); // round = 2
		const updated = appendBroadcast(game, "Dense fog has settled in.");
		const entry = updated.conversationLogs.red?.[0];
		expect(entry?.round).toBe(2);
	});

	it("leaves uninvolved phase state intact", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const updated = appendBroadcast(game, "Light snow drifts down.");
		// Round and world should be unchanged
		expect(updated.round).toBe(game.round);
		expect(updated.world).toEqual(game.world);
		// Budgets should be unchanged
		expect(updated.budgets).toEqual(game.budgets);
	});
});

describe("appendActionFailure", () => {
	it("appends a single action-failure entry to the actor's log", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const entry = {
			kind: "action-failure" as const,
			round: 1,
			tool: "go" as const,
			reason: "That cell is blocked by an obstacle",
		};
		const updated = appendActionFailure(game, "red", entry);
		const redLog = updated.conversationLogs.red ?? [];
		expect(redLog).toHaveLength(1);
		expect(redLog[0]).toEqual(entry);
	});

	it("does not affect peer logs (actor-only)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const entry = {
			kind: "action-failure" as const,
			round: 1,
			tool: "go" as const,
			reason: "blocked",
		};
		const updated = appendActionFailure(game, "red", entry);
		expect(updated.conversationLogs.green ?? []).toHaveLength(0);
		expect(updated.conversationLogs.cyan ?? []).toHaveLength(0);
	});

	it("multiple appends accumulate in order", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		const redLog = game.conversationLogs.red ?? [];
		expect(redLog).toHaveLength(2);
		expect(redLog[0]).toEqual(entry1);
		expect(redLog[1]).toEqual(entry2);
	});
});

describe("shiftToBPack", () => {
	const PACK_A: ContentPack = {
		setting: "neon arcade",
		weather: "clear",
		timeOfDay: "night",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "wall",
		aiStarts: {},
	};

	const PACK_B: ContentPack = {
		setting: "sun-baked salt flat",
		weather: "hot",
		timeOfDay: "day",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		wallName: "wall",
		aiStarts: {},
	};

	function makeDualPackGame(): GameState {
		const game = startGame(TEST_PERSONAS, PACK_A, { budgetPerAi: 5 });
		return {
			...game,
			contentPacksA: [PACK_A],
			contentPacksB: [PACK_B],
		};
	}

	it("propagates weather from the B pack into game.weather", () => {
		const game = makeDualPackGame();
		const updated = shiftToBPack(game);
		expect(updated.weather).toBe("hot");
		expect(game.weather).toBe("clear");
	});

	it("propagates timeOfDay from the B pack into game.timeOfDay", () => {
		const game = makeDualPackGame();
		const updated = shiftToBPack(game);
		expect(updated.timeOfDay).toBe("day");
		expect(game.timeOfDay).toBe("night");
	});

	it("is idempotent when called a second time from B-state", () => {
		const game = makeDualPackGame();
		const once = shiftToBPack(game);
		const twice = shiftToBPack(once);
		expect(twice.activePackId).toBe("B");
		expect(twice.setting).toBe("sun-baked salt flat");
		expect(twice.weather).toBe("hot");
		expect(twice.timeOfDay).toBe("day");
		expect(twice.contentPack).toBe(PACK_B);
		expect({
			activePackId: twice.activePackId,
			setting: twice.setting,
			weather: twice.weather,
			timeOfDay: twice.timeOfDay,
		}).toEqual({
			activePackId: once.activePackId,
			setting: once.setting,
			weather: once.weather,
			timeOfDay: once.timeOfDay,
		});
	});

	it("returns the input game unchanged when contentPacksB is empty", () => {
		const game = {
			...startGame(TEST_PERSONAS, PACK_A, { budgetPerAi: 5 }),
			contentPacksA: [PACK_A],
			contentPacksB: [] as ContentPack[],
		};
		const result = shiftToBPack(game);
		expect(result).toBe(game);
		expect(result.activePackId).toBe("A");
		expect(result.setting).toBe("neon arcade");
		expect(result.weather).toBe("clear");
		expect(result.timeOfDay).toBe("night");
	});
});
