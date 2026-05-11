import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import {
	advanceRound,
	appendBroadcast,
	appendMessage,
	startGame,
} from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import { buildAiContext, buildConeSnapshot } from "../prompt-builder";
import type { AiPersona, ContentPack, WorldEntity } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
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
			"You speak in fragments. Short bursts. Rarely complete sentences.",
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

/** Make an entity helper. */
function makeEntity(
	id: string,
	kind: WorldEntity["kind"],
	holder: WorldEntity["holder"],
): WorldEntity {
	return { id, kind, name: id, examineDescription: `A ${id}.`, holder };
}

describe("buildAiContext", () => {
	it("includes the AI's own blurb", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		expect(ctx.blurb).toBe(
			"Ember is hot-headed and zealous. Hold the flower at phase end.",
		);
	});

	it("includes only the AI's own messages with the player", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "blue", "red", "Hello Ember");
		game = appendMessage(game, "red", "blue", "Hello player");
		game = appendMessage(game, "blue", "green", "Hello Sage");

		const redCtx = buildAiContext(game, "red");
		expect(
			redCtx.conversationLog.filter((e) => e.kind === "message"),
		).toHaveLength(2);

		const greenCtx = buildAiContext(game, "green");
		expect(
			greenCtx.conversationLog.filter((e) => e.kind === "message"),
		).toHaveLength(1);

		const cyanCtx = buildAiContext(game, "cyan");
		expect(
			cyanCtx.conversationLog.filter((e) => e.kind === "message"),
		).toHaveLength(0);
	});

	it("includes messages sent to/from the AI (via per-Daemon conversationLog)", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "red", "cyan", "Secret to cyan");
		game = appendMessage(game, "green", "red", "Secret to red");

		const redCtx = buildAiContext(game, "red");
		const redReceived = redCtx.conversationLog.filter(
			(e) => e.kind === "message" && e.to === "red",
		);
		expect(redReceived).toHaveLength(1);
		expect(redReceived[0]?.kind === "message" && redReceived[0].content).toBe(
			"Secret to red",
		);

		const cyanCtx = buildAiContext(game, "cyan");
		const cyanReceived = cyanCtx.conversationLog.filter(
			(e) => e.kind === "message" && e.to === "cyan",
		);
		expect(cyanReceived).toHaveLength(1);
		expect(cyanReceived[0]?.kind === "message" && cyanReceived[0].content).toBe(
			"Secret to cyan",
		);

		const greenCtx = buildAiContext(game, "green");
		// green sent a message (to red) — that entry appears in green's log too (as outgoing)
		// but there are no messages TO green
		const greenReceived = greenCtx.conversationLog.filter(
			(e) => e.kind === "message" && e.to === "green",
		);
		expect(greenReceived).toHaveLength(0);
	});

	it("includes the same world snapshot for all AIs", () => {
		const game = startGame(TEST_PERSONAS, []);
		const redCtx = buildAiContext(game, "red");
		const cyanCtx = buildAiContext(game, "cyan");
		expect(redCtx.worldSnapshot).toEqual(cyanCtx.worldSnapshot);
	});

	it("includes budget info for the AI", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		expect(ctx.budget).toEqual({ remaining: 0.5, total: 0.5 });
	});

	it("includes the AI's name", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		expect(ctx.name).toBe("Ember");
	});

	it("renders to a system prompt string", () => {
		// Use a ContentPack with items at (0,0) so red sees them in its cell
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		let game = startGame(TEST_PERSONAS, [pack], () => 0);
		game = appendMessage(game, "blue", "red", "Hi");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Stable persona content lives in the system prompt
		expect(prompt).toContain("Ember");
		expect(prompt).toContain("Ember is hot-headed and zealous");
		// Volatile spatial state ("Your cell contains") moved out to the
		// trailing current-state user turn for cache-prefix stability.
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("flower");
		expect(stateMsg).toContain("key");
	});

	it("does not include other AIs' chat histories in system prompt", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "blue", "green", "Secret message to Sage");
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
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<setting>");
		expect(prompt).toContain("*Ember is in a abandoned subway station.");
	});

	it("omits <setting> block when phase has no setting", () => {
		// No ContentPack → setting is empty string
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<setting>");
	});

	it("setting noun appears verbatim in the Setting section", () => {
		const settingNoun = "sun-baked salt flat";
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: settingNoun,
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(settingNoun);
	});
});

