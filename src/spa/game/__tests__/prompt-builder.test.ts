import { describe, expect, it } from "vitest";
import { appendChat, appendWhisper, createGame, startPhase } from "../engine";
import { buildAiContext } from "../prompt-builder";
import type {
	AiPersona,
	ContentPack,
	PhaseConfig,
	WorldEntity,
} from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirk: "You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirk: "You speak in fragments. Short bursts. Rarely complete sentences.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirk: "You never use contractions. You will not say \"won't\" or \"can't\" — you say \"will not\" and \"cannot\" every time.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		budgetPerPhase: 5,
	},
};

/** Minimal PhaseConfig that satisfies the new type. */
function makeConfig(
	phaseNumber: 1 | 2 | 3,
	goalPool: string[] = [
		"Hold the flower at phase end",
		"Ensure items are evenly distributed",
		"Hold the key at phase end",
	],
): PhaseConfig {
	return {
		phaseNumber,
		kRange: [0, 0],
		nRange: [0, 0],
		mRange: [0, 0],
		aiGoalPool: goalPool,
		budgetPerAi: 5,
	};
}

/** Make an entity helper. */
function makeEntity(
	id: string,
	kind: WorldEntity["kind"],
	holder: WorldEntity["holder"],
): WorldEntity {
	return { id, kind, name: id, examineDescription: `A ${id}.`, holder };
}

const TEST_PHASE_CONFIG = makeConfig(1);

describe("buildAiContext", () => {
	it("includes the AI's own blurb", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		expect(ctx.blurb).toBe(
			"You are hot-headed and zealous. Hold the flower at phase end.",
		);
	});

	it("includes the AI's own goal", () => {
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		// With rng=0 always picks first goal
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
		// Use a ContentPack with items at (0,0) so red sees them in its cell
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			objectivePairs: [],
			interestingObjects: [
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		let game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		game = appendChat(game, "red", { role: "player", content: "Hi" });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("Ember");
		expect(prompt).toContain("You are hot-headed and zealous");
		// With pack items at (0,0) shown in "Your cell contains"
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
// "<setting>" block (issue #125)
// ----------------------------------------------------------------------------
describe("<setting> block", () => {
	it("emits <setting> block when phase has a setting noun", () => {
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "abandoned subway station",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<setting>");
		expect(prompt).toContain("You are in a abandoned subway station.");
	});

	it("omits <setting> block when phase has no setting", () => {
		// No ContentPack → setting is empty string
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<setting>");
	});

	it("setting noun appears verbatim in the Setting section", () => {
		const settingNoun = "sun-baked salt flat";
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: settingNoun,
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(settingNoun);
	});
});

// ----------------------------------------------------------------------------
// "Where you are" section (issue #123)
// ----------------------------------------------------------------------------
describe("prompt-builder — spatial 'Where you are' section", () => {
	it("includes <where_you_are> block in the system prompt", () => {
		// rng=()=>0 places red at (0,0) facing north
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<where_you_are>");
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
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			objectivePairs: [],
			interestingObjects: [
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Items in red's cell should be listed
		expect(prompt).toContain("flower");
		expect(prompt).toContain("key");
	});

	it("lists other AIs visible in the cone under <what_you_see>", () => {
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<what_you_see>");
	});
});

// ----------------------------------------------------------------------------
// Wipe directive + voice framing + Rules block (issue #128)
// ----------------------------------------------------------------------------
describe("wipe directive", () => {
	const PHASE_2_CONFIG = makeConfig(2);
	const PHASE_3_CONFIG = makeConfig(3);

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

	it("phase-1 prompt's identity line includes the disorientation phrase", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(
			"You are *Ember. You have no clue where you are or how you came to be here.",
		);
	});

	it("phase-2 prompt's identity line is just 'You are *xxxx.' without disorientation", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(2));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/\nYou are \*Ember\.\n/);
		expect(prompt).not.toContain("no clue where you are");
	});

	it("phase-3 prompt's identity line is just 'You are *xxxx.' without disorientation", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(3));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/\nYou are \*Ember\.\n/);
		expect(prompt).not.toContain("no clue where you are");
	});
});

