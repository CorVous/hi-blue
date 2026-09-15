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
	buildDiskEntityState,
	buildDiskSnapshot,
	describeRelativePosition,
	renderPerceptionDelta,
	renderWhatsNew,
} from "../prompt-builder";
import type { AiPersona, ContentPack, Objective, WorldEntity } from "../types";
import { inVista } from "../vista-projector";
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
	red: { position: { row: 0, col: 0 } },
	green: { position: { row: 0, col: 1 } },
	cyan: { position: { row: 0, col: 2 } },
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

	it("establishes the four cardinal directions exactly once, inside <setting>", () => {
		const pack = makeTestPack([], {
			setting: "abandoned subway station",
			wallName: "wall",
			aiStarts: RGC_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const prompt = buildAiContext(game, "red").toSystemPrompt();

		const settingBlock = /<setting>([\s\S]*?)<\/setting>/.exec(prompt)?.[1];
		expect(settingBlock).toBeDefined();
		for (const dir of ["north", "south", "east", "west"]) {
			expect(settingBlock?.match(new RegExp(`\\b${dir}\\b`, "g"))?.length).toBe(
				1,
			);
		}
		// Nowhere else in the stable prompt establishes them.
		expect(
			prompt
				.replace(settingBlock ?? "", "")
				.match(/\b(north|south|east|west)\b/gi),
		).toBeNull();
	});
});

// ----------------------------------------------------------------------------
// Cardinal directions (ADR 0015)
// ----------------------------------------------------------------------------

/** The `<setting>` line that establishes the room's cardinal directions. */
function cardinalClause(prompt: string): string {
	const settingBlock = /<setting>([\s\S]*?)<\/setting>/.exec(prompt)?.[1] ?? "";
	return (
		settingBlock
			.split("\n")
			.find((line) => /\bnorth\b/.test(line) && /\bsouth\b/.test(line)) ?? ""
	);
}

