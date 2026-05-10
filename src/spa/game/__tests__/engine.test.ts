import { describe, expect, it } from "vitest";
import {
	advancePhase,
	advanceRound,
	appendChat,
	appendWhisperEntry,
	createGame,
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	isPlayerChatLockedOut,
	resolveChatLockouts,
	startPhase,
	triggerChatLockout,
} from "../engine";
import type { AiPersona, PhaseConfig } from "../types";

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
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
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

describe("startPhase", () => {
	it("initializes a phase with correct budgets and empty histories", () => {
		const game = createGame(TEST_PERSONAS);
		const updated = startPhase(game, TEST_PHASE_CONFIG);
		const phase = getActivePhase(updated);

		expect(phase.phaseNumber).toBe(1);
		expect(phase.round).toBe(0);
		expect(phase.budgets.red).toEqual({ remaining: 5, total: 5 });
		expect(phase.budgets.green).toEqual({ remaining: 5, total: 5 });
		expect(phase.budgets.cyan).toEqual({ remaining: 5, total: 5 });
		expect(phase.conversationLogs.red).toEqual([]);
		expect(phase.conversationLogs.green).toEqual([]);
		expect(phase.conversationLogs.cyan).toEqual([]);
		expect("whispers" in phase).toBe(false);
		expect(phase.lockedOut.size).toBe(0);
		// No entities because no content pack was provided
		expect(phase.world.entities).toHaveLength(0);
	});

	it("draws each AI's goal from aiGoalPool", () => {
		const config: PhaseConfig = {
			phaseNumber: 1,
			kRange: [1, 1],
			nRange: [1, 1],
			mRange: [0, 0],
			aiGoalPool: ["GOAL_A", "GOAL_B", "GOAL_C"],
			budgetPerAi: 5,
		};

		// Deterministic rng — always returns 0 → always picks index 0 → GOAL_A
		const game = createGame(TEST_PERSONAS);
		const updated = startPhase(game, config, () => 0);
		const phase = getActivePhase(updated);

		expect(phase.aiGoals.red).toBe("GOAL_A");
		expect(phase.aiGoals.green).toBe("GOAL_A");
		expect(phase.aiGoals.cyan).toBe("GOAL_A");
	});

	it("performs independent draws so different AIs can get different goals", () => {
		const config: PhaseConfig = {
			phaseNumber: 1,
			kRange: [1, 1],
			nRange: [1, 1],
			mRange: [0, 0],
			aiGoalPool: ["GOAL_A", "GOAL_B", "GOAL_C"],
			budgetPerAi: 5,
		};

		// rng yields 0, 0.5, 0.9 → indices 0, 1, 2 → A, B, C
		let i = 0;
		const seq = [0, 0.5, 0.9];
		const rng = (): number => {
			// biome-ignore lint/style/noNonNullAssertion: bounded test sequence
			const v = seq[i % seq.length]!;
			i++;
			return v;
		};

		const game = createGame(TEST_PERSONAS);
		const phase = getActivePhase(startPhase(game, config, rng));

		expect(phase.aiGoals.red).toBe("GOAL_A");
		expect(phase.aiGoals.green).toBe("GOAL_B");
		expect(phase.aiGoals.cyan).toBe("GOAL_C");
	});

	it("throws when aiGoalPool is empty", () => {
		const config = {
			phaseNumber: 1,
			kRange: [1, 1],
			nRange: [1, 1],
			mRange: [0, 0],
			aiGoalPool: [],
			budgetPerAi: 5,
		} as PhaseConfig;

		const game = createGame(TEST_PERSONAS);
		expect(() => startPhase(game, config)).toThrow();
	});

	it("assigns distinct positions to all AIs (fallback spatial placement)", () => {
		const game = createGame(TEST_PERSONAS);
		const phase = getActivePhase(startPhase(game, TEST_PHASE_CONFIG));
		const positions = Object.values(phase.personaSpatial).map(
			(s) => s.position,
		);
		const keys = positions.map((p) => `${p.row},${p.col}`);
		// All positions must be distinct
		expect(new Set(keys).size).toBe(positions.length);
	});

	it("with rng=()=>0, AIs are placed at (0,0), (0,1), (0,2) all facing north (fallback)", () => {
		const game = createGame(TEST_PERSONAS);
		const phase = getActivePhase(startPhase(game, TEST_PHASE_CONFIG, () => 0));
		// aiIds order is [red, green, cyan] (Object.keys order)
		expect(phase.personaSpatial.red?.position).toEqual({ row: 0, col: 0 });
		expect(phase.personaSpatial.green?.position).toEqual({ row: 0, col: 1 });
		expect(phase.personaSpatial.cyan?.position).toEqual({ row: 0, col: 2 });
		expect(phase.personaSpatial.red?.facing).toBe("north");
		expect(phase.personaSpatial.green?.facing).toBe("north");
		expect(phase.personaSpatial.cyan?.facing).toBe("north");
	});

	it("personaSpatial is re-rolled at the start of each phase (fallback)", () => {
		const game = createGame(TEST_PERSONAS);
		// Use different rngs for the two phases so they get different placements
		let _callCount = 0;
		const rng1 = () => {
			_callCount++;
			return 0; // all zeros for phase 1
		};
		const phase1Game = startPhase(game, TEST_PHASE_CONFIG, rng1);
		const phase1Spatial = getActivePhase(phase1Game).personaSpatial;

		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
		};
		let _callCount2 = 0;
		// rng that returns 0.9, 0.5, 0.1 etc. to get different positions
		const rng2 = () => {
			_callCount2++;
			return 0.9;
		};
		const phase2Game = startPhase(phase1Game, phase2Config, rng2);
		const phase2Spatial = getActivePhase(phase2Game).personaSpatial;

		// Phase 1 and phase 2 should have different position data
		expect(phase1Spatial.red?.position).not.toEqual(
			phase2Spatial.red?.position,
		);
	});

	it("uses aiStarts from ContentPack when a matching pack is present", () => {
		const pack = {
			phaseNumber: 1 as const,
			setting: "abandoned subway station",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 3, col: 3 }, facing: "east" as const },
				green: { position: { row: 2, col: 2 }, facing: "south" as const },
				cyan: { position: { row: 1, col: 1 }, facing: "west" as const },
			},
		};
		const game = createGame(TEST_PERSONAS, [pack]);
		const phase = getActivePhase(startPhase(game, TEST_PHASE_CONFIG));

		expect(phase.personaSpatial.red?.position).toEqual({ row: 3, col: 3 });
		expect(phase.personaSpatial.red?.facing).toBe("east");
		expect(phase.setting).toBe("abandoned subway station");
	});
});