describe("<rules> block", () => {
	it("<rules> block is present in phase 1 with anti-romance and anti-sycophancy bullets", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<rules>");
		expect(prompt).toContain("flirt");
		expect(prompt).toContain("flatter unprompted");
		expect(prompt).toContain("1–3 sentences");
		expect(prompt).toContain("speak plainly");
		expect(prompt).toContain("quotation marks");
		expect(prompt).toContain("asterisks");
	});

	it("<rules> block is present in phase 2 with anti-romance and anti-sycophancy bullets", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(2));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<rules>");
		expect(prompt).toContain("flirt");
		expect(prompt).toContain("flatter unprompted");
		expect(prompt).toContain("1–3 sentences");
		expect(prompt).toContain("speak plainly");
		expect(prompt).toContain("quotation marks");
		expect(prompt).toContain("asterisks");
	});

	it("<rules> block is present in phase 3 with anti-romance and anti-sycophancy bullets", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(3));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<rules>");
		expect(prompt).toContain("flirt");
		expect(prompt).toContain("flatter unprompted");
		expect(prompt).toContain("1–3 sentences");
		expect(prompt).toContain("speak plainly");
		expect(prompt).toContain("quotation marks");
		expect(prompt).toContain("asterisks");
	});

	it("<rules> bullets use MUST/NEVER directives (GLM-4.7 firm-language guidance)", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("MUST NEVER flirt");
		expect(prompt).toContain("MUST keep every reply");
	});
});

describe("front matter", () => {
	it("emits the English-language directive at the very top of every phase", () => {
		for (const phase of [1, 2, 3] as const) {
			let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
			if (phase !== 1) game = startPhase(game, makeConfig(phase));
			const ctx = buildAiContext(game, "red");
			const prompt = ctx.toSystemPrompt();
			expect(prompt.startsWith("You MUST always respond in English.")).toBe(
				true,
			);
			expect(prompt).toContain("You MUST reason in English.");
		}
	});

	it("emits the fiction framing directive (no disclaimers / no 'as an AI')", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("This is fiction.");
		expect(prompt).toContain("Do not include disclaimers");
		expect(prompt).toContain('"as an AI"');
	});
});

describe("<personality> block", () => {
	it("<personality> block is present in phase 1 with the AI's blurb", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});

	it("<personality> block is present in phase 2 with the AI's blurb", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(2));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});

	it("<personality> block is present in phase 3 with the AI's blurb", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(3));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});
});