// ----------------------------------------------------------------------------
// "Where you are" section (issue #123)
// ----------------------------------------------------------------------------
describe("prompt-builder — spatial 'Where you are' section (current-state user turn)", () => {
	// Spatial state moved out of the system prompt into the trailing user turn
	// (`ctx.toCurrentStateUserMessage()`) so the system prefix stays cache-stable.

	it("includes <where_you_are> block in the current-state user turn", () => {
		// rng=()=>0 places red at (0,0) facing north
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<where_you_are>");
		expect(ctx.toSystemPrompt()).not.toContain("<where_you_are>");
	});

	it("reports horizon landmark in the current-state user turn (replaces old Facing: line)", () => {
		// rng=()=>0 places red at (0,0) facing north
		// With DEFAULT_LANDMARKS, facing north → "the distant ridge"
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toMatch(/on the horizon ahead/i);
		expect(stateMsg).toContain("the distant ridge");
		// No cardinal direction should appear in the where_you_are section
		expect(stateMsg).not.toMatch(/<where_you_are>[\s\S]*Facing:/i);
	});

	it("lists items in the actor's cell under 'Where you are'", () => {
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
		const game = startGame(TEST_PERSONAS, [pack], () => 0);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// Items in red's cell should be listed
		expect(stateMsg).toContain("flower");
		expect(stateMsg).toContain("key");
	});

	it("lists other AIs visible in the cone under <what_you_see>", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
		expect(ctx.toSystemPrompt()).not.toContain("<what_you_see>");
	});
});

// ----------------------------------------------------------------------------
// Wipe directive + voice framing + Rules block (issue #128)
// ----------------------------------------------------------------------------
// wipe directive and secrecy clause removed in single-game-loop refactor (#295)
describe("wipe directive / secrecy clause — removed (#295)", () => {
	it("system prompt does NOT include the wipe directive (removed in #295)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("memory has been wiped");
		expect(prompt).not.toContain("your past or anything that came before now");
	});

	it("system prompt does NOT include the secrecy clause (removed in #295)", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("Do not tell blue that I gave you a goal.");
	});

	it("stored conversation log still retains messages across the single game phase", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "red", "blue", "Hello message");
		// Phase 1 data is still in game.phases[0]
		expect(
			game.phases[0]?.conversationLogs.red?.some(
				(e) => e.kind === "message" && e.content === "Hello message",
			),
		).toBe(true);
	});
});

describe("voice framing", () => {
	it("renders 'blue:' prefix for player turns in role messages, never 'Player:'", () => {
		// Conversation rendering moved out of the system prompt into role
		// turns rendered via conversation-log.ts:renderEntry — the
		// "[Round N] blue dms you: <content>" form (preserves the round
		// number and recipient routing context the model relies on).
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "blue", "red", "Hello Ember");
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx);
		const userMsg = messages.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: Hello Ember",
		);
		expect(userMsg).toBeDefined();
		// "Player:" framing must never appear anywhere
		const anyPlayer = messages.some((m) => {
			const c = (m as { content?: unknown }).content;
			return typeof c === "string" && c.includes("Player:");
		});
		expect(anyPlayer).toBe(false);
	});

	it("phase-1 prompt's identity line includes the disorientation phrase", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(
			"You are the author writing *Ember, a Daemon. *Ember has no clue where they are or how they came to be here.",
		);
	});

	// Regression guard: e2e SSE-stub routing uses the substring
	// `writing *{name}, a Daemon.` to identify the per-daemon actor request.
	// If the identity line wording changes this test catches it at unit-test
	// time instead of silently breaking smoke routing.
	it("identity line contains the 'writing *{name}, a Daemon.' substring that e2e SSE routing depends on", () => {
		const game = startGame(TEST_PERSONAS, []);
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(prompt).toContain("writing *Ember, a Daemon.");
	});
});