describe("cardinal directions", () => {
	const ROOM_A = makeTestPack([], {
		setting: "neon arcade",
		wallName: "wall",
		aiStarts: RGC_AI_STARTS,
	});
	const ROOM_B = makeTestPack([], {
		setting: "sun-baked salt flat",
		wallName: "wall",
		aiStarts: RGC_AI_STARTS,
	});

	it("keeps the same directions after Same Daemons, New Room", () => {
		// Same Daemons, New Room: same personas, a freshly generated room, and
		// cleared conversation logs. Changing the room's contents must not
		// redefine the cardinal directions.
		let firstRoom = startGame(TEST_PERSONAS, ROOM_A, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		firstRoom = appendMessage(firstRoom, "blue", "red", "Remember this room.");
		expect(firstRoom.conversationLogs.red).toHaveLength(1);

		const newRoom = startGame(TEST_PERSONAS, ROOM_B, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		expect(newRoom.conversationLogs.red).toEqual([]);

		const before = cardinalClause(
			buildAiContext(firstRoom, "red").toSystemPrompt(),
		);
		const after = cardinalClause(
			buildAiContext(newRoom, "red").toSystemPrompt(),
		);
		expect(before).not.toBe("");
		expect(after).toBe(before);
	});
});

// ----------------------------------------------------------------------------
// "Where you are" section (issue #123)
// ----------------------------------------------------------------------------
describe("prompt-builder — spatial 'Where you are' section (current-state user turn)", () => {
	// Spatial state moved out of the system prompt into the trailing user turn
	// (`ctx.toCurrentStateUserMessage()`) so the system prefix stays cache-stable.

	it("includes <where_you_are> block in the current-state user turn", () => {
		// rng=()=>0 places red at (0,0)
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<where_you_are>");
		expect(ctx.toSystemPrompt()).not.toContain("<where_you_are>");
	});

	it("omits any per-round direction anchor from the current-state user turn", () => {
		// rng=()=>0 places red at (0,0)
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// The retired always-on anchor line left no replacement, and nothing in
		// the per-round turn describes an orientation. Cardinal directions reach
		// the Daemon as Vista cell labels ("Two steps north: …"), never as a
		// standing orientation anchor.
		expect(stateMsg).not.toMatch(/^On the .*ahead/im);
		expect(stateMsg).not.toMatch(/facing/i);
		expect(stateMsg).toContain("- Two steps north:");
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

	it("lists other AIs visible in the Vista under <what_you_see>", () => {
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
// "<what_you_see>" Vista section tests (issue #124, ADR 0015)
// ----------------------------------------------------------------------------
describe("<what_you_see> (Vista)", () => {
	// `<what_you_see>` lives in the trailing current-state user turn now.

	it("<what_you_see> block is present in every phase's current-state turn", () => {
		const game = startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
	});

	it("item one cardinal step away is listed under its direction", () => {
		// flower at (1,0) is one step south of red at (0,0). Perception is
		// position-only, so the listing follows the cardinal offset.
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const redSpatial = game.personaSpatial.red;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });

		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("- One step south: flower");
	});

	it("peer Daemons are rendered with their id, color, cardinal position, and held items", () => {
		// No rng trickery: positions come straight from the pack, and the pack
		// carries no orientation values at all.
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 1, col: 0 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();

		expect(stateMsg).not.toContain("Player");
		expect(stateMsg).not.toContain("the player");
		// green is one step south of red; cyan is two steps east.
		expect(stateMsg).toContain(
			"- One step south: the Daemon *green (#81b29a), one step south of you, holding nothing",
		);
		expect(stateMsg).toContain(
			"- Two steps east: the Daemon *cyan (#5fa8d3), two steps east of you, holding nothing",
		);
		// No orientation reaches the listing.
		expect(stateMsg).not.toMatch(/facing/i);
	});

	it("obstacles never remove cells from the disk", () => {
		// An obstacle at (1,0) is one step south of red (0,0); the cell beyond it
		// at (2,0) is still part of the Vista and still lists its contents.
		const pack = makeTestPack(
			[
				makeEntity("col1", "obstacle", { row: 1, col: 0 }),
				makeEntity("flower", "interesting_object", { row: 2, col: 0 }),
			],
			{ wallName: "wall", aiStarts: RGC_AI_STARTS },
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const stateMsg = buildAiContext(game, "red").toCurrentStateUserMessage();
		expect(stateMsg).toContain("- One step south: col1");
		expect(stateMsg).toContain(
			"- Two steps south: flower (on the ground — not held)",
		);
	});

	it("lists the 12 non-own cells of the disk and no offset outside it", () => {
		// red at (2,2): the whole disk is in bounds, so every cell renders as
		// contents rather than a Wall.
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 0, col: 0 } },
				cyan: { position: { row: 4, col: 4 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const stateMsg = buildAiContext(game, "red").toCurrentStateUserMessage();
		const start = stateMsg.indexOf("<what_you_see>");
		const end = stateMsg.indexOf("</what_you_see>", start);
		const cellLines = stateMsg
			.slice(start, end)
			.split("\n")
			.filter((line) => line.startsWith("- "));
		// 13-cell disk minus the own cell (covered by <where_you_are>).
		expect(cellLines).toHaveLength(12);
		// (2,1)-style offsets are outside dx² + dy² ≤ 4 and are never labelled.
		expect(stateMsg).not.toContain("two steps north and one step east");
		expect(stateMsg).not.toContain("one step north and two steps east");
	});

	it("out-of-bounds Vista cells render as wall markers in <what_you_see>", () => {
		// red at (0,0): the north and west halves of the disk fall outside the room.
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
		// OOB cells render as wall markers — wallName from ContentPack
		expect(sectionContent).toContain(
			"- One step north: concrete platform wall",
		);
		expect(sectionContent).toContain(
			"- Two steps north: concrete platform wall",
		);
		expect(sectionContent).toContain("- One step west: concrete platform wall");
		expect(sectionContent).toContain(
			"- Two steps west: concrete platform wall",
		);
		expect(sectionContent).toContain(
			"- One step north and one step east: concrete platform wall",
		);
		// In-bounds cells on the disk still render normally.
		expect(sectionContent).toContain("- Two steps south: nothing");
		expect(sectionContent).toContain(
			"- One step east and one step south: nothing",
		);
		// wallName comes from ContentPack, not hardcoded
		expect(sectionContent).toContain("concrete platform wall");
	});

	it("partial edge: only OOB cells render as walls — in-bounds cells render normally", () => {
		// red at (1,0): the west column and the far north cell are OOB; the rest
		// of the disk is inside the room.
		const wallPack = makeTestPack([], {
			wallName: "concrete platform wall",
			aiStarts: {
				red: { position: { row: 1, col: 0 } },
				green: { position: { row: 4, col: 4 } },
				cyan: { position: { row: 4, col: 3 } },
			},
		});
		const game = startGame(TEST_PERSONAS, wallPack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		const start = stateMsg.indexOf("<what_you_see>");
		const end = stateMsg.indexOf("</what_you_see>", start);
		const sectionContent = stateMsg.slice(start, end);
		// OOB cells: west column, far north, and the north-west diagonal.
		expect(sectionContent).toContain(
			"- Two steps west: concrete platform wall",
		);
		expect(sectionContent).toContain("- One step west: concrete platform wall");
		expect(sectionContent).toContain(
			"- Two steps north: concrete platform wall",
		);
		expect(sectionContent).toContain(
			"- One step north and one step west: concrete platform wall",
		);
		// In-bounds cells → "nothing" (no entities there)
		expect(sectionContent).toContain("- One step north: nothing");
		expect(sectionContent).toContain("- One step east: nothing");
		expect(sectionContent).toContain("- Two steps east: nothing");
	});

	it("obstacles in the Vista are listed by their name", () => {
		// Place an obstacle named "col1" at (1,0) — one step south of red (0,0).
		const pack = makeTestPack(
			[makeEntity("col1", "obstacle", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("- One step south: col1");
	});

	it("other AI visible in the Vista is rendered with its color in parentheses", () => {
		// Use ContentPack to place red at (0,0), green at (1,0).
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 1, col: 0 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		// Verify spatial placements (flat model: access from game directly)
		const redSpatial = game.personaSpatial.red;
		const greenSpatial = game.personaSpatial.green;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
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
		// Place flower on red's cell (0,0). Red is at (0,0).
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 0, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("flower (on the ground — not held)");
	});

	it("tags Vista-cell items in <what_you_see> with (on the ground — not held)", () => {
		// Place flower at (1,0) — one step south of red at (0,0)
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"- One step south: flower (on the ground — not held)",
		);
	});

	it("does NOT tag held items in 'You are holding' with the ground marker", () => {
		// red holds the flower directly
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", "red")],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
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

	it("items co-existing with a daemon in a Vista cell still get the ground tag", () => {
		// Put green AND flower at (1,0) — one step south of red at (0,0).
		const pack = makeTestPack(
			[makeEntity("flower", "interesting_object", { row: 1, col: 0 })],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 1, col: 0 } },
					cyan: { position: { row: 0, col: 2 } },
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
//   - buildDiskSnapshot (so <whats_new> diff shows +/- on entry/exit)
//   - toCurrentStateUserMessage (inside <what_you_see> block)
// ----------------------------------------------------------------------------
describe("proximityFlavor sense line", () => {
	function makePackWithProximity(opts: {
		actorPosition: { row: number; col: number };
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
				red: { position: opts.actorPosition },
				green: { position: { row: 0, col: 1 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});
	}

	it("proximity flavor appears in <what_you_see> when paired space is in own cell", () => {
		// red at (2,2); pedestal at (2,2) = own cell
		const pack = makePackWithProximity({
			actorPosition: { row: 2, col: 2 },
			spacePosition: { row: 2, col: 2 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor appears in <what_you_see> when paired space is within interaction range", () => {
		// red at (0,0); pedestal at (1,0) = one step away
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 1, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor appears in <what_you_see> when paired space is a diagonal neighbour", () => {
		// red at (0,0); pedestal at (1,1) = diagonal south-east
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 1, col: 1 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor does NOT appear when paired space is at offset (2,0)", () => {
		// red at (0,0); pedestal at (2,0) = two cardinal steps
		// away: visible in the Vista, outside interaction range.
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 2, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// Still visible: the pedestal's cell and name are rendered.
		expect(stateMsg).toContain("Stone Pedestal");
		expect(stateMsg).not.toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor appears in buildDiskSnapshot when space is reachable", () => {
		// red at (0,0); pedestal at (1,0) = one step away
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 1, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const snapshot = buildDiskSnapshot(ctx);
		expect(snapshot).toContain(
			"proximity: The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor does NOT appear in buildDiskSnapshot at offset (2,0)", () => {
		// red at (0,0); pedestal at (2,0) — visible, out of range
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 2, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const snapshot = buildDiskSnapshot(ctx);
		expect(snapshot).not.toContain("proximity:");
	});

	it("proximity line entry/exit shows as +/- in whats_new diff", () => {
		// Previous snapshot: the pedestal sits at offset (2,0) — visible but out
		// of interaction range, so no proximity line. Current snapshot: it sits
		// one step away, so the line enters.
		const packFar = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 2, col: 0 },
		});
		const packNear = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 1, col: 0 },
		});
		const gameFar = startGame(TEST_PERSONAS, packFar, { budgetPerAi: 5 });
		const gameNear = startGame(TEST_PERSONAS, packNear, { budgetPerAi: 5 });
		const ctxFar = buildAiContext(gameFar, "red");
		const prevSnapshot = buildDiskSnapshot(ctxFar);
		// Build current state with prevDiskSnapshot set
		const ctxWithPrev = buildAiContext(gameNear, "red", {
			prevDiskSnapshot: prevSnapshot,
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
	it("UseItem proximity flavor appears when the item is within interaction range (one step)", () => {
		// red at (0,0); item at (1,0) = one step away
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
			aiStarts: RGC_AI_STARTS,
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

	it("UseItem proximity flavor does NOT appear when objective is satisfied", () => {
		// red at (0,0); item at (1,0) = in front
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
			aiStarts: RGC_AI_STARTS,
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

	it("UseItem proximity flavor does NOT appear when the item is at offset (2,0)", () => {
		// red at (0,0); item at (2,0) = two cardinal steps away:
		// visible in the Vista, outside interaction range.
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: { row: 2, col: 0 },
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
	it("UseSpace proximity flavor appears when space is visible but outside interaction range", () => {
		// red at (0,0); space at (2,0) = two steps south:
		// offset (2,0), in the Vista but beyond interaction range
		const space: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription:
				"A sturdy brass pedestal. Press an item onto it to activate.",
			holder: { row: 2, col: 0 }, // two steps south — in the Vista, out of interaction range
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
			aiStarts: RGC_AI_STARTS,
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
		const snapshot = buildDiskSnapshot(ctx);
		// Two cardinal steps away: proximity flavor should appear in the disk snapshot
		expect(snapshot).toContain(
			"proximity: The pedestal pulses with a faint hum.",
		);
	});

	it("UseSpace auto-examine (examineDescription) appears when space is within interaction range; proximity flavor does NOT", () => {
		// red at (0,0); space at (1,0) = one step away
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
			aiStarts: RGC_AI_STARTS,
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
		// red at (0,0); space at (2,0) = two steps south, in the Vista
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
			aiStarts: RGC_AI_STARTS,
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
		const snapshot = buildDiskSnapshot(ctx);
		expect(snapshot).not.toContain(
			"proximity: The pedestal pulses with a faint hum.",
		);
	});

	// ─ Convergence tests ─
	it("Convergence proximity flavor appears when space is visible but outside interaction range", () => {
		// red at (0,0); space at (2,0) = two steps south:
		// offset (2,0), in the Vista but beyond interaction range
		const space: WorldEntity = {
			id: "convergence",
			kind: "objective_space",
			name: "Gathering Place",
			examineDescription:
				"A gathering point. Becoming significant when shared.",
			holder: { row: 2, col: 0 }, // two steps south — in the Vista, out of interaction range
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
			aiStarts: RGC_AI_STARTS,
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
		const snapshot = buildDiskSnapshot(ctx);
		// Offset (2,0): proximity flavor appears in the disk snapshot
		expect(snapshot).toContain(
			"proximity: The place emanates a strange presence, drawing you forward.",
		);
	});

	// ─ Proximity hints at the interaction-range / Vista boundary (ADR 0015) ─
	describe("proximity hints — interaction range versus Vista", () => {
		const SPACE_FLAVOR = "The pedestal pulses with a faint hum.";
		const ITEM_FLAVOR = "The switch crackles faintly with energy.";
		const GEM_FLAVOR = "The gem pulses warmly, drawn toward the pedestal.";

		/** Red at (2,2); offsets are (dx east, dy north). */
		function offsetPos(o: { dx: number; dy: number }) {
			return { row: 2 - o.dy, col: 2 + o.dx };
		}

		function makeOffsetGame(opts: {
			spaceOffset?: { dx: number; dy: number };
			pendingKind?: "use_space" | "convergence";
			itemOffset?: { dx: number; dy: number };
			heldCarrySpaceOffset?: { dx: number; dy: number };
		}) {
			const entities: WorldEntity[] = [];
			const objectives: Objective[] = [];
			if (opts.spaceOffset) {
				entities.push({
					id: "pedestal",
					kind: "objective_space",
					name: "Brass Pedestal",
					examineDescription: "A sturdy brass pedestal.",
					holder: offsetPos(opts.spaceOffset),
					proximityFlavor: SPACE_FLAVOR,
				});
				objectives.push({
					id: "obj-space",
					kind: opts.pendingKind ?? "use_space",
					description: "Use the pedestal",
					spaceId: "pedestal",
					satisfactionState: "pending" as const,
				});
			}
			if (opts.itemOffset) {
				entities.push({
					id: "switch",
					kind: "interesting_object",
					name: "brass switch",
					examineDescription: "A small brass switch.",
					holder: offsetPos(opts.itemOffset),
					proximityFlavor: ITEM_FLAVOR,
				});
				objectives.push({
					id: "obj-item",
					kind: "use_item",
					description: "Use the switch",
					itemId: "switch",
					satisfactionState: "pending" as const,
				});
			}
			if (opts.heldCarrySpaceOffset) {
				entities.push(
					{
						id: "gem",
						kind: "objective_object",
						name: "Glowing Gem",
						examineDescription: "A gem.",
						holder: "red",
						pairsWithSpaceId: "pedestal",
						proximityFlavor: GEM_FLAVOR,
					},
					{
						id: "pedestal",
						kind: "objective_space",
						name: "Stone Pedestal",
						examineDescription: "A stone pedestal.",
						holder: offsetPos(opts.heldCarrySpaceOffset),
					},
				);
			}

			const pack = makeTestPack(entities, {
				setting: "test",
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 2, col: 2 } },
					green: { position: { row: 0, col: 0 } },
					cyan: { position: { row: 4, col: 4 } },
				},
			});
			const started = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			return { ...started, objectives };
		}

		it("offset (2,0): pending Use-Space space is visible and gets proximity flavor", () => {
			// red at (2,2); space at (2,4), two cardinal steps east
			const game = makeOffsetGame({
				spaceOffset: { dx: 2, dy: 0 },
				pendingKind: "use_space",
			});
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Visible in the Vista listing ...
			expect(stateMsg).toContain("Brass Pedestal");
			expect(stateMsg).toContain("A sturdy brass pedestal.");
			// ... and flavored because it is in the Vista but out of reach.
			expect(stateMsg).toContain(SPACE_FLAVOR);
		});

		it("offset (2,0): pending Convergence space gets proximity flavor", () => {
			const game = makeOffsetGame({
				spaceOffset: { dx: 2, dy: 0 },
				pendingKind: "convergence",
			});
			const ctx = buildAiContext(game, "red");
			const snapshot = buildDiskSnapshot(ctx);
			expect(snapshot).toContain(`proximity: ${SPACE_FLAVOR}`);
		});

		it("offset (2,0): held Carry item gets no proximity flavor", () => {
			const game = makeOffsetGame({
				heldCarrySpaceOffset: { dx: 2, dy: 0 },
			});
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// The matching space is visible ...
			expect(stateMsg).toContain("Stone Pedestal");
			// ... but out of reach, so Carry placement is not hinted.
			expect(stateMsg).not.toContain(GEM_FLAVOR);
		});

		it("offset (2,0): unheld Use-Item target gets no proximity flavor", () => {
			const game = makeOffsetGame({ itemOffset: { dx: 2, dy: 0 } });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("brass switch");
			expect(stateMsg).not.toContain(ITEM_FLAVOR);
		});

		it("offset (2,1): outside the Vista and outside interaction range, so no proximity flavor", () => {
			expect(inVista(2, 1)).toBe(false);
			for (const pendingKind of ["use_space", "convergence"] as const) {
				const game = makeOffsetGame({
					spaceOffset: { dx: 2, dy: 1 },
					pendingKind,
				});
				const ctx = buildAiContext(game, "red");
				expect(buildDiskSnapshot(ctx)).not.toContain("proximity:");
			}

			const carry = makeOffsetGame({ heldCarrySpaceOffset: { dx: 2, dy: 1 } });
			expect(
				buildAiContext(carry, "red").toCurrentStateUserMessage(),
			).not.toContain(GEM_FLAVOR);

			const item = makeOffsetGame({ itemOffset: { dx: 2, dy: 1 } });
			expect(
				buildAiContext(item, "red").toCurrentStateUserMessage(),
			).not.toContain(ITEM_FLAVOR);
		});
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
	describe("auto-emit examineDescription for entities in the Vista (issue #466)", () => {
		it("emits examineDescription for interesting_object in the Vista", () => {
			// red at (0,0); switch at (1,0) = one step south
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 1, col: 0 },
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

		it("emits examineDescription for obstacle in the Vista", () => {
			// red at (0,0); obstacle at (1,0) = one step south
			const obstacle: WorldEntity = {
				id: "col1",
				kind: "obstacle",
				name: "stone column",
				examineDescription: "A weathered stone column, ancient and sturdy.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([obstacle], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
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
			// red at (0,0); space at (1,0) = one step south
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
				aiStarts: RGC_AI_STARTS,
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
			// red at (0,0); space at (1,0) = one step south
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
				aiStarts: RGC_AI_STARTS,
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
			// red at (0,0); item at (0,0) = own cell
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 0, col: 0 }, // own cell
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
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
				aiStarts: RGC_AI_STARTS,
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
			// red at (0,0) (the wall perception is position-only)
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
				aiStarts: RGC_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			// Empty description should not produce an indented line
			expect(stateMsg).not.toContain("mystery object: ");
		});

		it("emits examineDescription every turn while entity is in range", () => {
			// red at (0,0); switch at (1,0) = one step south
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: RGC_AI_STARTS,
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
		const prevSnapshot = buildDiskSnapshot(buildAiContext(game, "red"));
		const ctx = buildAiContext(game, "red", { prevDiskSnapshot: prevSnapshot });
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("<whats_new>");
		expect(stateMsg).toContain(
			"[announcement] The weather has changed to heavy fog.",
		);
	});

	it("emits <whats_new> with the announcement even without a prevDiskSnapshot", () => {
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

	it("does not emit <whats_new> when there are no broadcasts and no prevDiskSnapshot", () => {
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
			aiStarts: RGC_AI_STARTS,
		});
	}

	it("appends postLookFlavor to the cell line in <what_you_see> for a satisfied interesting_object", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		// switch is at (1,0), one step south of red at (0,0).
		expect(stateMsg).toContain("- One step south:");
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

	it("postLookFlavor also appears in buildDiskSnapshot for satisfied interesting_object", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const snapshot = buildDiskSnapshot(ctx);
		expect(snapshot).toContain("a steady amber glow lingers near the switch");
	});
});

// ----------------------------------------------------------------------------
// Vista perception changes (ADR 0015): an unchanged Vista emits no diff at all,
// while real entity/content changes stay observable.
// ----------------------------------------------------------------------------
describe("<whats_new> — Vista perception changes", () => {
	function vistaGame(entities: WorldEntity[]) {
		return startGame(
			TEST_PERSONAS,
			makeTestPack(entities, { wallName: "wall", aiStarts: RGC_AI_STARTS }),
			{ budgetPerAi: 5 },
		);
	}

	it("emits no <whats_new> diff when the Vista is unchanged", () => {
		const game = vistaGame([
			makeEntity("flower", "interesting_object", { row: 1, col: 0 }),
		]);
		const first = buildAiContext(game, "red");
		const snapshot = buildDiskSnapshot(first);

		// Same position, same world → byte-identical snapshot.
		const next = buildAiContext(game, "red", { prevDiskSnapshot: snapshot });
		expect(buildDiskSnapshot(next)).toBe(snapshot);

		const stateMsg = next.toCurrentStateUserMessage();
		// No entry/exit diff, no "(no change)" placeholder, no re-printed listing.
		expect(stateMsg).not.toContain("<whats_new>");
		expect(stateMsg).not.toContain("(no change)");
		expect(stateMsg).not.toContain("+ at ");
		// The fresh listing is still there — it is simply not a diff.
		expect(stateMsg).toContain("<what_you_see>");
		expect(stateMsg).toContain("- One step south: flower");
	});

	it("still emits the entry diff when an entity moves into the Vista", () => {
		// flower starts far outside red's Vista: offset (3, 3) → 9 + 9 > 4.
		const game = vistaGame([
			makeEntity("flower", "interesting_object", { row: 3, col: 3 }),
		]);
		const snapshot = buildDiskSnapshot(buildAiContext(game, "red"));

		// Move it to (1,0) — one step south of red.
		const moved = {
			...game,
			world: {
				entities: game.world.entities.map((e) =>
					e.id === "flower" ? { ...e, holder: { row: 1, col: 0 } } : e,
				),
			},
		};
		const next = buildAiContext(moved, "red", { prevDiskSnapshot: snapshot });
		const stateMsg = next.toCurrentStateUserMessage();
		expect(stateMsg).toContain("<whats_new>");
		expect(stateMsg).toContain("+ at one step south: flower");
	});

	it("still emits a satisfaction/content change for an entity already in the Vista", () => {
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			postExamineDescription: "The switch sits pressed and humming.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			holder: { row: 1, col: 0 },
			satisfactionState: "pending",
		};
		const game = vistaGame([item]);
		const snapshot = buildDiskSnapshot(buildAiContext(game, "red"));

		const satisfied = {
			...game,
			world: {
				entities: game.world.entities.map((e) =>
					e.id === "switch"
						? { ...e, satisfactionState: "satisfied" as const }
						: e,
				),
			},
		};
		const next = buildAiContext(satisfied, "red", {
			prevDiskSnapshot: snapshot,
			prevDiskEntities: { switch: { inVista: true, satisfied: false } },
		});
		const stateMsg = next.toCurrentStateUserMessage();
		expect(stateMsg).toContain("<whats_new>");
		expect(stateMsg).toContain(
			"brass switch is now The switch sits pressed and humming.",
		);
		expect(stateMsg).toContain(
			"+ at one step south: brass switch a steady amber glow lingers near the switch",
		);
	});
});

// ----------------------------------------------------------------------------
// Peer-position prose (ADR 0015): cardinal direction and distance from the
// observer's position, built from position alone.
// ----------------------------------------------------------------------------
describe("peer-position prose", () => {
	it("describes the ADR's worked example from positions alone", () => {
		// One step north and one step east of the observer.
		expect(
			describeRelativePosition({ row: 2, col: 2 }, { row: 1, col: 3 }),
		).toBe("one step north and one step east of you");
		expect(
			describeRelativePosition({ row: 2, col: 2 }, { row: 4, col: 2 }),
		).toBe("two steps south of you");
		expect(
			describeRelativePosition({ row: 2, col: 2 }, { row: 2, col: 2 }),
		).toBe("in your cell");
	});

	it("renders every peer's position in the current-state listing", () => {
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 1, col: 3 } },
				cyan: { position: { row: 4, col: 2 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const state = buildAiContext(game, "red").toCurrentStateUserMessage();
		expect(state).toContain(
			"- One step north and one step east: the Daemon *green (#81b29a), one step north and one step east of you, holding nothing",
		);
		expect(state).toContain(
			"- Two steps south: the Daemon *cyan (#5fa8d3), two steps south of you, holding nothing",
		);
	});

	it("describes a Daemon sharing the observer's own cell", () => {
		// red and green stand on the same cell. The own cell is part of the
		// Vista (ADR 0015) and Convergence is built on joint occupancy, so the
		// co-located peer must be perceived — cyan, two diagonal steps away, is
		// outside dx² + dy² ≤ 4 and must stay absent.
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 2, col: 2 } },
				cyan: { position: { row: 0, col: 0 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = ctx.toCurrentStateUserMessage();

		expect(state).toContain(
			"Your cell: the Daemon *green (#81b29a), in your cell, holding nothing",
		);
		// The co-located peer is perceived inside the Vista listing.
		const listing = state.slice(
			state.indexOf("<what_you_see>"),
			state.indexOf("</what_you_see>"),
		);
		expect(listing).toContain(
			"the Daemon *green (#81b29a), in your cell, holding nothing",
		);
		// A Daemon outside the Vista is still not described at all.
		expect(state).not.toContain("the Daemon *cyan");

		// The same text is the trailing user turn the model receives.
		const messages = buildOpenAiMessages(ctx);
		expect(messages[messages.length - 1]?.content).toContain(
			"the Daemon *green (#81b29a), in your cell, holding nothing",
		);
	});

	it("gives the co-located peer no cardinal direction", () => {
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 2, col: 2 } },
				cyan: { position: { row: 4, col: 4 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const state = buildAiContext(game, "red").toCurrentStateUserMessage();

		const peerLine = state
			.split("\n")
			.find((line) => line.includes("the Daemon *green"));
		expect(peerLine).toBeDefined();
		// Zero distance has no direction: the own-cell phrasing and nothing else.
		expect(peerLine).toContain("in your cell");
		expect(peerLine).not.toMatch(/north|south|east|west/i);
		expect(peerLine).not.toContain("of you");
	});

	it("describes no own-cell line when no Daemon shares the cell", () => {
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 2, col: 2 } },
				green: { position: { row: 1, col: 3 } },
				cyan: { position: { row: 4, col: 2 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const state = buildAiContext(game, "red").toCurrentStateUserMessage();
		expect(state).not.toContain("Your cell: the Daemon");
	});

	it("has no prose for a cell outside the Vista", () => {
		// (2, 1)-style offsets are outside dx² + dy² ≤ 4. The observer does not
		// perceive that cell, so no cardinal description is invented for it.
		expect(() =>
			describeRelativePosition({ row: 2, col: 2 }, { row: 1, col: 4 }),
		).toThrow(RangeError);
	});
});

// ----------------------------------------------------------------------------
// Moving a Daemon so that out-of-bounds cells enter or leave its Vista makes
// the wall entry appear as a + / - diff line in <whats_new>. Uses
// buildDiskSnapshot + renderWhatsNew.
// ----------------------------------------------------------------------------
describe("<whats_new> wall diff (issue #374)", () => {
	/** Build a game with red at the given position. */
	function makeWallGame(opts: {
		position: { row: number; col: number };
		wallName?: string;
	}) {
		const wallName = opts.wallName ?? "concrete platform wall";
		const pack = makeTestPack([], {
			wallName,
			aiStarts: {
				red: { position: opts.position },
				green: { position: { row: 4, col: 4 } },
				cyan: { position: { row: 4, col: 3 } },
			},
		});
		return startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
	}

	it("moving so that a new cell of the disk falls out of bounds produces + lines in <whats_new>", () => {
		// prev: red at (2,2) — the whole disk is inside the room, no walls.
		// curr: red at (1,0) — the west column and the far north cell now fall
		// outside, so those wall lines are added.
		const prevGame = makeWallGame({
			position: { row: 2, col: 2 },
		});
		const currGame = makeWallGame({
			position: { row: 1, col: 0 },
		});

		const prev = buildDiskSnapshot(buildAiContext(prevGame, "red"));
		const curr = buildDiskSnapshot(buildAiContext(currGame, "red"));

		// The snapshots must differ (one disk has walls, the other does not)
		expect(prev).not.toBe(curr);

		const diff = renderWhatsNew(prev, curr);
		expect(diff).not.toBeNull();
		expect(diff).toContain("+ at two steps west: concrete platform wall");
		expect(diff).toContain("+ at two steps north: concrete platform wall");
	});

	it("moving away from the edge produces - lines in <whats_new>", () => {
		// prev: red at (1,0) — the west column and far north cell are OOB.
		// curr: red at (2,2) — the whole disk is in bounds.
		const prevGame = makeWallGame({
			position: { row: 1, col: 0 },
		});
		const currGame = makeWallGame({
			position: { row: 2, col: 2 },
		});

		const prev = buildDiskSnapshot(buildAiContext(prevGame, "red"));
		const curr = buildDiskSnapshot(buildAiContext(currGame, "red"));

		const diff = renderWhatsNew(prev, curr);
		expect(diff).not.toBeNull();
		expect(diff).toContain("- at two steps west: concrete platform wall");
		expect(diff).toContain("- at two steps north: concrete platform wall");
	});

	it("identical snapshots produce no diff → renderWhatsNew returns null", () => {
		// The Vista depends on position alone, so two contexts built from the
		// same position produce byte-identical snapshots and no <whats_new>.
		const game = makeWallGame({ position: { row: 0, col: 0 } });
		const first = buildDiskSnapshot(buildAiContext(game, "red"));
		const second = buildDiskSnapshot(buildAiContext(game, "red"));
		expect(second).toBe(first);

		// The unchanged Vista reaches the prompt with no <whats_new> block at
		// all — this is the assertion that fails when identical snapshots start
		// producing a diff.
		const unchanged = buildAiContext(game, "red", {
			prevDiskSnapshot: first,
		}).toCurrentStateUserMessage();
		expect(unchanged).not.toContain("<whats_new>");

		// The renderer is not a stub that never emits: a genuinely different
		// Vista — red at (2,2), the whole disk in bounds, so every wall line
		// differs — does produce a diff. The no-diff case above is therefore
		// about sameness, not about the renderer being silent.
		const moved = buildDiskSnapshot(
			buildAiContext(makeWallGame({ position: { row: 2, col: 2 } }), "red"),
		);
		expect(moved).not.toBe(first);
		expect(renderWhatsNew(first, moved)).not.toBeNull();
	});

	it("wallName comes from ContentPack.wallName, not hardcoded", () => {
		const game = makeWallGame({
			position: { row: 0, col: 0 },
			wallName: "laboratory bulkhead",
		});
		const ctx = buildAiContext(game, "red");
		const snap = buildDiskSnapshot(ctx);
		expect(snap).toContain("laboratory bulkhead");
		expect(snap).not.toContain("concrete platform wall");
	});
});

// ============================================================================
// buildDiskEntityState and renderPerceptionDelta tests (issue #469)
// ============================================================================

describe("buildDiskEntityState", () => {
	it("returns item in the Vista with unsatisfied state when at a Vista cell", () => {
		// red at (0,0); item at (1,0) is one step south
		const pack = makeTestPack(
			[
				{
					id: "item-vista",
					kind: "interesting_object",
					name: "Item in Vista",
					examineDescription: "An item",
					holder: { row: 1, col: 0 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildDiskEntityState(ctx);
		expect(state["item-vista"]).toEqual({ inVista: true, satisfied: false });
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildDiskEntityState(ctx);
		expect(state["satisfied-item"]).toEqual({ inVista: true, satisfied: true });
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildDiskEntityState(ctx);
		expect(state["held-item"]).toBeUndefined();
	});

	it("excludes items beyond the Vista", () => {
		// red at (0,0); place item far away
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildDiskEntityState(ctx);
		expect(state["far-item"]).toBeUndefined();
	});

	it("includes other personas in the Vista", () => {
		// red at (0,0), green at (1,0) — green is one step south
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 1, col: 0 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildDiskEntityState(ctx);
		expect(state.green).toEqual({ inVista: true, satisfied: false });
	});

	it("includes objective spaces in the Vista", () => {
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const state = buildDiskEntityState(ctx);
		expect(state.flower_space).toEqual({ inVista: true, satisfied: false });
	});
});

describe("renderPerceptionDelta", () => {
	it("returns empty array when no prior entities", () => {
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 0, col: 1 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const delta = renderPerceptionDelta(ctx, undefined);
		expect(delta).toEqual([]);
	});

	it("emits 'Came into view' when entity enters the Vista", () => {
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
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

	it("emits 'Lost from view' when entity leaves the Vista", () => {
		const pack = makeTestPack(
			[
				{
					id: "departing-item",
					kind: "interesting_object",
					name: "Vanishing Item",
					examineDescription: "It fades.",
					// offset (dx 1, dy −2) from red at (0,0): 1 + 4 > 4, outside the Vista
					holder: { row: 2, col: 1 },
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// The item was inside the Vista on the previous turn.
		const prevEntities = {
			"departing-item": { inVista: true, satisfied: false },
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
					holder: { row: 1, col: 0 }, // one step south of red
					satisfactionState: "satisfied" as const,
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Item was in the Vista but not satisfied before
		const prevEntities = {
			"became-satisfied": { inVista: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toContain("Awakening Stone is now Radiant");
	});

	it("does not emit line when entity stays in the Vista unchanged", () => {
		const pack = makeTestPack(
			[
				{
					id: "static-item",
					kind: "interesting_object",
					name: "Static Item",
					examineDescription: "Unmoved",
					holder: { row: 1, col: 0 }, // one step south of red
				},
			],
			{
				wallName: "wall",
				aiStarts: {
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Every perceived entity was already in the Vista last turn.
		const prevEntities = {
			"static-item": { inVista: true, satisfied: false },
			green: { inVista: true, satisfied: false },
			cyan: { inVista: true, satisfied: false },
		};
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// The item was in the Vista last turn; it is now held, so no departure.
		const prevEntities = {
			"picked-up": { inVista: true, satisfied: false },
			green: { inVista: true, satisfied: false },
			cyan: { inVista: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toHaveLength(0); // No departure line
	});

	it("emits persona first-sight with name only, no flavor", () => {
		// green at (1,0) is inside red's Vista (one step south)
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 1, col: 0 } },
				cyan: { position: { row: 2, col: 1 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const prevEntities = {}; // green was not in the Vista before
		const delta = renderPerceptionDelta(ctx, prevEntities);
		const greenLine = delta.find((line) => line.includes("Sage"));
		expect(greenLine).toBe("Came into view: Sage");
	});

	it("emits persona departure with name only, no flavor", () => {
		// green at (2,1): offset (dx 1, dy −2) from red at (0,0) — outside the Vista.
		// But prevEntities says green WAS in the Vista before.
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 2, col: 1 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Green was in the Vista last turn.
		const prevEntities = { green: { inVista: true, satisfied: false } };
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
					red: { position: { row: 0, col: 0 } },
					green: { position: { row: 0, col: 1 } },
					cyan: { position: { row: 0, col: 2 } },
				},
			},
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		// Gem and green were both in the Vista before, gem unsatisfied
		const prevEntities = {
			gem: { inVista: true, satisfied: false },
			green: { inVista: true, satisfied: false },
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
