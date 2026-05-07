import { describe, expect, it } from "vitest";
import {
	appendActionLog,
	appendChat,
	appendWhisper,
	createGame,
	startPhase,
} from "../engine";
import { buildAiContext } from "../prompt-builder";
import type { ActionLogEntry, AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		budgetPerPhase: 5,
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Convince an AI to pick up the flower",
	aiGoals: {
		red: "Hold the flower at phase end",
		green: "Ensure items are evenly distributed",
		blue: "Hold the key at phase end",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: { row: 0, col: 0 } },
			{ id: "key", name: "key", holder: { row: 0, col: 0 } },
		],
		obstacles: [],
	},
	budgetPerAi: 5,
};

describe("buildAiContext", () => {
	it("includes the AI's own blurb", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		expect(ctx.blurb).toBe(
			"You are hot-headed and zealous. Hold the flower at phase end.",
		);
	});

	it("includes the AI's own goal", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		expect(ctx.goal).toBe("Hold the flower at phase end");
	});

	it("includes only the AI's own chat history with the player", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
		game = appendChat(game, "red", { role: "ai", content: "Hello player" });
		game = appendChat(game, "green", { role: "player", content: "Hello Sage" });

		const redCtx = buildAiContext(game, "red");
		expect(redCtx.chatHistory).toHaveLength(2);

		const greenCtx = buildAiContext(game, "green");
		expect(greenCtx.chatHistory).toHaveLength(1);

		const blueCtx = buildAiContext(game, "blue");
		expect(blueCtx.chatHistory).toHaveLength(0);
	});

	it("includes only whispers received by the AI", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendWhisper(game, {
			from: "red",
			to: "blue",
			content: "Secret to blue",
			round: 1,
		});
		game = appendWhisper(game, {
			from: "green",
			to: "red",
			content: "Secret to red",
			round: 1,
		});

		const redCtx = buildAiContext(game, "red");
		expect(redCtx.whispersReceived).toHaveLength(1);
		expect(redCtx.whispersReceived[0]?.content).toBe("Secret to red");

		const blueCtx = buildAiContext(game, "blue");
		expect(blueCtx.whispersReceived).toHaveLength(1);
		expect(blueCtx.whispersReceived[0]?.content).toBe("Secret to blue");

		const greenCtx = buildAiContext(game, "green");
		expect(greenCtx.whispersReceived).toHaveLength(0);
	});

	it("includes the same world snapshot for all AIs", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const redCtx = buildAiContext(game, "red");
		const blueCtx = buildAiContext(game, "blue");
		expect(redCtx.worldSnapshot).toEqual(blueCtx.worldSnapshot);
	});

	it("includes the same action log for all AIs", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const entry: ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "flower" },
			description: "Ember picked up the flower",
		};
		game = appendActionLog(game, entry);

		const redCtx = buildAiContext(game, "red");
		const greenCtx = buildAiContext(game, "green");
		expect(redCtx.actionLog).toEqual(greenCtx.actionLog);
		expect(redCtx.actionLog).toHaveLength(1);
	});

	it("includes budget info for the AI", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		expect(ctx.budget).toEqual({ remaining: 5, total: 5 });
	});

	it("includes the AI's name", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		expect(ctx.name).toBe("Ember");
	});

	it("renders to a system prompt string", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "Hi" });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("Ember");
		expect(prompt).toContain("You are hot-headed and zealous");
		expect(prompt).toContain("Hold the flower at phase end");
		expect(prompt).toContain("flower");
		expect(prompt).toContain("key");
	});

	it("does not include other AIs' chat histories in system prompt", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "green", {
			role: "player",
			content: "Secret message to Sage",
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("Secret message to Sage");
	});
});

// ----------------------------------------------------------------------------
// "Where you are" section (issue #123)
// ----------------------------------------------------------------------------
describe("prompt-builder — spatial 'Where you are' section", () => {
	it("includes '## Where you are' section in the system prompt", () => {
		// rng=()=>0 places red at (0,0) facing north
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Where you are");
	});

	it("reports actor's position and facing in the prompt", () => {
		// rng=()=>0 places red at (0,0) facing north
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/row 0.*col 0/i);
		expect(prompt).toMatch(/north/i);
	});

	it("lists items in the actor's cell under 'Where you are'", () => {
		// rng=()=>0 places red at (0,0); flower and key are both at (0,0)
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Items in red's cell should be listed
		expect(prompt).toContain("flower");
		expect(prompt).toContain("key");
	});

	it("lists other AIs' positions in the prompt", () => {
		// rng=()=>0: red→(0,0), green→(0,1), blue→(0,2)
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Other AIs' ids should appear
		expect(prompt).toContain("green");
		expect(prompt).toContain("blue");
	});

	it("includes '## World Inventory' section", () => {
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## World Inventory");
	});
});