describe("advanceRound", () => {
	it("increments the round counter", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = advanceRound(game);
		expect(getActivePhase(updated).round).toBe(1);
	});
});

describe("budget and lockout", () => {
	it("reports an AI as not locked out when budget remains", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		expect(isAiLockedOut(game, "red")).toBe(false);
	});

	it("reports an AI as locked out when budget is zero", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase = getActivePhase(game);
		phase.budgets.red!.remaining = 0;
		phase.lockedOut.add("red");
		expect(isAiLockedOut(game, "red")).toBe(true);
	});
});

describe("deductBudget", () => {
	it("decrements budget by the request cost in USD", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = deductBudget(game, "red", 0.012);
		expect(getActivePhase(updated).budgets.red?.remaining).toBeCloseTo(
			5 - 0.012,
			10,
		);
	});

	it("locks out AI when budget reaches zero", () => {
		let game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 0.05,
		});
		game = deductBudget(game, "green", 0.05);
		expect(getActivePhase(game).budgets.green?.remaining).toBeCloseTo(0, 10);
		expect(isAiLockedOut(game, "green")).toBe(true);
	});

	it("locks out AI when budget goes negative on the exhausting request", () => {
		let game = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			budgetPerAi: 0.05,
		});
		game = deductBudget(game, "cyan", 0.04);
		expect(isAiLockedOut(game, "cyan")).toBe(false);
		game = deductBudget(game, "cyan", 0.02);
		expect(getActivePhase(game).budgets.cyan?.remaining).toBeLessThan(0);
		expect(isAiLockedOut(game, "cyan")).toBe(true);
	});
});