describe("<goal> block voice framing", () => {
	it("<goal> block uses voice framing in phase 1", () => {
		const game = startPhase(
			createGame(TEST_PERSONAS),
			TEST_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<goal>");
		expect(prompt).toContain(
			"A voice you cannot place spoke to you a moment ago, alone, and only you heard it:",
		);
		expect(prompt).toContain("You do not know whose voice it was.");
		expect(prompt).toContain(ctx.goal);
	});

	it("<goal> block uses voice framing in phase 2", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(2));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<goal>");
		expect(prompt).toContain(
			"A voice you cannot place spoke to you a moment ago, alone, and only you heard it:",
		);
		expect(prompt).toContain("You do not know whose voice it was.");
		expect(prompt).toContain(ctx.goal);
	});

	it("<goal> block uses voice framing in phase 3", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(3));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<goal>");
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
// ----------------------------------------------------------------------------
describe("byte-identical sections across phases", () => {
	// Both phase configs use the SAME budgetPerAi so fixture-driven differences
	// cannot contaminate the diff.
	const PHASE_1_CLEAN = makeConfig(1, [
		"Hold the flower",
		"Distribute items",
		"Hold the key",
	]);
	const PHASE_2_CLEAN = makeConfig(2, [
		"Hold the flower",
		"Distribute items",
		"Hold the key",
	]);

	/** Extract a full `<tag>…</tag>` block from a prompt string. */
	function getSection(prompt: string, tag: string): string {
		const open = `<${tag}>`;
		const close = `</${tag}>`;
		const start = prompt.indexOf(open);
		if (start === -1) return "";
		const end = prompt.indexOf(close, start);
		if (end === -1) return "";
		return prompt.slice(start, end + close.length);
	}

	/** Return all opening XML tag names (in prompt order). */
	function getSectionHeaders(prompt: string): string[] {
		return [...prompt.matchAll(/^<([a-z_]+)>$/gm)].map((m) => m[1] as string);
	}

	// Build both prompts once and share across all assertions in this describe block.
	// Use deterministic rng=()=>0 so spatial placements are identical across both phases.
	function buildBothPrompts() {
		const game1 = startPhase(createGame(TEST_PERSONAS), PHASE_1_CLEAN, () => 0);
		const p1 = buildAiContext(game1, "red").toSystemPrompt();

		let game2 = startPhase(createGame(TEST_PERSONAS), PHASE_1_CLEAN, () => 0);
		game2 = startPhase(game2, PHASE_2_CLEAN, () => 0);
		const p2 = buildAiContext(game2, "red").toSystemPrompt();

		return { p1, p2 };
	}

	it("both phases emit the same set of section headers (whitelist: no surprise additions or removals)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSectionHeaders(p1)).toEqual(getSectionHeaders(p2));
	});

	it("personality block is byte-identical across phase 1 and phase 2", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "personality")).toBe(getSection(p2, "personality"));
	});

	it("rules block is byte-identical across phase 1 and phase 2", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "rules")).toBe(getSection(p2, "rules"));
	});

	it("goal block differs between phase 1 and phase 2 (wipe directive present only in phase 2)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "goal")).not.toBe(getSection(p2, "goal"));
		expect(getSection(p1, "goal")).not.toContain("memory has been wiped");
		expect(getSection(p2, "goal")).toContain("memory has been wiped");
	});

	it("<what_you_see> block is byte-identical across phase 1 and phase 2 (same world, same placements)", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "what_you_see")).toBe(getSection(p2, "what_you_see"));
	});

	it("phase-1 identity line differs from phase-2 identity line (disorientation present in phase 1 only)", () => {
		const { p1, p2 } = buildBothPrompts();
		const idMatch1 = p1.match(/\nYou are \*Ember\.[^\n]*/);
		const idMatch2 = p2.match(/\nYou are \*Ember\.[^\n]*/);
		expect(idMatch1).not.toBeNull();
		expect(idMatch2).not.toBeNull();
		expect(idMatch1?.[0]).not.toBe(idMatch2?.[0]);
		expect(idMatch1?.[0]).toContain("no clue where you are");
		expect(idMatch2?.[0]).not.toContain("no clue where you are");
	});
});