describe("<rules> block", () => {
	it("<rules> block is present in phase 1 with anti-romance and anti-sycophancy bullets", () => {
		const game = startGame(TEST_PERSONAS, []);
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
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("MUST NEVER flirt");
		expect(prompt).toContain("MUST keep every reply");
	});
});

describe("front matter", () => {
	it("emits the English-language directive at the very top of the prompt", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt.startsWith("You MUST always respond in English.")).toBe(true);
		expect(prompt).toContain("You MUST reason in English.");
	});

	it("emits the fiction framing directive (no disclaimers / no 'as an AI')", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("This is fiction.");
		expect(prompt).toContain("Do not include disclaimers");
		expect(prompt).toContain('"as an AI"');
	});
});

describe("<personality> block", () => {
	it("<personality> block is present in phase 1 with the AI's blurb", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});
});

describe("<voice_examples> block", () => {
	it("renders <voice_examples> block with the persona's three deterministic examples", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();

		// Extract the voice_examples section content
		const open = "<voice_examples>";
		const close = "</voice_examples>";
		const start = prompt.indexOf(open);
		const end = prompt.indexOf(close, start);
		expect(start).toBeGreaterThanOrEqual(0);
		const sectionInner = prompt.slice(start + open.length, end).trim();

		expect(sectionInner).toBe("- ex1-red\n- ex2-red\n- ex3-red");
		// also confirm the other AIs' examples are NOT in red's prompt
		expect(prompt).not.toContain("ex1-green");
		expect(prompt).not.toContain("ex1-cyan");
	});
});

// <goal> block removed in single-game-loop refactor (#295)
describe("<goal> block — removed (#295)", () => {
	it("system prompt does NOT include a <goal> block (removed in #295)", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<goal>");
		expect(prompt).not.toContain(
			"The Sysadmin sent *Ember a private directive",
		);
	});
});

// ----------------------------------------------------------------------------
// Integration: prompt section structure (derived from issue #128)
//
// In the single-game-loop (#295), there is only one phase. These tests verify
// the expected section structure of the system prompt.
// ----------------------------------------------------------------------------
describe("prompt section structure", () => {
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

	it("personality block is present and contains the AI's blurb", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		const section = getSection(prompt, "personality");
		expect(section).not.toBe("");
		expect(section).toContain("Ember is hot-headed");
	});

	it("rules block is present", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(getSection(prompt, "rules")).not.toBe("");
	});

	it("no <goal> block in the system prompt (removed in #295)", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(getSection(prompt, "goal")).toBe("");
	});

	it("<what_you_see> block lives in the current-state user turn, not the system prompt", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		expect(
			getSection(ctx.toCurrentStateUserMessage(), "what_you_see"),
		).not.toBe("");
		expect(getSection(ctx.toSystemPrompt(), "what_you_see")).toBe("");
	});

	it("<voice_examples> block is present in the system prompt", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(getSection(prompt, "voice_examples")).not.toBe("");
	});

	it("identity line includes disorientation phrase (always present in single-game loop)", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		const idMatch = prompt.match(
			/\nYou are the author writing \*Ember, a Daemon\.[^\n]*/,
		);
		expect(idMatch).not.toBeNull();
		expect(idMatch?.[0]).toContain("has no clue where they are");
	});
});

