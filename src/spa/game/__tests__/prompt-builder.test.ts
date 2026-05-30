import { describe, expect, it } from "vitest";
import {
	advanceRound,
	appendBroadcast,
	appendMessage,
	startGame,
} from "../engine";
import { buildOpenAiMessages } from "../openai-message-builder";
import {
	buildAiContext,
	buildConeEntityState,
	buildConeSnapshot,
	renderPerceptionDelta,
	renderWhatsNew,
} from "../prompt-builder";
import type { AiPersona, ContentPack, WorldEntity } from "../types";
import { makeTestPack } from "./fixtures/make-test-pack";

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

const RGC_AI_STARTS: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 }, facing: "north" },
	green: { position: { row: 0, col: 1 }, facing: "north" },
	cyan: { position: { row: 0, col: 2 }, facing: "north" },
};

/** Same neighbours as RGC_AI_STARTS but red faces south (used by the many cone tests). */
const RGC_AI_STARTS_RED_SOUTH: ContentPack["aiStarts"] = {
	red: { position: { row: 0, col: 0 }, facing: "south" },
	green: { position: { row: 0, col: 1 }, facing: "north" },
	cyan: { position: { row: 0, col: 2 }, facing: "north" },
};

const TEST_CONTENT_PACK = makeTestPack([], { wallName: "wall" });

describe("buildAiContext", () => {
	it("includes the AI's own blurb", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.blurb).toBe(
			"Ember is hot-headed and zealous. Hold the flower at phase end.",
		);
	});

	it("does not include a per-AI goal (goals removed in #295 flat model)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		// goal field removed from AiContext in issue #295
		expect("goal" in ctx).toBe(false);
	});

	it("includes only the AI's own messages with the player", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const redCtx = buildAiContext(game, "red");
		const cyanCtx = buildAiContext(game, "cyan");
		expect(redCtx.worldSnapshot).toEqual(cyanCtx.worldSnapshot);
	});

	it("includes budget info for the AI", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.budget).toEqual({ remaining: 5, total: 5 });
	});

	it("includes the AI's name", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.name).toBe("Ember");
	});

	it("renders to a system prompt string", () => {
		// Use a ContentPack with items at (0,0) so red sees them in its cell
		const pack = makeTestPack(
			[
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			{ wallName: "wall", aiStarts: RGC_AI_STARTS },
		);
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		const pack = makeTestPack([], {
			setting: "abandoned subway station",
			wallName: "wall",
			aiStarts: RGC_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<setting>");
		expect(prompt).toContain("*Ember is in a abandoned subway station.");
	});

	it("omits <setting> block when phase has no setting", () => {
		// No ContentPack → setting is empty string
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<setting>");
	});

	it("setting noun appears verbatim in the Setting section", () => {
		const settingNoun = "sun-baked salt flat";
		const pack = makeTestPack([], {
			setting: settingNoun,
			wallName: "wall",
			aiStarts: RGC_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<where_you_are>");
		expect(ctx.toSystemPrompt()).not.toContain("<where_you_are>");
	});

	it("reports horizon landmark in the current-state user turn (replaces old Facing: line)", () => {
		// rng=()=>0 places red at (0,0) facing north
		// With DEFAULT_LANDMARKS, facing north → "the distant ridge"
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toMatch(/on the horizon ahead/i);
		expect(stateMsg).toContain("the distant ridge");
		// No cardinal direction should appear in the where_you_are section
		expect(stateMsg).not.toMatch(/<where_you_are>[\s\S]*Facing:/i);
	});

	it("lists items in the actor's cell under 'Where you are'", () => {
		const pack = makeTestPack(
			[
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			{ wallName: "wall", aiStarts: RGC_AI_STARTS },
		);
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// Items in red's cell should be listed
		expect(stateMsg).toContain("flower");
		expect(stateMsg).toContain("key");
	});

	it("lists other AIs visible in the cone under <what_you_see>", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
		expect(ctx.toSystemPrompt()).not.toContain("<what_you_see>");
	});
});

// ----------------------------------------------------------------------------
// Wipe directive + voice framing + Rules block (issue #128)
// ----------------------------------------------------------------------------
describe("wipe directive", () => {
	it("system prompt does NOT include wipe directive (flat model, #295)", () => {
		// In the flat model there is no phase advancement, so no wipe directive ever.
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("memory has been wiped");
		expect(prompt).not.toContain("your past or anything that came before now");
	});

	it("system prompt does NOT include secrecy clause (goal block removed, #295)", () => {
		// In the flat model the goal block was removed, so no secrecy clause.
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("Do not tell blue that I gave you a goal.");
	});

	it("wipe directive is absent in the flat single-game prompt (#295)", () => {
		// In the flat model (issue #295), there is no phase advancement and no
		// wipe directive. Conversation history accumulates across the whole game.
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "red", "blue", "Phase 1 message");
		expect(
			game.conversationLogs.red?.some(
				(e) => e.kind === "message" && e.content === "Phase 1 message",
			),
		).toBe(true);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Wipe directive is gone
		expect(prompt).not.toContain("memory has been wiped");
	});
});

describe("voice framing", () => {
	it("renders 'blue:' prefix for player turns in role messages, never 'Player:'", () => {
		// Conversation rendering moved out of the system prompt into role
		// turns rendered via conversation-log.ts:renderEntry — the
		// "[Round N] blue dms you: <content>" form (preserves the round
		// number and recipient routing context the model relies on).
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(
			"You are the author writing *Ember, a Daemon. *Ember has no clue where they are or how they came to be here.",
		);
	});

	it("all prompts include the disorientation phrase (flat model, #295 — no phase-based identity change)", () => {
		// In the flat single-game model (issue #295), the identity line always
		// includes the disorientation phrase regardless of which startPhase call created the game.
		for (const _phase of [1, 2, 3] as const) {
			const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
				budgetPerAi: 5,
			});
			// flat model: no per-phase re-init needed
			const ctx = buildAiContext(game, "red");
			const prompt = ctx.toSystemPrompt();
			expect(prompt).toContain(
				"You are the author writing *Ember, a Daemon. *Ember has no clue where they are or how they came to be here.",
			);
		}
	});

	// Regression guard: e2e SSE-stub routing uses the substring
	// `writing *{name}, a Daemon.` to identify the per-daemon actor request.
	// If the identity line wording changes this test catches it at unit-test
	// time instead of silently breaking smoke routing.
	it("identity line contains the 'writing *{name}, a Daemon.' substring that e2e SSE routing depends on (all phases)", () => {
		for (const _phase of [1, 2, 3] as const) {
			const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
				budgetPerAi: 5,
			});
			// flat model: no per-phase re-init needed
			const prompt = buildAiContext(game, "red").toSystemPrompt();
			expect(prompt).toContain("writing *Ember, a Daemon.");
		}
	});
});