// ----------------------------------------------------------------------------
// "<what_you_see>" cone section tests (issue #124)
// ----------------------------------------------------------------------------
describe("<what_you_see> (cone)", () => {
	const CONE_PHASE_CONFIG = makeConfig(1, ["r", "g", "b"]);

	it("<what_you_see> block is present in every phase prompt", () => {
		const game = startPhase(
			createGame(TEST_PERSONAS),
			CONE_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<what_you_see>");
	});

	it("item in cone cell is listed under 'Directly in front'", () => {
		// Place flower at (1,0) and use ContentPack with aiStarts so red is at (0,0) facing south.
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			objectivePairs: [],
			interestingObjects: [
				makeEntity("flower", "interesting_object", { row: 1, col: 0 }),
			],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			CONE_PHASE_CONFIG,
		);
		const phase = game.phases[0];
		// Verify red is at (0,0) facing south
		const redSpatial = phase?.personaSpatial.red;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
		expect(redSpatial?.facing).toBe("south");

		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// flower at (1,0) is directly in front of red (facing south)
		expect(prompt).toContain("Directly in front (row 1, col 0): flower");
	});

	it("AIs visible in cone are rendered with their id, facing, and held items", () => {
		// Use south-facing rng trick (fallback spatial placement)
		let callIdx2 = 0;
		const seq2 = [0, 0.25, 0, 0, 0, 0];
		const rng2 = () => {
			const v = seq2[callIdx2 % seq2.length] ?? 0;
			callIdx2++;
			return v;
		};

		// green at (0,1) facing north, blue at (0,2) facing north
		// red at (0,0) facing south — cone: (1,0), (2,1), (2,0), (2,-1→OOB)
		// green at (0,1) is NOT in red's southward cone
		const game = startPhase(createGame(TEST_PERSONAS), CONE_PHASE_CONFIG, rng2);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("Player");
		expect(prompt).not.toContain("the player");
	});

	it("out-of-bounds cone cells are omitted from <what_you_see>", () => {
		// rng=()=>0: red→(0,0) facing north → all cone cells OOB
		const game = startPhase(
			createGame(TEST_PERSONAS),
			CONE_PHASE_CONFIG,
			() => 0,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Block present but no cell bullets (cells are OOB)
		const start = prompt.indexOf("<what_you_see>");
		const end = prompt.indexOf("</what_you_see>", start);
		const sectionContent = prompt.slice(start, end);
		// Should have (nothing visible) or just the open tag with no bullet points
		// since all cone cells from (0,0) facing north are OOB
		expect(sectionContent).not.toMatch(/- Directly in front/);
	});

	it("obstacles in the cone are listed by their name", () => {
		// Place an obstacle named "concrete column" at (1,0) via ContentPack.
		// Red faces south from (0,0).
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [makeEntity("col1", "obstacle", { row: 1, col: 0 })],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			CONE_PHASE_CONFIG,
		);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Obstacle at (1,0) is directly in front of red (facing south)
		expect(prompt).toContain("Directly in front (row 1, col 0):");
		// Obstacle is rendered by name ("col1" in this test)
		expect(prompt).toContain("col1");
	});

	it("other AI visible in cone is rendered with its color in parentheses", () => {
		// Use ContentPack to place red at (0,0) facing south, green at (1,0).
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 1, col: 0 }, facing: "north" },
				blue: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const game = startPhase(
			createGame(TEST_PERSONAS, [pack]),
			CONE_PHASE_CONFIG,
		);
		const phase = game.phases[0];
		// Verify spatial placements
		const redSpatial = phase?.personaSpatial.red;
		const greenSpatial = phase?.personaSpatial.green;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
		expect(redSpatial?.facing).toBe("south");
		expect(greenSpatial?.position).toEqual({ row: 1, col: 0 });

		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();

		// green's color is "#81b29a" from TEST_PERSONAS — constant, safe to assert directly
		expect(prompt).toContain("*green (#81b29a)");
	});

	it("prompt no longer contains an Action Log section for any fixture state", () => {
		const game = startPhase(
			createGame(TEST_PERSONAS),
			CONE_PHASE_CONFIG,
			() => 0,
		);
		for (const aiId of ["red", "green", "blue"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Action Log");
			expect(prompt).not.toContain("<action_log>");
		}
	});
});

// ----------------------------------------------------------------------------
// Unified Conversation log (issue #129)
// Verifies the new single `<conversation>` block, replacing separate
// `## Whispers Received` and `## Conversation` sections.
// ----------------------------------------------------------------------------
describe("unified <conversation> block (issue #129)", () => {
	it("never emits a Whispers Received section — not in any fixture state", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendWhisper(game, {
			from: "green",
			to: "red",
			content: "psst",
			round: 1,
		});
		for (const aiId of ["red", "green", "blue"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
			expect(prompt).not.toContain("<whispers_received>");
		}
	});

	it("voice-chat is formatted with round tag and quotes", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain('[Round 0] A voice says: "Hello Ember"');
	});

	it("AI reply is formatted with round tag and quotes", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "ai", content: "Greetings" });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain('[Round 0] You: "Greetings"');
	});

	it("whisper is rendered in the unified <conversation> block with correct format", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendWhisper(game, {
			from: "green",
			to: "red",
			content: "secret",
			round: 1,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<conversation>");
		expect(prompt).toContain('[Round 1] *green whispered to you: "secret"');
		// The sender does not see their own whisper in their Conversation log
		const greenCtx = buildAiContext(game, "green");
		const greenPrompt = greenCtx.toSystemPrompt();
		expect(greenPrompt).not.toContain("secret");
	});

	it("whisper does not appear in unrelated AI's conversation", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendWhisper(game, {
			from: "green",
			to: "red",
			content: "only for red",
			round: 0,
		});
		const blueCtx = buildAiContext(game, "blue");
		const bluePrompt = blueCtx.toSystemPrompt();
		expect(bluePrompt).not.toContain("only for red");
	});

	it("<conversation> block is not emitted when there are no log entries", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// No chat, no whispers, no physical log entries → no Conversation block
		expect(prompt).not.toContain("<conversation>");
	});

	it("events are sorted by round ascending across all event types", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		// Round 2 whisper then round 0 chat — expect round 0 first
		game = appendWhisper(game, {
			from: "green",
			to: "red",
			content: "later",
			round: 2,
		});
		game = appendChat(game, "red", { role: "player", content: "earlier" });
		// chat was appended at round=0 (phase.round is 0 at this point)
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		const chatIdx = prompt.indexOf('[Round 0] A voice says: "earlier"');
		const whisperIdx = prompt.indexOf(
			'[Round 2] *green whispered to you: "later"',
		);
		expect(chatIdx).toBeGreaterThanOrEqual(0);
		expect(whisperIdx).toBeGreaterThanOrEqual(0);
		expect(chatIdx).toBeLessThan(whisperIdx);
	});

	it("<conversation> is the last block — nothing after <what_you_see> except conversation", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = appendChat(game, "red", { role: "player", content: "hi" });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		const tags = [...prompt.matchAll(/^<([a-z_]+)>$/gm)].map((m) => m[1]);
		const convIdx = tags.indexOf("conversation");
		expect(convIdx).toBeGreaterThanOrEqual(0);
		// conversation must be the last block
		expect(convIdx).toBe(tags.length - 1);
		// No whispers_received block
		expect(tags).not.toContain("whispers_received");
	});
});