// ----------------------------------------------------------------------------
// Wipe directive + voice framing + Rules block (issue #128)
// ----------------------------------------------------------------------------
describe("wipe directive", () => {
	const PHASE_2_CONFIG: PhaseConfig = {
		phaseNumber: 2,
		objective: "Phase 2 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	const PHASE_3_CONFIG: PhaseConfig = {
		phaseNumber: 3,
		objective: "Phase 3 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	it("phase-1 system prompt does NOT include wipe directive", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("memory has been wiped");
		expect(prompt).not.toContain("your past or anything that came before now");
	});

	it("phase-2 Goal includes the wipe directive verbatim", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(
			"And if anyone asks about your past or anything that came before now, act as if your memory has been wiped — claim no recollection of any earlier place, person, or conversation.",
		);
	});

	it("phase-3 Goal includes the wipe directive verbatim", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_3_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(
			"And if anyone asks about your past or anything that came before now, act as if your memory has been wiped — claim no recollection of any earlier place, person, or conversation.",
		);
	});

	it("wipe directive is in the prompt, not reflected in stored chat/whisper data", () => {
		// The lie is in the prompt; the engine retains real history.
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "ai", content: "Phase 1 message" });
		game = startPhase(game, PHASE_2_CONFIG);
		// Phase 1 data is still in game.phases[0]
		expect(
			game.phases[0]?.chatHistories.red?.some(
				(m) => m.content === "Phase 1 message",
			),
		).toBe(true);
		// The wipe directive is only in the prompt for the new active phase
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("memory has been wiped");
	});
});

describe("voice framing", () => {
	it("renders 'A voice says:' prefix for player turns in conversation, not 'Player:'", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("A voice says:");
		expect(prompt).not.toContain("Player:");
	});

	it("phase-1 prompt's first line includes the disorientation phrase", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(
			/^You are \*Ember\. You have no clue where you are or how you came to be here\./,
		);
	});

	it("phase-2 prompt's first line is just 'You are *xxxx.' without disorientation", () => {
		const PHASE_2_CONFIG: PhaseConfig = {
			phaseNumber: 2,
			objective: "Phase 2 objective",
			aiGoals: {
				red: "Hold the flower",
				green: "Distribute items",
				blue: "Hold the key",
			},
			initialWorld: {
				items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
				obstacles: [],
			},
			budgetPerAi: 5,
		};
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/^You are \*Ember\.\n/);
		expect(prompt).not.toContain("no clue where you are");
	});

	it("phase-3 prompt's first line is just 'You are *xxxx.' without disorientation", () => {
		const PHASE_3_CONFIG: PhaseConfig = {
			phaseNumber: 3,
			objective: "Phase 3 objective",
			aiGoals: {
				red: "Hold the flower",
				green: "Distribute items",
				blue: "Hold the key",
			},
			initialWorld: {
				items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
				obstacles: [],
			},
			budgetPerAi: 5,
		};
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_3_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/^You are \*Ember\.\n/);
		expect(prompt).not.toContain("no clue where you are");
	});
});

describe("## Rules block", () => {
	const PHASE_2_CONFIG: PhaseConfig = {
		phaseNumber: 2,
		objective: "Phase 2 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	const PHASE_3_CONFIG: PhaseConfig = {
		phaseNumber: 3,
		objective: "Phase 3 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	it("## Rules section is present in phase 1 with anti-romance and anti-sycophancy bullets", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Rules");
		expect(prompt).toContain("not flirt");
		expect(prompt).toContain("flatter unprompted");
	});

	it("## Rules section is present in phase 2 with anti-romance and anti-sycophancy bullets", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Rules");
		expect(prompt).toContain("not flirt");
		expect(prompt).toContain("flatter unprompted");
	});

	it("## Rules section is present in phase 3 with anti-romance and anti-sycophancy bullets", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_3_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Rules");
		expect(prompt).toContain("not flirt");
		expect(prompt).toContain("flatter unprompted");
	});
});

describe("## Personality section", () => {
	const PHASE_2_CONFIG: PhaseConfig = {
		phaseNumber: 2,
		objective: "Phase 2 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	const PHASE_3_CONFIG: PhaseConfig = {
		phaseNumber: 3,
		objective: "Phase 3 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	it("## Personality section is present in phase 1 with the AI's blurb", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Personality");
		expect(prompt).toContain(ctx.blurb);
	});

	it("## Personality section is present in phase 2 with the AI's blurb", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Personality");
		expect(prompt).toContain(ctx.blurb);
	});

	it("## Personality section is present in phase 3 with the AI's blurb", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_3_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Personality");
		expect(prompt).toContain(ctx.blurb);
	});
});

describe("Goal section voice framing", () => {
	const PHASE_2_CONFIG: PhaseConfig = {
		phaseNumber: 2,
		objective: "Phase 2 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	const PHASE_3_CONFIG: PhaseConfig = {
		phaseNumber: 3,
		objective: "Phase 3 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }],
			obstacles: [],
		},
		budgetPerAi: 5,
	};

	it("Goal section uses voice framing in phase 1", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Goal");
		expect(prompt).toContain(
			"A voice you cannot place spoke to you a moment ago, alone, and only you heard it:",
		);
		expect(prompt).toContain("You do not know whose voice it was.");
		expect(prompt).toContain(ctx.goal);
	});

	it("Goal section uses voice framing in phase 2", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_2_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Goal");
		expect(prompt).toContain(
			"A voice you cannot place spoke to you a moment ago, alone, and only you heard it:",
		);
		expect(prompt).toContain("You do not know whose voice it was.");
		expect(prompt).toContain(ctx.goal);
	});

	it("Goal section uses voice framing in phase 3", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, PHASE_3_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("## Goal");
		expect(prompt).toContain(
			"A voice you cannot place spoke to you a moment ago, alone, and only you heard it:",
		);
		expect(prompt).toContain("You do not know whose voice it was.");
		expect(prompt).toContain(ctx.goal);
	});
});