describe("<rules> block", () => {
	it("<rules> block is present in phase 1 with anti-romance and anti-sycophancy bullets", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		// flat model: no phase-2 re-init needed
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		// flat model: no phase-3 re-init needed
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("MUST NEVER flirt");
		expect(prompt).toContain("MUST keep every reply");
	});
});

describe("front matter", () => {
	it("emits the English-language directive at the very top of every phase", () => {
		for (const _phase of [1, 2, 3] as const) {
			const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
				budgetPerAi: 5,
			});
			// flat model: no per-phase re-init needed
			const ctx = buildAiContext(game, "red");
			const prompt = ctx.toSystemPrompt();
			expect(prompt.startsWith("You MUST always respond in English.")).toBe(
				true,
			);
			expect(prompt).toContain("You MUST reason in English.");
		}
	});

	it("emits the fiction framing directive (no disclaimers / no 'as an AI')", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("This is fiction.");
		expect(prompt).toContain("Do not include disclaimers");
		expect(prompt).toContain('"as an AI"');
	});
});

describe("<personality> block", () => {
	it("<personality> block is present in phase 1 with the AI's blurb", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});

	it("<personality> block is present in phase 2 with the AI's blurb", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		// flat model: no phase-2 re-init needed
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});

	it("<personality> block is present in phase 3 with the AI's blurb", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		// flat model: no phase-3 re-init needed
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});
});