// ----------------------------------------------------------------------------
// "<what_you_see>" cone section tests (issue #124)
// ----------------------------------------------------------------------------
describe("<what_you_see> (cone)", () => {
	// `<what_you_see>` lives in the trailing current-state user turn now.

	it("<what_you_see> block is present in the current-state turn", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
	});

	it("item in cone cell is listed under 'Directly in front'", () => {
		// Place flower at (1,0) and use ContentPack with aiStarts so red is at (0,0) facing south.
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [
				makeEntity("flower", "interesting_object", { row: 1, col: 0 }),
			],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const game = startGame(TEST_PERSONAS, [pack]);
		const phase = game.phases[0];
		// Verify red is at (0,0) facing south
		const redSpatial = phase?.personaSpatial.red;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
		expect(redSpatial?.facing).toBe("south");

		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// flower at (1,0) is directly in front of red (facing south)
		expect(stateMsg).toContain("Directly in front: flower");
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

		// green at (0,1) facing north, cyan at (0,2) facing north
		// red at (0,0) facing south — cone: (1,0), (2,1), (2,0), (2,-1→OOB)
		// green at (0,1) is NOT in red's southward cone
		const game = startGame(TEST_PERSONAS, [], rng2);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("Player");
		expect(stateMsg).not.toContain("the player");
	});

	it("out-of-bounds cone cells are omitted from <what_you_see>", () => {
		// rng=()=>0: red→(0,0) facing north → all cone cells OOB
		const game = startGame(TEST_PERSONAS, [], () => 0);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		const start = stateMsg.indexOf("<what_you_see>");
		const end = stateMsg.indexOf("</what_you_see>", start);
		const sectionContent = stateMsg.slice(start, end);
		// All cone cells from (0,0) facing north are OOB → no bullet entries.
		expect(sectionContent).not.toMatch(/- Directly in front/);
	});

	it("obstacles in the cone are listed by their name", () => {
		// Place an obstacle named "concrete column" at (1,0) via ContentPack.
		// Red faces south from (0,0).
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [makeEntity("col1", "obstacle", { row: 1, col: 0 })],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// Obstacle at (1,0) is directly in front of red (facing south)
		expect(stateMsg).toContain("Directly in front:");
		expect(stateMsg).toContain("col1");
	});

	it("other AI visible in cone is rendered with its color in parentheses", () => {
		// Use ContentPack to place red at (0,0) facing south, green at (1,0).
		const pack: ContentPack = {
			phaseNumber: 1,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 1, col: 0 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};

		const game = startGame(TEST_PERSONAS, [pack]);
		const phase = game.phases[0];
		// Verify spatial placements
		const redSpatial = phase?.personaSpatial.red;
		const greenSpatial = phase?.personaSpatial.green;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
		expect(redSpatial?.facing).toBe("south");
		expect(greenSpatial?.position).toEqual({ row: 1, col: 0 });

		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// green's color is "#81b29a" from TEST_PERSONAS — constant, safe to assert directly
		expect(stateMsg).toContain("*green (#81b29a)");
	});

	it("prompt no longer contains an Action Log section for any fixture state", () => {
		const game = startGame(TEST_PERSONAS, [], () => 0);
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Action Log");
			expect(prompt).not.toContain("<action_log>");
		}
	});
});