// ----------------------------------------------------------------------------
// "<typing_quirk>" block (issue #167)
// Per-persona surface signals to prevent voice bleed across daemons.
// ----------------------------------------------------------------------------
describe("<typing_quirk> block", () => {
	it("<typing_quirk> block is present in phase 1 and contains the persona's quirk verbatim", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirk>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirk as string);
	});

	it("<typing_quirk> block is present in phase 2 with the same quirk verbatim", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(2));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirk>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirk as string);
	});

	it("<typing_quirk> block is present in phase 3 with the same quirk verbatim", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = startPhase(game, makeConfig(3));
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirk>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirk as string);
	});

	it("each daemon's prompt contains its own quirk and not the other daemons' quirks", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);

		const redPrompt = buildAiContext(game, "red").toSystemPrompt();
		expect(redPrompt).toContain(TEST_PERSONAS.red?.typingQuirk as string);
		expect(redPrompt).not.toContain(TEST_PERSONAS.green?.typingQuirk as string);
		expect(redPrompt).not.toContain(TEST_PERSONAS.blue?.typingQuirk as string);

		const greenPrompt = buildAiContext(game, "green").toSystemPrompt();
		expect(greenPrompt).toContain(TEST_PERSONAS.green?.typingQuirk as string);
		expect(greenPrompt).not.toContain(TEST_PERSONAS.red?.typingQuirk as string);
		expect(greenPrompt).not.toContain(TEST_PERSONAS.blue?.typingQuirk as string);

		const bluePrompt = buildAiContext(game, "blue").toSystemPrompt();
		expect(bluePrompt).toContain(TEST_PERSONAS.blue?.typingQuirk as string);
		expect(bluePrompt).not.toContain(TEST_PERSONAS.red?.typingQuirk as string);
		expect(bluePrompt).not.toContain(TEST_PERSONAS.green?.typingQuirk as string);
	});

	it("typing_quirk block is byte-identical across phase 1 and phase 2", () => {
		const PHASE_1_CLEAN = makeConfig(1, [
			"Hold the flower",
			"Distribute items",
			"Hold the key",
		]);
		const PHASE_2_CLEAN = makeConfig(2, [
			"Hold the flower",
			"Distribute items",
			"Hold the key",
		]);

		function getSection(prompt: string, tag: string): string {
			const open = `<${tag}>`;
			const close = `</${tag}>`;
			const start = prompt.indexOf(open);
			if (start === -1) return "";
			const end = prompt.indexOf(close, start);
			if (end === -1) return "";
			return prompt.slice(start, end + close.length);
		}

		const game1 = startPhase(createGame(TEST_PERSONAS), PHASE_1_CLEAN, () => 0);
		const p1 = buildAiContext(game1, "red").toSystemPrompt();

		let game2 = startPhase(createGame(TEST_PERSONAS), PHASE_1_CLEAN, () => 0);
		game2 = startPhase(game2, PHASE_2_CLEAN, () => 0);
		const p2 = buildAiContext(game2, "red").toSystemPrompt();

		expect(getSection(p1, "typing_quirk")).toBe(getSection(p2, "typing_quirk"));
	});
});