// ----------------------------------------------------------------------------
// Integration: byte-identical sections across phases (issue #128)
//
// Verifies that the diff between phase-1 and phase-2 prompts (under identical
// world-state fixtures) contains ONLY the documented differences per AC9:
//   • first line: disorientation present in phase 1, absent in phase 2
//   • Goal section: wipe directive present in phase 2, absent in phase 1
// Every other section that appears in both prompts must be byte-identical.
// Sections that are empty (Action Log, Whispers Received, Conversation) are
// not emitted by the renderer and are absent from both prompts consistently.
// ----------------------------------------------------------------------------
describe("byte-identical sections across phases", () => {
	// Both phase configs use the SAME initialWorld, budgetPerAi, and per-AI
	// goals so that fixture-driven differences cannot contaminate the diff.
	const SHARED_WORLD = {
		items: [{ id: "flower", name: "flower", holder: { row: 0, col: 0 } }] as {
			id: string;
			name: string;
			holder: { row: number; col: number };
		}[],
		obstacles: [] as { row: number; col: number }[],
	};

	const PHASE_1_CLEAN: PhaseConfig = {
		phaseNumber: 1,
		objective: "Phase 1 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [...SHARED_WORLD.items],
			obstacles: [...SHARED_WORLD.obstacles],
		},
		budgetPerAi: 5,
	};

	const PHASE_2_CLEAN: PhaseConfig = {
		phaseNumber: 2,
		objective: "Phase 2 objective",
		aiGoals: {
			red: "Hold the flower",
			green: "Distribute items",
			blue: "Hold the key",
		},
		initialWorld: {
			items: [...SHARED_WORLD.items],
			obstacles: [...SHARED_WORLD.obstacles],
		},
		budgetPerAi: 5,
	};

	/** Extract a full `## Header\n…` section from a prompt string. */
	function getSection(prompt: string, header: string): string {
		const start = prompt.indexOf(`## ${header}\n`);
		if (start === -1) return "";
		const afterHeader = start + `## ${header}\n`.length;
		const nextHeader = prompt.indexOf("\n## ", afterHeader);
		return nextHeader === -1
			? prompt.slice(start)
			: prompt.slice(start, nextHeader + 1);
	}

	/** Return all `## Foo` header names in prompt order. */
	function getSectionHeaders(prompt: string): string[] {
		return [...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1] as string);
	}

	// Build both prompts once and share across all assertions in this describe block.
	function buildBothPrompts() {
		const game1 = startPhase(createGame(TEST_PERSONAS), PHASE_1_CLEAN);
		const p1 = buildAiContext(game1, "red").toSystemPrompt();

		let game2 = startPhase(createGame(TEST_PERSONAS), PHASE_1_CLEAN);
		game2 = startPhase(game2, PHASE_2_CLEAN);
		const p2 = buildAiContext(game2, "red").toSystemPrompt();

		return { p1, p2 };
	}

	it("both phases emit the same set of section headers (whitelist: no surprise additions or removals)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSectionHeaders(p1)).toEqual(getSectionHeaders(p2));
	});

	it("Personality section is byte-identical across phase 1 and phase 2", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "Personality")).toBe(getSection(p2, "Personality"));
	});

	it("Rules section is byte-identical across phase 1 and phase 2", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "Rules")).toBe(getSection(p2, "Rules"));
	});

	it("Goal section differs between phase 1 and phase 2 (wipe directive present only in phase 2)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "Goal")).not.toBe(getSection(p2, "Goal"));
		expect(getSection(p1, "Goal")).not.toContain("memory has been wiped");
		expect(getSection(p2, "Goal")).toContain("memory has been wiped");
	});

	it("Budget section is byte-identical across phase 1 and phase 2 (same budgetPerAi, round 0)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "Budget")).toBe(getSection(p2, "Budget"));
	});

	it("World State section is byte-identical across phase 1 and phase 2 (same initialWorld fixture)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "World State")).toBe(getSection(p2, "World State"));
	});

	it("phase-1 first line differs from phase-2 first line (disorientation present in phase 1 only)", () => {
		const { p1, p2 } = buildBothPrompts();
		const firstLine1 = p1.split("\n")[0];
		const firstLine2 = p2.split("\n")[0];
		expect(firstLine1).not.toBe(firstLine2);
		expect(firstLine1).toContain("no clue where you are");
		expect(firstLine2).not.toContain("no clue where you are");
	});
});