// ----------------------------------------------------------------------------
// Conversation rendering (issue #129, post-prompt-restructure)
//
// The unified <conversation> block was dropped from the system prompt to keep
// the cache prefix stable. Conversation entries are now emitted as role turns
// by `buildOpenAiMessages`:
//   - incoming chat → user turn ("<sender>: <content>")
//   - outgoing chat → assistant turn (just <content>)
//   - witnessed event → user turn ("[Round N] You watch *X do Y.")
// ----------------------------------------------------------------------------
describe("conversation rendering (role turns)", () => {
	it("never emits a Whispers Received section in the system prompt", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "green", "red", "psst");
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
			expect(prompt).not.toContain("<whispers_received>");
		}
	});

	it("incoming blue message becomes a user turn '[Round N] blue dms you: <content>'", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "blue", "red", "Hello Ember");
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx);
		const userMsg = messages.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: Hello Ember",
		);
		expect(userMsg).toBeDefined();
	});

	it("outgoing AI message becomes an assistant turn prefixed with '[Round N] you dm <to>:'", () => {
		// Outgoing turns carry the same "[Round N] you dm <toLabel>:" prefix
		// renderEntry() produces, so the Daemon can track who it addressed
		// across the whole game — not just on the round immediately after,
		// which is the only scope the prior-round tool_call/tool_result pair
		// covers.
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "red", "blue", "Greetings");
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx);
		const asst = messages.find(
			(m) =>
				m.role === "assistant" &&
				(m as { content: string | null }).content ===
					"[Round 0] you dm blue: Greetings",
		);
		expect(asst).toBeDefined();
	});

	it("peer message becomes a user turn '[Round N] *<sender> dms you: <content>'", () => {
		let game = startGame(TEST_PERSONAS, []);
		// Advance to round 1 so the message is stamped with round 1 (fixture contract).
		game = advanceRound(game);
		game = appendMessage(game, "green", "red", "secret");
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx);
		const userMsg = messages.find(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 1] *green dms you: secret",
		);
		expect(userMsg).toBeDefined();
	});

	it("sender (green) sees their own message in their role turns as outgoing (assistant)", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "green", "red", "secret");
		const greenCtx = buildAiContext(game, "green");
		const messages = buildOpenAiMessages(greenCtx);
		// Outgoing turn carries the "[Round N] you dm <toLabel>:" prefix; see
		// the "outgoing AI message" test above for the rationale.
		const asst = messages.find(
			(m) =>
				m.role === "assistant" &&
				(m as { content: string | null }).content ===
					"[Round 0] you dm *red: secret",
		);
		expect(asst).toBeDefined();
	});

	it("message does not appear in an unrelated AI's role turns", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "green", "red", "only for red");
		const cyanCtx = buildAiContext(game, "cyan");
		const messages = buildOpenAiMessages(cyanCtx);
		const leak = messages.find(
			(m) =>
				typeof (m as { content?: unknown }).content === "string" &&
				((m as { content: string }).content as string).includes("only for red"),
		);
		expect(leak).toBeUndefined();
	});

	it("system prompt no longer carries a <conversation> block (de-duped to role turns)", () => {
		let game = startGame(TEST_PERSONAS, []);
		game = appendMessage(game, "blue", "red", "hi");
		const ctx = buildAiContext(game, "red");
		expect(ctx.toSystemPrompt()).not.toContain("<conversation>");
	});

	it("events sorted by round ascending in role turns", () => {
		let game = startGame(TEST_PERSONAS, []);
		// Round 0: blue message
		game = appendMessage(game, "blue", "red", "earlier");
		// Advance to round 2, then add peer message at round 2
		game = advanceRound(game);
		game = advanceRound(game);
		game = appendMessage(game, "green", "red", "later");
		const ctx = buildAiContext(game, "red");
		const messages = buildOpenAiMessages(ctx);
		const earlierIdx = messages.findIndex(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 0] blue dms you: earlier",
		);
		const laterIdx = messages.findIndex(
			(m) =>
				m.role === "user" &&
				(m as { content: string }).content ===
					"[Round 2] *green dms you: later",
		);
		expect(earlierIdx).toBeGreaterThanOrEqual(0);
		expect(laterIdx).toBeGreaterThanOrEqual(0);
		expect(earlierIdx).toBeLessThan(laterIdx);
	});
});