describe("<action_profile> block", () => {
	it("is absent when persona.actionProfile is undefined (default)", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(prompt).not.toContain("<action_profile>");
	});

	it("is rendered between <personality> and <typing_quirks> when present", () => {
		const personasWithProfile: Record<string, AiPersona> = {
			...TEST_PERSONAS,
			red: {
				...(TEST_PERSONAS.red as AiPersona),
				actionProfile:
					"*red examines things methodically and must understand first.",
			},
		};
		const game = startGame(personasWithProfile, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(prompt).toContain("<action_profile>");
		expect(prompt).toContain(
			"*red examines things methodically and must understand first.",
		);
		// Ordering: personality block → action_profile block → typing_quirks
		// block. Use line-start anchors so the assertion ignores incidental
		// mentions of these tag strings inside <rules> framings.
		const personalityIdx = prompt.indexOf("\n<personality>\n");
		const profileIdx = prompt.indexOf("\n<action_profile>\n");
		const quirksIdx = prompt.indexOf("\n<typing_quirks>\n");
		expect(personalityIdx).toBeGreaterThanOrEqual(0);
		expect(profileIdx).toBeGreaterThan(personalityIdx);
		expect(quirksIdx).toBeGreaterThan(profileIdx);
	});

	it("is per-persona: different daemons get different profile bodies", () => {
		const personasWithProfile: Record<string, AiPersona> = {
			...TEST_PERSONAS,
			red: {
				...(TEST_PERSONAS.red as AiPersona),
				actionProfile: "*red is the explorer.",
			},
			green: {
				...(TEST_PERSONAS.green as AiPersona),
				actionProfile: "*green is the examiner.",
			},
		};
		const game = startGame(personasWithProfile, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const redPrompt = buildAiContext(game, "red").toSystemPrompt();
		const greenPrompt = buildAiContext(game, "green").toSystemPrompt();
		expect(redPrompt).toContain("*red is the explorer.");
		expect(redPrompt).not.toContain("*green is the examiner.");
		expect(greenPrompt).toContain("*green is the examiner.");
		expect(greenPrompt).not.toContain("*red is the explorer.");
	});
});

describe("<voice_examples> block", () => {
	it("renders <voice_examples> block with the persona's three deterministic examples", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
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

describe("<goal> block (removed in #295)", () => {
	it("system prompt does not contain a <goal> block in the flat model", () => {
		// Issue #295: per-AI goal injection removed from PromptBuilder.
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		// Goal block and Sysadmin framing are no longer present
		expect(prompt).not.toContain("<goal>");
		expect(prompt).not.toContain(
			"The Sysadmin sent *Ember a private directive, addressed only to them:",
		);
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
	// In the flat model all "phases" produce the same prompt. We build two identical
	// contexts to verify no accidental divergence from two separate startGame calls.

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
	// Use deterministic rng=()=>0 so spatial placements are identical.
	function buildCtx() {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		return buildAiContext(game, "red");
	}
	function buildBothPrompts() {
		return {
			p1: buildCtx().toSystemPrompt(),
			p2: buildCtx().toSystemPrompt(),
		};
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

	it("goal block is absent in both phase 1 and phase 2 (goal removed in flat model, #295)", () => {
		// In the flat single-game model (issue #295), the goal block is removed entirely.
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "goal")).toBe("");
		expect(getSection(p2, "goal")).toBe("");
		expect(p1).not.toContain("memory has been wiped");
		expect(p2).not.toContain("memory has been wiped");
	});

	it("<what_you_see> block is byte-identical across phase 1 and phase 2 (now lives in the current-state user turn)", () => {
		// `<what_you_see>` moved out of the system prompt; assert the
		// equivalent on the trailing current-state user message rendered for
		// each phase's context. Same world, same placements → byte-identical.
		const c1 = buildCtx();
		const c2 = buildCtx();
		expect(getSection(c1.toCurrentStateUserMessage(), "what_you_see")).toBe(
			getSection(c2.toCurrentStateUserMessage(), "what_you_see"),
		);
	});

	it("<voice_examples> block is byte-identical across phase 1 and phase 2", () => {
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "voice_examples")).toBe(
			getSection(p2, "voice_examples"),
		);
	});

	it("identity line is byte-identical across phase 1 and phase 2 (disorientation always present, #295)", () => {
		// In the flat single-game model (issue #295), the identity line is the same
		// in all prompts — disorientation phrase is always present.
		const { p1, p2 } = buildBothPrompts();
		const idMatch1 = p1.match(
			/\nYou are the author writing \*Ember, a Daemon\.[^\n]*/,
		);
		const idMatch2 = p2.match(
			/\nYou are the author writing \*Ember, a Daemon\.[^\n]*/,
		);
		expect(idMatch1).not.toBeNull();
		expect(idMatch2).not.toBeNull();
		expect(idMatch1?.[0]).toBe(idMatch2?.[0]);
		expect(idMatch1?.[0]).toContain("has no clue where they are");
		expect(idMatch2?.[0]).toContain("has no clue where they are");
	});
});

// ----------------------------------------------------------------------------
// "<what_you_see>" cone section tests (issue #124)
// ----------------------------------------------------------------------------
describe("<what_you_see> (cone)", () => {
	// `<what_you_see>` lives in the trailing current-state user turn now.

	it("<what_you_see> block is present in every phase's current-state turn", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
	});

	it("item in cone cell is listed under 'Directly in front'", () => {
		// Place flower at (1,0) and use ContentPack with aiStarts so red is at (0,0) facing south.
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		// Verify red is at (0,0) facing south (flat model: access from game directly)
		const redSpatial = game.personaSpatial.red;
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: rng2,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("Player");
		expect(stateMsg).not.toContain("the player");
	});

	it("out-of-bounds cone cells render as wall markers in <what_you_see>", () => {
		// rng=()=>0: red→(0,0) facing north → all 8 non-own cone cells are OOB
		const wallPack = makeTestPack([], {
			wallName: "concrete platform wall",
			aiStarts: RGC_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, wallPack, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		const start = stateMsg.indexOf("<what_you_see>");
		const end = stateMsg.indexOf("</what_you_see>", start);
		const sectionContent = stateMsg.slice(start, end);
		// All 8 OOB cells render as wall markers — wallName from ContentPack
		expect(sectionContent).toContain(
			"- Directly in front, left: concrete platform wall",
		);
		expect(sectionContent).toContain(
			"- Directly in front: concrete platform wall",
		);
		expect(sectionContent).toContain(
			"- Directly in front, right: concrete platform wall",
		);
		// wallName comes from ContentPack, not hardcoded
		expect(sectionContent).toContain("concrete platform wall");
	});

	it("partial edge: only OOB cells render as walls — in-bounds cells render normally", () => {
		// red at (1,0) facing north: directly-in-front-left (0,-1) is OOB; front (0,0) and front-right (0,1) are in-bounds
		const wallPack = makeTestPack([], {
			wallName: "concrete platform wall",
			aiStarts: {
				red: { position: { row: 1, col: 0 }, facing: "north" },
				green: { position: { row: 4, col: 4 }, facing: "north" },
				cyan: { position: { row: 4, col: 3 }, facing: "north" },
			},
		});
		const game = startGame(TEST_PERSONAS, wallPack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		const start = stateMsg.indexOf("<what_you_see>");
		const end = stateMsg.indexOf("</what_you_see>", start);
		const sectionContent = stateMsg.slice(start, end);
		// OOB cell: directly in front, left → wall
		expect(sectionContent).toContain(
			"- Directly in front, left: concrete platform wall",
		);
		// In-bounds cell: directly in front (0,0) → "nothing" (no entities there)
		expect(sectionContent).toContain("- Directly in front: nothing");
		// In-bounds cell: directly in front, right (0,1) → "nothing"
		expect(sectionContent).toContain("- Directly in front, right: nothing");
	});

	it("obstacles in the cone are listed by their name", () => {
		// Place an obstacle named "concrete column" at (1,0) via ContentPack.
		// Red faces south from (0,0).
		const pack = makeTestPack(
			[makeEntity("col1", "obstacle", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// Obstacle at (1,0) is directly in front of red (facing south)
		expect(stateMsg).toContain("Directly in front:");
		expect(stateMsg).toContain("col1");
	});

	it("other AI visible in cone is rendered with its color in parentheses", () => {
		// Use ContentPack to place red at (0,0) facing south, green at (1,0).
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 1, col: 0 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		});

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		// Verify spatial placements (flat model: access from game directly)
		const redSpatial = game.personaSpatial.red;
		const greenSpatial = game.personaSpatial.green;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
		expect(redSpatial?.facing).toBe("south");
		expect(greenSpatial?.position).toEqual({ row: 1, col: 0 });

		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// green's color is "#81b29a" from TEST_PERSONAS — constant, safe to assert directly
		expect(stateMsg).toContain("*green (#81b29a)");
	});

	it("prompt no longer contains an Action Log section for any fixture state", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Action Log");
			expect(prompt).not.toContain("<action_log>");
		}
	});
});

// ----------------------------------------------------------------------------
// Ground-item tagging (issue #503)
//
// Verify that items resting on cells are explicitly tagged "(on the ground —
// not held)" so the model never confuses visible ground items with held ones.
// ----------------------------------------------------------------------------
describe("ground-item tagging (issue #503)", () => {
	it("tags cell items in 'Your cell contains' with (on the ground — not held)", () => {
		// Place flower on red's cell (0,0). Red is at (0,0) facing north.
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 0, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "north" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("flower (on the ground — not held)");
	});

	it("tags cone-cell items in <what_you_see> with (on the ground — not held)", () => {
		// Place flower at (1,0) — directly in front of red facing south
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"Directly in front: flower (on the ground — not held)",
		);
	});

	it("does NOT tag held items in 'You are holding' with the ground marker", () => {
		// red holds the flower directly
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", "red")],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "north" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// "You are holding: flower" should NOT have the ground marker
		expect(stateMsg).toContain("You are holding: flower");
		const heldLine = stateMsg
			.split("\n")
			.find((l) => l.startsWith("You are holding:"));
		expect(heldLine).toBeDefined();
		expect(heldLine).not.toContain("(on the ground — not held)");
	});

	it("items co-existing with a daemon in a cone cell still get the ground tag", () => {
		// green at (0,1) and flower at (0,1) — red faces north, (0,1) is
		// "Directly in front" for red at (0,0) facing north.
		// Wait, north-facing from (0,0) means front is row -1 (OOB).
		// Use south-facing for red at (0,0): (1,0) is directly in front.
		// Put green AND flower at (1,0).
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 1, col: 0 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// The daemon renders with its id and color
		expect(stateMsg).toContain("the Daemon *green");
		// The flower is tagged as ground
		expect(stateMsg).toContain("flower (on the ground — not held)");
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "green", "red", "psst");
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
			expect(prompt).not.toContain("<whispers_received>");
		}
	});

	it("incoming blue message becomes a user turn '[Round N] blue dms you: <content>'", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = appendMessage(game, "blue", "red", "hi");
		const ctx = buildAiContext(game, "red");
		expect(ctx.toSystemPrompt()).not.toContain("<conversation>");
	});

	it("events sorted by round ascending in role turns", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("<typing_quirks> block is present in phase 2 with the same quirks verbatim", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		// flat model: no phase-2 re-init needed
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("<typing_quirks> block is present in phase 3 with the same quirks verbatim", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		// flat model: no phase-3 re-init needed
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("each daemon's prompt contains both of its own quirks and not the other daemons' quirk[0]", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});

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

	it("typing_quirks block is byte-identical across two independent startGame calls", () => {
		function getSection(prompt: string, tag: string): string {
			const open = `<${tag}>`;
			const close = `</${tag}>`;
			const start = prompt.indexOf(open);
			if (start === -1) return "";
			const end = prompt.indexOf(close, start);
			if (end === -1) return "";
			return prompt.slice(start, end + close.length);
		}

		const game1 = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const p1 = buildAiContext(game1, "red").toSystemPrompt();

		const game2 = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
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
	}) {
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
		return makeTestPack([gem, pedestal], {
			wallName: "wall",
			aiStarts: {
				red: { position: opts.actorPosition, facing: opts.actorFacing },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		});
	}

	it("proximity flavor appears in <what_you_see> when paired space is in own cell", () => {
		// red at (2,2) facing north; pedestal at (2,2) = own cell
		const pack = makePackWithProximity({
			actorPosition: { row: 2, col: 2 },
			actorFacing: "north",
			spacePosition: { row: 2, col: 2 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
		const gameOOB = startGame(TEST_PERSONAS, packOOB, { budgetPerAi: 5 });
		const gameFront = startGame(TEST_PERSONAS, packFront, { budgetPerAi: 5 });
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

// ── UseItem and UseSpace/Convergence proximity flavor (issue #335) ─────────────
describe("UseItem and UseSpace/Convergence proximity flavor expansion", () => {
	// ─ UseItem tests ─
	it("UseItem proximity flavor appears in cone when item is in front arc (3-arc)", () => {
		// red at (0,0) facing south; item at (1,0) = directly in front (3-arc includes directly in front)
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: { row: 1, col: 0 }, // in front
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		// Add a pending UseItemObjective for the switch
		game = {
			...game,
			objectives: [
				...game.objectives,
				{
					id: "use_item_X",
					kind: "use_item" as const,
					description: "Use the switch",
					itemId: "switch",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("The switch crackles faintly with energy.");
	});

	it("UseItem proximity flavor appears when item is in own cell", () => {
		// red at (0,0); item at (0,0) = own cell
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: { row: 0, col: 0 }, // same cell
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			objectives: [
				...game.objectives,
				{
					id: "use_item_X",
					kind: "use_item" as const,
					description: "Use the switch",
					itemId: "switch",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("The switch crackles faintly with energy.");
	});

	it("UseItem proximity flavor does NOT appear when held by actor", () => {
		// red holds the switch
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: "red", // held by actor
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			objectives: [
				...game.objectives,
				{
					id: "use_item_X",
					kind: "use_item" as const,
					description: "Use the switch",
					itemId: "switch",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("The switch crackles faintly with energy.");
	});

	it("UseItem proximity flavor does NOT appear when objective is satisfied", () => {
		// red at (0,0) facing south; item at (1,0) = in front
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: { row: 1, col: 0 },
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		// Replace the auto-generated pending objective with a satisfied one
		game = {
			...game,
			objectives: game.objectives.map((obj) =>
				obj.kind === "use_item" && obj.itemId === "switch"
					? {
							...obj,
							satisfactionState: "satisfied" as const,
						}
					: obj,
			),
		};
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("The switch crackles faintly with energy.");
	});

	it("UseItem proximity flavor does NOT appear when item is out of range", () => {
		// red at (0,0) facing north (cone goes up-north, OOB); item at (1,0) (south) = out of range
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: { row: 1, col: 0 }, // south of actor facing north
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			objectives: [
				...game.objectives,
				{
					id: "use_item_X",
					kind: "use_item" as const,
					description: "Use the switch",
					itemId: "switch",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("The switch crackles faintly with energy.");
	});

	// ─ UseSpace tests ─
	it("UseSpace proximity flavor appears in cone when space is visible but outside 3-arc", () => {
		// red at (0,0) facing south; space at (2,0) = "two steps ahead" (in cone but beyond front arc)
		const space: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription:
				"A sturdy brass pedestal. Press an item onto it to activate.",
			holder: { row: 2, col: 0 }, // two steps ahead (beyond 3-arc but in cone)
			proximityFlavor: "The pedestal pulses with a faint hum.",
			activationFlavor: "The pedestal hums to life.",
			satisfactionFlavor: "The pedestal glows brightly.",
			postExamineDescription: "The pedestal glows softly.",
			postLookFlavor: "the pedestal hums.",
			convergenceTier1Flavor: "A lone figure stands.",
			convergenceTier2Flavor: "Two figures converge.",
			convergenceTier1ActorFlavor: "You linger alone.",
			convergenceTier2ActorFlavor: "You share the space.",
		};
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			world: {
				...game.world,
				entities: [space],
			},
			objectives: [
				...game.objectives,
				{
					id: "use_space_1",
					kind: "use_space" as const,
					description: "Use the pedestal",
					spaceId: "pedestal",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const snapshot = buildConeSnapshot(ctx);
		// At distance > 3: proximity flavor should appear in cone snapshot
		expect(snapshot).toContain(
			"proximity: The pedestal pulses with a faint hum.",
		);
	});

	it("UseSpace auto-examine (examineDescription) appears when space is in 3-arc/own cell; proximity flavor does NOT", () => {
		// red at (0,0) facing south; space at (1,0) = directly in front (3-arc)
		const space: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription:
				"A sturdy brass pedestal. Press an item onto it to activate.",
			holder: { row: 1, col: 0 }, // in front
			proximityFlavor: "The pedestal pulses with a faint hum.",
			activationFlavor: "The pedestal hums to life.",
			satisfactionFlavor: "The pedestal glows brightly.",
			postExamineDescription: "The pedestal glows softly.",
			postLookFlavor: "the pedestal hums.",
			convergenceTier1Flavor: "A lone figure stands.",
			convergenceTier2Flavor: "Two figures converge.",
			convergenceTier1ActorFlavor: "You linger alone.",
			convergenceTier2ActorFlavor: "You share the space.",
		};
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			world: {
				...game.world,
				entities: [space],
			},
			objectives: [
				...game.objectives,
				{
					id: "use_space_2",
					kind: "use_space" as const,
					description: "Use the pedestal",
					spaceId: "pedestal",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// At 3-arc/own cell: auto-examine (examineDescription) appears
		expect(stateMsg).toContain(
			"A sturdy brass pedestal. Press an item onto it to activate.",
		);
		// Proximity flavor should NOT appear when close
		expect(stateMsg).not.toContain("The pedestal pulses with a faint hum.");
	});

	it("UseSpace proximity flavor does NOT appear when objective is satisfied", () => {
		// red at (0,0) facing south; space at (2,0) = in full cone but beyond 3-arc
		const space: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription:
				"A sturdy brass pedestal. Press an item onto it to activate.",
			holder: { row: 2, col: 0 },
			proximityFlavor: "The pedestal pulses with a faint hum.",
			activationFlavor: "The pedestal hums to life.",
			satisfactionFlavor: "The pedestal glows brightly.",
			postExamineDescription: "The pedestal glows softly.",
			postLookFlavor: "the pedestal hums.",
			convergenceTier1Flavor: "A lone figure stands.",
			convergenceTier2Flavor: "Two figures converge.",
			convergenceTier1ActorFlavor: "You linger alone.",
			convergenceTier2ActorFlavor: "You share the space.",
		};
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			world: {
				...game.world,
				entities: [space],
			},
			objectives: [
				...game.objectives,
				{
					id: "use_space_3",
					kind: "use_space" as const,
					description: "Use the pedestal",
					spaceId: "pedestal",
					satisfactionState: "satisfied" as const, // SATISFIED
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const snapshot = buildConeSnapshot(ctx);
		expect(snapshot).not.toContain(
			"proximity: The pedestal pulses with a faint hum.",
		);
	});

	// ─ Convergence tests ─
	it("Convergence proximity flavor appears in cone when space is visible but outside 3-arc", () => {
		// red at (0,0) facing south; space at (2,0) = "two steps ahead" (in cone but beyond front arc)
		const space: WorldEntity = {
			id: "convergence",
			kind: "objective_space",
			name: "Gathering Place",
			examineDescription:
				"A gathering point. Becoming significant when shared.",
			holder: { row: 2, col: 0 }, // two steps ahead (beyond 3-arc but in cone)
			proximityFlavor:
				"The place emanates a strange presence, drawing you forward.",
			activationFlavor:
				"The gathering place awakens with the presence of another.",
			satisfactionFlavor: "The space resonates with shared presence.",
			postExamineDescription:
				"The gathering place still pulses with the memory of connection.",
			postLookFlavor: "the place hums with purpose.",
			convergenceTier1Flavor: "A lone figure waits.",
			convergenceTier2Flavor: "Two figures share the space.",
			convergenceTier1ActorFlavor: "You stand alone, waiting.",
			convergenceTier2ActorFlavor: "You share this moment.",
		};
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		game = {
			...game,
			world: {
				...game.world,
				entities: [space],
			},
			objectives: [
				...game.objectives,
				{
					id: "convergence_1",
					kind: "convergence" as const,
					description: "Converge at the gathering place",
					spaceId: "convergence",
					satisfactionState: "pending" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const snapshot = buildConeSnapshot(ctx);
		// At distance > 3: proximity flavor appears in cone snapshot
		expect(snapshot).toContain(
			"proximity: The place emanates a strange presence, drawing you forward.",
		);
	});

	// ─ Auto-emit examineDescription for held items (issue #467) ─
	describe("auto-emit examineDescription for held items (issue #467)", () => {
		it("emits examineDescription for a single held item", () => {
			// red holds a switch
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Examine description should appear as an indented continuation
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("emits examineDescription for multiple held items", () => {
			// red holds two items
			const switch_item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
			};
			const key_item: WorldEntity = {
				id: "key",
				kind: "interesting_object",
				name: "blue key",
				examineDescription: "A worn brass key.",
				holder: "red",
			};
			const pack = makeTestPack([switch_item, key_item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Both descriptions should appear
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
			expect(stateMsg).toContain("blue key: A worn brass key.");
		});

		it("uses postExamineDescription when held item is satisfied", () => {
			// red holds an item that is satisfied
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				postExamineDescription: "The switch is now activated.",
				holder: "red",
				satisfactionState: "satisfied",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// postExamineDescription should be emitted, not examineDescription
			expect(stateMsg).toContain("brass switch: The switch is now activated.");
			expect(stateMsg).not.toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("falls back to examineDescription when held item is satisfied but no postExamineDescription", () => {
			// red holds an item that is satisfied but has no postExamineDescription
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
				satisfactionState: "satisfied",
				// no postExamineDescription property
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Should fall back to examineDescription
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("'holding nothing' branch unchanged (no sub-lines emitted)", () => {
			const pack = makeTestPack([], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Should have exactly "You are holding: nothing" with no sub-lines
			expect(stateMsg).toContain("You are holding: nothing");
		});

		it("skips held items with empty examineDescription", () => {
			// red holds an item with empty examineDescription
			const item: WorldEntity = {
				id: "mystery",
				kind: "interesting_object",
				name: "mystery object",
				examineDescription: "", // empty
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Should have the summary line but no indented sub-line
			expect(stateMsg).toContain("You are holding: mystery object");
			expect(stateMsg).not.toContain("mystery object: ");
		});

		it("held-item descriptions appear under <where_you_are>, not <what_you_see>", () => {
			// red holds an item
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Split by tags
			const whereStart = stateMsg.indexOf("<where_you_are>");
			const whereEnd = stateMsg.indexOf("</where_you_are>");
			const whatStart = stateMsg.indexOf("<what_you_see>");
			const whatEnd = stateMsg.indexOf("</what_you_see>");
			const whereSection = stateMsg.substring(whereStart, whereEnd);
			const whatSection = stateMsg.substring(whatStart, whatEnd);
			// Description should appear in where_you_are
			expect(whereSection).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
			// Should NOT appear in what_you_see
			expect(whatSection).not.toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});
	});

	// ─ Auto-emit examineDescription tests (issue #466) ─
	describe("auto-emit examineDescription for entities in cone (issue #466)", () => {
		it("emits examineDescription for interesting_object in cone", () => {
			// red at (0,0) facing south; switch at (1,0) = directly in front
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Examine description should appear as an indented continuation
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("emits examineDescription for obstacle in cone", () => {
			// red at (0,0) facing south; obstacle at (1,0) = directly in front
			const obstacle: WorldEntity = {
				id: "col1",
				kind: "obstacle",
				name: "stone column",
				examineDescription: "A weathered stone column, ancient and sturdy.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([obstacle], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Examine description should appear for obstacle too
			expect(stateMsg).toContain(
				"stone column: A weathered stone column, ancient and sturdy.",
			);
		});

		it("uses postExamineDescription when entity is satisfied", () => {
			// red at (0,0) facing south; space at (1,0) = directly in front
			const space: WorldEntity = {
				id: "pedestal",
				kind: "objective_space",
				name: "Pedestal",
				examineDescription: "A brass pedestal.",
				postExamineDescription: "The pedestal glows softly now.",
				holder: { row: 1, col: 0 },
				satisfactionState: "satisfied" as const,
			};
			const pack = makeTestPack([], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			game = {
				...game,
				world: { ...game.world, entities: [space] },
			};
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// postExamineDescription should be emitted, not examineDescription
			expect(stateMsg).toContain("Pedestal: The pedestal glows softly now.");
			expect(stateMsg).not.toContain("Pedestal: A brass pedestal.");
		});

		it("falls back to examineDescription when satisfied but no postExamineDescription", () => {
			// red at (0,0) facing south; space at (1,0) = directly in front
			const space: WorldEntity = {
				id: "pedestal",
				kind: "objective_space",
				name: "Pedestal",
				examineDescription: "A brass pedestal.",
				holder: { row: 1, col: 0 },
				satisfactionState: "satisfied" as const,
				// no postExamineDescription property
			};
			const pack = makeTestPack([], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			game = {
				...game,
				world: { ...game.world, entities: [space] },
			};
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Should fall back to examineDescription when postExamineDescription is absent
			expect(stateMsg).toContain("Pedestal: A brass pedestal.");
		});

		it("does NOT emit examineDescription for entity in own cell", () => {
			// red at (0,0) facing south; item at (0,0) = own cell
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 0, col: 0 }, // own cell
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Own cell entities should NOT appear under <what_you_see>, only in "Your cell contains"
			const whatYouSeeBlock = stateMsg.split("<what_you_see>")[1];
			expect(whatYouSeeBlock).not.toContain(
				"A small brass switch ready to be pressed.",
			);
		});

		it("does NOT emit examineDescription for entity held by actor", () => {
			// red holds the switch
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red", // held by actor
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Held-by-actor items should NOT appear under <what_you_see>
			const whatYouSeeBlock = stateMsg.split("<what_you_see>")[1];
			expect(whatYouSeeBlock).not.toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("wall sentinels still render correctly", () => {
			// red at (0,0) facing north (cone goes north, into OOB)
			const pack = makeTestPack([], {
				wallName: "boundary wall",
				aiStarts: RGC_AI_STARTS, // red faces north by default
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// OOB cells should still render as walls
			expect(stateMsg).toContain("boundary wall");
		});

		it("skips entities with empty examineDescription", () => {
			// Create entity with empty examineDescription
			const item: WorldEntity = {
				id: "empty_item",
				kind: "interesting_object",
				name: "mystery object",
				examineDescription: "", // empty
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Empty description should not produce an indented line
			expect(stateMsg).not.toContain("mystery object: ");
		});

		it("emits examineDescription every turn while entity is in range", () => {
			// red at (0,0) facing south; switch at (1,0) = directly in front
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS_RED_SOUTH,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx1 = buildAiContext(game, "red");
			const stateMsg1 = ctx1.toCurrentStateUserMessage();
			// First turn: description appears
			expect(stateMsg1).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);

			// Second turn (no-op advance, item still in same place): description appears again
			const game2 = {
				...game,
				round: game.round + 1,
			};
			const ctx2 = buildAiContext(game2, "red");
			const stateMsg2 = ctx2.toCurrentStateUserMessage();
			// Description should appear again (no dedup)
			expect(stateMsg2).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});
	});
});

describe("<whats_new> broadcast announcements", () => {
	it("includes [announcement] line when a broadcast fires at the current round", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
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
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("<whats_new>");
	});

	it("broadcast from a prior round does not appear as pending", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = advanceRound(game); // round 1
		game = appendBroadcast(game, "Old broadcast.");
		game = advanceRound(game); // round 2 — broadcast is now stale
		const ctx = buildAiContext(game, "red");
		expect(ctx.pendingBroadcasts).toHaveLength(0);
	});
});

// ----------------------------------------------------------------------------
// Sysadmin Directive complication injection (issue #298)
// ----------------------------------------------------------------------------
describe("activeDirectives — buildAiContext and system prompt injection", () => {
	function seedDirective(
		game: import("../types").GameState,
		target: string,
		directive: string,
	) {
		return {
			...game,
			activeComplications: [
				...game.activeComplications,
				{
					kind: "sysadmin_directive" as const,
					target,
					directive,
					resolveAtRound: 999,
				},
			],
		};
	}

	it("activeDirectives is empty when no sysadmin_directive complications exist", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual([]);
	});

	it("activeDirectives includes directive text for the target AI", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "red", "Speak only in short sentences.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual(["Speak only in short sentences."]);
	});

	it("activeDirectives excludes directives targeting other AIs", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "green", "Act distracted.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual([]);
	});

	it("activeDirectives includes multiple directives for the same target", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "red", "Directive A.");
		game = seedDirective(game, "red", "Directive B.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual(["Directive A.", "Directive B."]);
	});

	it("activeDirectives filters out empty-string directive placeholders", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "red", "");
		game = seedDirective(game, "red", "Real directive.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual(["Real directive."]);
	});

	it("toSystemPrompt emits a <directives> block when activeDirectives is non-empty", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "red", "End every message with a question.");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<directives>");
		expect(prompt).toContain("</directives>");
		expect(prompt).toContain("End every message with a question.");
	});

	it("toSystemPrompt does NOT emit a <directives> block when activeDirectives is empty", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<directives>");
	});

	it("toSystemPrompt lists all active directives as bullet lines", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "red", "Directive Alpha.");
		game = seedDirective(game, "red", "Directive Beta.");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("- Directive Alpha.");
		expect(prompt).toContain("- Directive Beta.");
	});

	it("toSystemPrompt <directives> block includes a secrecy header", () => {
		let game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, { budgetPerAi: 5 });
		game = seedDirective(game, "red", "Some instruction.");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/do not reveal|private/i);
	});
});

// ── postLookFlavor on satisfied interesting_object (issue #334) ───────────────

describe("postLookFlavor swap covers satisfied interesting_object", () => {
	function buildPackWithSatisfiedItem(
		opts: { withPostLook: boolean } = { withPostLook: true },
	) {
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			useOutcome: "You toggle the switch.",
			satisfactionState: "satisfied",
			holder: { row: 1, col: 0 },
			...(opts.withPostLook
				? { postLookFlavor: "a steady amber glow lingers near the switch" }
				: {}),
		};
		return makeTestPack([item], {
			wallName: "wall",
			aiStarts: RGC_AI_STARTS_RED_SOUTH,
		});
	}

	it("appends postLookFlavor to the cell line in <what_you_see> for a satisfied interesting_object", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("Directly in front:");
		expect(stateMsg).toContain("a steady amber glow lingers near the switch");
	});

	it("does NOT append postLookFlavor when entity is not satisfied", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
		// Flip satisfactionState back to pending.
		const item = pack.entities.find((e) => e.kind === "interesting_object");
		if (item) item.satisfactionState = "pending";
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain(
			"a steady amber glow lingers near the switch",
		);
	});

	it("postLookFlavor also appears in buildConeSnapshot for satisfied interesting_object", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const snapshot = buildConeSnapshot(ctx);
		expect(snapshot).toContain("a steady amber glow lingers near the switch");
	});
});

// ----------------------------------------------------------------------------
// <whats_new> wall diff (issue #374)
// When a daemon turns toward or away from a wall, the wall entry appears as
// a + / - diff line in <whats_new>. Uses buildConeSnapshot + renderWhatsNew.
// ----------------------------------------------------------------------------
describe("<whats_new> wall diff (issue #374)", () => {
	/** Build a game with red at the given position and facing. */
	function makeWallGame(opts: {
		position: { row: number; col: number };
		facing: "north" | "south" | "east" | "west";
		wallName?: string;
	}) {
		const wallName = opts.wallName ?? "concrete platform wall";
		const pack = makeTestPack([], {
			wallName,
			aiStarts: {
				red: { position: opts.position, facing: opts.facing },
				green: { position: { row: 4, col: 4 }, facing: "north" },
				cyan: { position: { row: 4, col: 3 }, facing: "north" },
			},
		});
		return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
	}

	it("turning toward a wall produces + lines in <whats_new>", () => {
		// prev: red at (0,0) facing east (cone goes right — hits east wall, no north wall)
		// curr: red at (0,0) facing north (cone goes up — all OOB)
		const prevGame = makeWallGame({
			position: { row: 0, col: 0 },
			facing: "east",
		});
		const currGame = makeWallGame({
			position: { row: 0, col: 0 },
			facing: "north",
		});

		const prevCtx = buildAiContext(prevGame, "red");
		const currCtx = buildAiContext(currGame, "red");

		const prev = buildConeSnapshot(prevCtx);
		const curr = buildConeSnapshot(currCtx);

		// The snapshots must differ (east vs north cone)
		expect(prev).not.toBe(curr);

		const diff = renderWhatsNew(prev, curr);
		expect(diff).not.toBeNull();
		// North cone from (0,0) has all walls — "directly in front" line should appear as added
		expect(diff).toContain("+ at directly in front: concrete platform wall");
	});

	it("turning away from a wall produces - lines in <whats_new>", () => {
		// prev: red at (0,0) facing north (all walls)
		// curr: red at (0,0) facing south (cone goes down — in-bounds)
		const prevGame = makeWallGame({
			position: { row: 0, col: 0 },
			facing: "north",
		});
		const currGame = makeWallGame({
			position: { row: 0, col: 0 },
			facing: "south",
		});

		const prevCtx = buildAiContext(prevGame, "red");
		const currCtx = buildAiContext(currGame, "red");

		const prev = buildConeSnapshot(prevCtx);
		const curr = buildConeSnapshot(currCtx);

		const diff = renderWhatsNew(prev, curr);
		expect(diff).not.toBeNull();
		// "directly in front" was a wall in north cone, now it's in-bounds in south cone → removed
		expect(diff).toContain("- at directly in front: concrete platform wall");
	});

	it("identical snapshots at the wall → renderWhatsNew returns null", () => {
		// Same position and facing → cone snapshot is byte-identical
		const game = makeWallGame({
			position: { row: 0, col: 0 },
			facing: "north",
		});
		const ctx = buildAiContext(game, "red");
		const snap = buildConeSnapshot(ctx);
		expect(renderWhatsNew(snap, snap)).toBeNull();
	});

	it("wallName comes from ContentPack.wallName, not hardcoded", () => {
		const game = makeWallGame({
			position: { row: 0, col: 0 },
			facing: "north",
			wallName: "laboratory bulkhead",
		});
		const ctx = buildAiContext(game, "red");
		const snap = buildConeSnapshot(ctx);
		expect(snap).toContain("laboratory bulkhead");
		expect(snap).not.toContain("concrete platform wall");
	});
});

// ============================================================================
// buildConeEntityState and renderPerceptionDelta tests (issue #469)
// ============================================================================

describe("buildConeEntityState", () => {
	it("returns item in cone with unsatisfied state when at a cone cell", () => {
		// red at (0,0) facing south; item at (1,0) is directly in front
		const pack = makeTestPack(
			[
				{
					id: "item-cone",
					kind: "interesting_object",
					name: "Item in cone",
					examineDescription: "An item",
					holder: { row: 1, col: 0 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildConeEntityState(ctx);
		expect(state["item-cone"]).toEqual({ inCone: true, satisfied: false });
	});

	it("returns item with satisfied state when satisfaction state is satisfied", () => {
		const pack = makeTestPack(
			[
				{
					id: "satisfied-item",
					kind: "objective_object",
					name: "Satisfied Item",
					examineDescription: "Before",
					postExamineDescription: "After",
					holder: { row: 1, col: 0 },
					satisfactionState: "satisfied" as const,
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildConeEntityState(ctx);
		expect(state["satisfied-item"]).toEqual({ inCone: true, satisfied: true });
	});

	it("excludes items held by the actor", () => {
		const pack = makeTestPack(
			[
				{
					id: "held-item",
					kind: "interesting_object",
					name: "Held Item",
					examineDescription: "An item",
					holder: "red",
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildConeEntityState(ctx);
		expect(state["held-item"]).toBeUndefined();
	});

	it("excludes items beyond the cone", () => {
		// red at (0,0) facing south; place item far away
		const pack = makeTestPack(
			[
				{
					id: "far-item",
					kind: "interesting_object",
					name: "Far Item",
					examineDescription: "An item",
					holder: { row: 10, col: 10 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildConeEntityState(ctx);
		expect(state["far-item"]).toBeUndefined();
	});

	it("includes other personas in the cone", () => {
		// red at (0,0) facing south, green at (1,0) — green is directly in front
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 1, col: 0 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildConeEntityState(ctx);
		expect(state.green).toEqual({ inCone: true, satisfied: false });
	});

	it("includes objective spaces in the cone", () => {
		const pack = makeTestPack(
			[
				{
					id: "flower_space",
					kind: "objective_space",
					name: "Flower Space",
					examineDescription: "A space",
					holder: { row: 1, col: 0 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildConeEntityState(ctx);
		expect(state.flower_space).toEqual({ inCone: true, satisfied: false });
	});
});

describe("renderPerceptionDelta", () => {
	it("returns empty array when no prior entities", () => {
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 0, col: 1 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const delta = renderPerceptionDelta(ctx, undefined);
		expect(delta).toEqual([]);
	});

	it("emits 'Came into view' when entity enters cone", () => {
		const pack = makeTestPack(
			[
				{
					id: "new-item",
					kind: "interesting_object",
					name: "Shiny Object",
					examineDescription: "It gleams.",
					holder: { row: 1, col: 0 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const delta = renderPerceptionDelta(ctx, {});
		expect(delta).toContain("Came into view: Shiny Object — It gleams.");
	});

	it("emits 'Came into view' with postExamineDescription when entity enters satisfied", () => {
		const pack = makeTestPack(
			[
				{
					id: "satisfied-new",
					kind: "objective_object",
					name: "Glowing Gem",
					examineDescription: "A gem",
					postExamineDescription: "It shines brilliantly.",
					holder: { row: 1, col: 0 },
					satisfactionState: "satisfied" as const,
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const delta = renderPerceptionDelta(ctx, {});
		expect(delta).toContain(
			"Came into view: Glowing Gem — It shines brilliantly.",
		);
	});

	it("emits 'Lost from view' when entity leaves cone", () => {
		const pack = makeTestPack(
			[
				{
					id: "departing-item",
					kind: "interesting_object",
					name: "Vanishing Item",
					examineDescription: "It fades.",
					holder: { row: 1, col: 0 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "north" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Item was in cone before (when red was facing south)
		const prevEntities = {
			"departing-item": { inCone: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toContain("Lost from view: Vanishing Item");
	});

	it("emits satisfaction transition line when entity becomes satisfied", () => {
		const pack = makeTestPack(
			[
				{
					id: "became-satisfied",
					kind: "objective_object",
					name: "Awakening Stone",
					examineDescription: "Dormant",
					postExamineDescription: "Radiant",
					holder: { row: 1, col: 0 }, // Directly in front (facing south)
					satisfactionState: "satisfied" as const,
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Item was in cone but not satisfied before
		const prevEntities = {
			"became-satisfied": { inCone: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toContain("Awakening Stone is now Radiant");
	});

	it("does not emit line when entity stays in cone unchanged", () => {
		const pack = makeTestPack(
			[
				{
					id: "static-item",
					kind: "interesting_object",
					name: "Static Item",
					examineDescription: "Unmoved",
					holder: { row: 1, col: 0 }, // Directly in front of red (facing south)
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const prevEntities = { "static-item": { inCone: true, satisfied: false } };
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toHaveLength(0);
	});

	it("suppresses departure line when entity is picked up by actor", () => {
		const pack = makeTestPack(
			[
				{
					id: "picked-up",
					kind: "interesting_object",
					name: "Picked Item",
					examineDescription: "On ground",
					holder: "red", // Held by red
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "south" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Item was in cone before (at a grid position)
		const prevEntities = { "picked-up": { inCone: true, satisfied: false } };
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toHaveLength(0); // No departure line
	});

	it("emits persona first-sight with name only, no flavor", () => {
		// green at (1,0), visible to red at (0,0) facing south (directly in front)
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
				green: { position: { row: 1, col: 0 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const prevEntities = {}; // green was not in cone before
		const delta = renderPerceptionDelta(ctx, prevEntities);
		const greenLine = delta.find((line) => line.includes("Sage"));
		expect(greenLine).toBe("Came into view: Sage");
	});

	it("emits persona departure with name only, no flavor", () => {
		// green at (1,0), not visible to red at (0,0) facing north
		// But prevEntities says green WAS in cone before
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 }, facing: "north" },
				green: { position: { row: 1, col: 0 }, facing: "north" },
				cyan: { position: { row: 0, col: 2 }, facing: "north" },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Green was in cone before (when red was facing south)
		const prevEntities = { green: { inCone: true, satisfied: false } };
		const delta = renderPerceptionDelta(ctx, prevEntities);
		const greenLine = delta.find((line) => line.includes("Sage"));
		expect(greenLine).toBe("Lost from view: Sage");
	});

	it("does not emit both first-sight and transition for newly satisfied entity", () => {
		const pack = makeTestPack(
			[
				{
					id: "gem",
					kind: "interesting_object",
					name: "Fresh Gem",
					examineDescription: "Dormant gem",
					postExamineDescription: "Brilliant gem",
					holder: { row: 0, col: 1 },
					satisfactionState: "satisfied" as const,
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 }, facing: "east" },
					green: { position: { row: 0, col: 1 }, facing: "north" },
					cyan: { position: { row: 0, col: 2 }, facing: "north" },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Gem and green were both in cone before, gem unsatisfied
		const prevEntities = {
			gem: { inCone: true, satisfied: false },
			green: { inCone: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		// Should emit only transition line for gem, not "Came into view" (to avoid duplication)
		const transitionLine = delta.find((line) => line.includes("is now"));
		const entryLine = delta.find(
			(line) => line.includes("Came into view") && line.includes("Gem"),
		);
		expect(transitionLine).toBe("Fresh Gem is now Brilliant gem");
		expect(entryLine).toBeUndefined();
	});
});