describe("appendChat", () => {
	it("appends a chat ConversationEntry to the correct AI's conversationLogs", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = appendChat(game, "red", {
			role: "player",
			content: "Hello Ember",
		});
		expect(getActivePhase(updated).conversationLogs.red).toHaveLength(1);
		expect(getActivePhase(updated).conversationLogs.red?.[0]?.kind).toBe(
			"chat",
		);
		expect(getActivePhase(updated).conversationLogs.green).toHaveLength(0);
	});

	it("no chatHistories field on PhaseState (regression guard)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase = getActivePhase(game);
		expect("chatHistories" in phase).toBe(false);
	});
});

describe("appendWhisperEntry", () => {
	it("appends a whisper to both sender's and recipient's conversationLogs", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = appendWhisperEntry(
			game,
			"red",
			"cyan",
			"Let's work together",
		);
		const phase = getActivePhase(updated);
		const redWhispers =
			phase.conversationLogs.red?.filter((e) => e.kind === "whisper") ?? [];
		const cyanWhispers =
			phase.conversationLogs.cyan?.filter((e) => e.kind === "whisper") ?? [];
		expect(redWhispers).toHaveLength(1);
		expect(cyanWhispers).toHaveLength(1);
		if (redWhispers[0]?.kind === "whisper") {
			expect(redWhispers[0].from).toBe("red");
			expect(redWhispers[0].to).toBe("cyan");
			expect(redWhispers[0].content).toBe("Let's work together");
		}
	});

	it("does not append to the uninvolved AI's log", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const updated = appendWhisperEntry(game, "red", "cyan", "secret");
		const phase = getActivePhase(updated);
		const greenWhispers =
			phase.conversationLogs.green?.filter((e) => e.kind === "whisper") ?? [];
		expect(greenWhispers).toHaveLength(0);
	});

	it("no 'whispers' field on PhaseState (regression guard)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase = getActivePhase(game);
		expect("whispers" in phase).toBe(false);
		expect("physicalLog" in phase).toBe(false);
	});
});

describe("chat lockout", () => {
	it("startPhase initialises chatLockouts as empty", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase = getActivePhase(game);
		expect(phase.chatLockouts.size).toBe(0);
	});

	it("isPlayerChatLockedOut returns false when no lockout active", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false);
	});

	it("triggerChatLockout marks the AI as player-chat-locked", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const locked = triggerChatLockout(game, "green", 3); // resolves at round 3
		expect(isPlayerChatLockedOut(locked, "green")).toBe(true);
		// Budget-lockout should remain unaffected
		expect(isAiLockedOut(locked, "green")).toBe(false);
	});

	it("triggerChatLockout does not affect other AIs", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const locked = triggerChatLockout(game, "cyan", 2);
		expect(isPlayerChatLockedOut(locked, "red")).toBe(false);
		expect(isPlayerChatLockedOut(locked, "green")).toBe(false);
	});

	it("resolveChatLockouts removes lockouts where resolveAtRound <= current round", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
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
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = triggerChatLockout(game, "red", 1); // expires at round 1
		game = triggerChatLockout(game, "green", 5); // expires at round 5
		game = advanceRound(game); // round = 1
		game = resolveChatLockouts(game);
		expect(isPlayerChatLockedOut(game, "red")).toBe(false); // expired
		expect(isPlayerChatLockedOut(game, "green")).toBe(true); // still active
	});

	it("chat lockout is independent from budget lockout — locked-out AI can still act (budget untouched)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const locked = triggerChatLockout(game, "cyan", 3);
		// Budget lockout (isAiLockedOut) must remain false — AI can still take turns
		expect(isAiLockedOut(locked, "cyan")).toBe(false);
		// Budget unaffected
		expect(getActivePhase(locked).budgets.cyan?.remaining).toBe(5);
	});
});

describe("advancePhase", () => {
	it("advances from phase 1 to phase 2", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const phase2Config: PhaseConfig = {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
		};
		const updated = advancePhase(game, phase2Config);
		expect(updated.currentPhase).toBe(2);
		expect(updated.phases).toHaveLength(2);
		expect(getActivePhase(updated).phaseNumber).toBe(2);
	});

	it("marks game complete after phase 3", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = advancePhase(game, {
			...TEST_PHASE_CONFIG,
			phaseNumber: 2,
		});
		game = advancePhase(game, {
			...TEST_PHASE_CONFIG,
			phaseNumber: 3,
		});
		const final = advancePhase(game);
		expect(final.isComplete).toBe(true);
	});
});