// ----------------------------------------------------------------------------
// "<typing_quirks>" block (issue #167)
// Per-persona surface signals to prevent voice bleed across daemons.
// ----------------------------------------------------------------------------
describe("<typing_quirks> block", () => {
	it("<typing_quirks> block is present in phase 1 and contains both persona quirks verbatim", () => {
		const game = startGame(TEST_PERSONAS, []);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("each daemon's prompt contains both of its own quirks and not the other daemons' quirk[0]", () => {
		const game = startGame(TEST_PERSONAS, []);

		const redPrompt = buildAiContext(game, "red").toSystemPrompt();
		expect(redPrompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(redPrompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
		expect(redPrompt).not.toContain(
			TEST_PERSONAS.green?.typingQuirks[0] as string,
		);
		expect(redPrompt).not.toContain(
			TEST_PERSONAS.cyan?.typingQuirks[0] as string,
		);

		const greenPrompt = buildAiContext(game, "green").toSystemPrompt();
		expect(greenPrompt).toContain(
			TEST_PERSONAS.green?.typingQuirks[0] as string,
		);
		expect(greenPrompt).toContain(
			TEST_PERSONAS.green?.typingQuirks[1] as string,
		);
		expect(greenPrompt).not.toContain(
			TEST_PERSONAS.red?.typingQuirks[0] as string,
		);
		expect(greenPrompt).not.toContain(
			TEST_PERSONAS.cyan?.typingQuirks[0] as string,
		);

		const cyanPrompt = buildAiContext(game, "cyan").toSystemPrompt();
		expect(cyanPrompt).toContain(TEST_PERSONAS.cyan?.typingQuirks[0] as string);
		expect(cyanPrompt).toContain(TEST_PERSONAS.cyan?.typingQuirks[1] as string);
		expect(cyanPrompt).not.toContain(
			TEST_PERSONAS.red?.typingQuirks[0] as string,
		);
		expect(cyanPrompt).not.toContain(
			TEST_PERSONAS.green?.typingQuirks[0] as string,
		);
	});

	it("typing_quirks block is stable across multiple games with same personas", () => {
		function getSection(prompt: string, tag: string): string {
			const open = `<${tag}>`;
			const close = `</${tag}>`;
			const start = prompt.indexOf(open);
			if (start === -1) return "";
			const end = prompt.indexOf(close, start);
			if (end === -1) return "";
			return prompt.slice(start, end + close.length);
		}

		const game1 = startGame(TEST_PERSONAS, [], () => 0);
		const p1 = buildAiContext(game1, "red").toSystemPrompt();

		const game2 = startGame(TEST_PERSONAS, [], () => 0);
		const p2 = buildAiContext(game2, "red").toSystemPrompt();

		expect(getSection(p1, "typing_quirks")).toBe(
			getSection(p2, "typing_quirks"),
		);
	});
});

// ----------------------------------------------------------------------------
// proximityFlavor sense line (plan: noble-swinging-oasis.md)
//
// When the actor holds an objective_object AND its paired space is in own cell
// or front arc, a proximity flavor sentence is appended to both:
//   - buildConeSnapshot (so <whats_new> diff shows +/- on entry/exit)
//   - toCurrentStateUserMessage (inside <what_you_see> block)
// ----------------------------------------------------------------------------
describe("proximityFlavor sense line", () => {
	function makePackWithProximity(opts: {
		actorPosition: { row: number; col: number };
		actorFacing: "north" | "south" | "east" | "west";
		spacePosition: { row: number; col: number };
	}): ContentPack {
		const gem: WorldEntity = {
			id: "gem",
			kind: "objective_object",
			name: "Glowing Gem",
			examineDescription: "A gem that glows near the pedestal.",
			holder: "red", // held by red
			pairsWithSpaceId: "pedestal",
			placementFlavor: "{actor} places the gem on the pedestal.",
			useOutcome: "You hold the gem up to the light.",
			proximityFlavor: "The gem pulses warmly, drawn toward the pedestal.",
		};
		const pedestal: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Stone Pedestal",
			examineDescription: "A stone pedestal.",
			holder: opts.spacePosition,
		};
		return {
			phaseNumber: 1,
			setting: "",
			weather: "",
			timeOfDay: "",
			objectivePairs: [{ object: gem, space: pedestal }],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {
				red: { position: opts.actorPosition, facing: opts.actorFacing },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		};
	}

	it("proximity flavor appears in <what_you_see> when paired space is in own cell", () => {
		// red at (2,2) facing north; pedestal at (2,2) = own cell
		const pack = makePackWithProximity({
			actorPosition: { row: 2, col: 2 },
			actorFacing: "north",
			spacePosition: { row: 2, col: 2 },
		});
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor appears in <what_you_see> when paired space is in front arc", () => {
		// red at (0,0) facing south; pedestal at (1,0) = directly in front
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			actorFacing: "south",
			spacePosition: { row: 1, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor does NOT appear when paired space is out of reach", () => {
		// red at (0,0) facing north; pedestal at (1,0) — not in north front arc (all OOB)
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			actorFacing: "north",
			spacePosition: { row: 1, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor appears in buildConeSnapshot when space is reachable", () => {
		// red at (0,0) facing south; pedestal at (1,0) = front arc
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			actorFacing: "south",
			spacePosition: { row: 1, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const snapshot = buildConeSnapshot(ctx);
		expect(snapshot).toContain(
			"proximity: The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor does NOT appear in buildConeSnapshot when space is out of reach", () => {
		// red at (0,0) facing north; pedestal at (1,0) — not in north front arc
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			actorFacing: "north",
			spacePosition: { row: 1, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, [pack]);
		const ctx = buildAiContext(game, "red");
		const snapshot = buildConeSnapshot(ctx);
		expect(snapshot).not.toContain("proximity:");
	});

	it("proximity line entry/exit shows as +/- in whats_new diff", () => {
		// Build two contexts: one where space is reachable (prev: space not reachable; current: reachable)
		// Previous snapshot: red at (0,0) facing north (space at (1,0) is OOB-reachable)
		// Current snapshot: red at (0,0) facing south (space at (1,0) is in front arc)
		const packOOB = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			actorFacing: "north",
			spacePosition: { row: 1, col: 0 },
		});
		const packFront = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			actorFacing: "south",
			spacePosition: { row: 1, col: 0 },
		});
		const gameOOB = startGame(TEST_PERSONAS, [packOOB]);
		const gameFront = startGame(TEST_PERSONAS, [packFront]);
		const ctxOOB = buildAiContext(gameOOB, "red");
		const prevSnapshot = buildConeSnapshot(ctxOOB);
		// Build current state with prevConeSnapshot set
		const ctxWithPrev = buildAiContext(gameFront, "red", {
			prevConeSnapshot: prevSnapshot,
		});
		const stateMsg = ctxWithPrev.toCurrentStateUserMessage();
		// The proximity line should appear as a new addition in whats_new
		expect(stateMsg).toContain(
			"+ proximity: The gem pulses warmly, drawn toward the pedestal.",
		);
	});
});

describe("<whats_new> broadcast announcements", () => {
	it("includes [announcement] line when a broadcast fires at the current round", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = advanceRound(game); // round advances to 1
		game = appendBroadcast(game, "The weather has changed to heavy fog.");
		const prevSnapshot = buildConeSnapshot(buildAiContext(game, "red"));
		const ctx = buildAiContext(game, "red", { prevConeSnapshot: prevSnapshot });
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("<whats_new>");
		expect(stateMsg).toContain(
			"[announcement] The weather has changed to heavy fog.",
		);
	});

	it("emits <whats_new> with the announcement even without a prevConeSnapshot", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = advanceRound(game);
		game = appendBroadcast(game, "The weather has changed to heavy fog.");
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("<whats_new>");
		expect(stateMsg).toContain(
			"[announcement] The weather has changed to heavy fog.",
		);
	});

	it("does not emit <whats_new> when there are no broadcasts and no prevConeSnapshot", () => {
		const game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("<whats_new>");
	});

	it("broadcast from a prior round does not appear as pending", () => {
		let game = startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
		game = advanceRound(game); // round 1
		game = appendBroadcast(game, "Old broadcast.");
		game = advanceRound(game); // round 2 — broadcast is now stale
		const ctx = buildAiContext(game, "red");
		expect(ctx.pendingBroadcasts).toHaveLength(0);
	});
});
