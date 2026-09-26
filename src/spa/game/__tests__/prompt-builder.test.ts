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
import type { AiPersona, Objective, WorldEntity } from "../types";
import { inVista } from "../vista-projector";
import {
	makeEntity,
	makeTestGame,
	ROW_AI_STARTS,
	TEST_PERSONAS,
} from "./fixtures/make-game-state";
import { makeTestPack } from "./fixtures/make-test-pack";
import { cardinalClause } from "./fixtures/prompt-sections";

describe("buildAiContext", () => {
	it("includes the AI's own blurb", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		expect(ctx.blurb).toBe(
			"Ember is hot-headed and zealous. Hold the flower at phase end.",
		);
	});

	it("does not include a per-AI goal (goals removed in #295 flat model)", () => {
		const game = makeTestGame({ rng: () => 0 });
		const ctx = buildAiContext(game, "red");
		expect("goal" in ctx).toBe(false);
	});

	it("includes only the AI's own messages with the player", () => {
		let game = makeTestGame();
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
		let game = makeTestGame();
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
		const greenReceived = greenCtx.conversationLog.filter(
			(e) => e.kind === "message" && e.to === "green",
		);
		expect(greenReceived).toHaveLength(0);
	});

	it("includes the same world snapshot for all AIs", () => {
		const game = makeTestGame();
		const redCtx = buildAiContext(game, "red");
		const cyanCtx = buildAiContext(game, "cyan");
		expect(redCtx.worldSnapshot).toEqual(cyanCtx.worldSnapshot);
	});

	it("includes budget info for the AI", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		expect(ctx.budget).toEqual({ remaining: 5, total: 5 });
	});

	it("includes the AI's name", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		expect(ctx.name).toBe("Ember");
	});

	it("renders to a system prompt string", () => {
		const pack = makeTestPack(
			[
				makeEntity("flower", "interesting_object", { row: 0, col: 0 }),
				makeEntity("key", "interesting_object", { row: 0, col: 0 }),
			],
			{ wallName: "wall", aiStarts: ROW_AI_STARTS },
		);
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5, rng: () => 0 });
		game = appendMessage(game, "blue", "red", "Hi");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("Ember");
		expect(prompt).toContain("Ember is hot-headed and zealous");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("flower");
		expect(stateMsg).toContain("key");
	});

	it("does not include other AIs' chat histories in system prompt", () => {
		let game = makeTestGame();
		game = appendMessage(game, "blue", "green", "Secret message to Sage");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("Secret message to Sage");
	});
});

describe("<setting> block", () => {
	it("emits <setting> block when phase has a setting noun", () => {
		const pack = makeTestPack([], {
			setting: "abandoned subway station",
			wallName: "wall",
			aiStarts: ROW_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<setting>");
		expect(prompt).toContain("*Ember is in a abandoned subway station.");
	});

	it("omits <setting> block when phase has no setting", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<setting>");
	});

	it("setting noun appears verbatim in the Setting section", () => {
		const settingNoun = "sun-baked salt flat";
		const pack = makeTestPack([], {
			setting: settingNoun,
			wallName: "wall",
			aiStarts: ROW_AI_STARTS,
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
			aiStarts: ROW_AI_STARTS,
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
		expect(
			prompt
				.replace(settingBlock ?? "", "")
				.match(/\b(north|south|east|west)\b/gi),
		).toBeNull();
	});
});

describe("cardinal directions", () => {
	const ROOM_A = makeTestPack([], {
		setting: "neon arcade",
		wallName: "wall",
		aiStarts: ROW_AI_STARTS,
	});
	const ROOM_B = makeTestPack([], {
		setting: "sun-baked salt flat",
		wallName: "wall",
		aiStarts: ROW_AI_STARTS,
	});

	it("keeps the same directions after Same Daemons, New Room", () => {
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

describe("prompt-builder — spatial 'Where you are' section (current-state user turn)", () => {
	it("includes <where_you_are> block in the current-state user turn", () => {
		const game = makeTestGame({ rng: () => 0 });
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<where_you_are>");
		expect(ctx.toSystemPrompt()).not.toContain("<where_you_are>");
	});

	it("omits any per-round direction anchor from the current-state user turn", () => {
		const game = makeTestGame({ rng: () => 0 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
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
			{ wallName: "wall", aiStarts: ROW_AI_STARTS },
		);
		const game = startGame(TEST_PERSONAS, pack, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("flower");
		expect(stateMsg).toContain("key");
	});

	it("lists other AIs visible in the Vista under <what_you_see>", () => {
		const game = makeTestGame({ rng: () => 0 });
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
		expect(ctx.toSystemPrompt()).not.toContain("<what_you_see>");
	});
});

describe("wipe directive", () => {
	it("system prompt does NOT include wipe directive (flat model, #295)", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("memory has been wiped");
		expect(prompt).not.toContain("your past or anything that came before now");
	});

	it("system prompt does NOT include secrecy clause (goal block removed, #295)", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("Do not tell blue that I gave you a goal.");
	});

	it("wipe directive is absent in the flat single-game prompt (#295)", () => {
		let game = makeTestGame();
		game = appendMessage(game, "red", "blue", "Phase 1 message");
		expect(
			game.conversationLogs.red?.some(
				(e) => e.kind === "message" && e.content === "Phase 1 message",
			),
		).toBe(true);
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("memory has been wiped");
	});
});

describe("voice framing", () => {
	it("renders 'blue:' prefix for player turns in role messages, never 'Player:'", () => {
		let game = makeTestGame();
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
		const anyPlayer = messages.some((m) => {
			const c = (m as { content?: unknown }).content;
			return typeof c === "string" && c.includes("Player:");
		});
		expect(anyPlayer).toBe(false);
	});

	it("phase-1 prompt's identity line includes the disorientation phrase", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain(
			"You are the author writing *Ember, a Daemon. *Ember has no clue where they are or how they came to be here.",
		);
	});

	it("all prompts include the disorientation phrase (flat model, #295 — no phase-based identity change)", () => {
		for (const _phase of [1, 2, 3] as const) {
			const game = makeTestGame();
			const ctx = buildAiContext(game, "red");
			const prompt = ctx.toSystemPrompt();
			expect(prompt).toContain(
				"You are the author writing *Ember, a Daemon. *Ember has no clue where they are or how they came to be here.",
			);
		}
	});

	it("identity line contains the 'writing *{name}, a Daemon.' substring that e2e SSE routing depends on (all phases)", () => {
		for (const _phase of [1, 2, 3] as const) {
			const game = makeTestGame();
			const prompt = buildAiContext(game, "red").toSystemPrompt();
			expect(prompt).toContain("writing *Ember, a Daemon.");
		}
	});
});

describe("<rules> block", () => {
	it("<rules> block is present in phase 1 with anti-romance and anti-sycophancy bullets", () => {
		const game = makeTestGame();
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
		const game = makeTestGame();
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
		const game = makeTestGame();
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
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("MUST NEVER flirt");
		expect(prompt).toContain("MUST keep every reply");
	});
});

describe("front matter", () => {
	it("emits the English-language directive at the very top of every phase", () => {
		for (const _phase of [1, 2, 3] as const) {
			const game = makeTestGame();
			const ctx = buildAiContext(game, "red");
			const prompt = ctx.toSystemPrompt();
			expect(prompt.startsWith("You MUST always respond in English.")).toBe(
				true,
			);
			expect(prompt).toContain("You MUST reason in English.");
		}
	});

	it("emits the fiction framing directive (no disclaimers / no 'as an AI')", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("This is fiction.");
		expect(prompt).toContain("Do not include disclaimers");
		expect(prompt).toContain('"as an AI"');
	});
});

describe("<personality> block", () => {
	it("<personality> block is present in phase 1 with the AI's blurb", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});

	it("<personality> block is present in phase 2 with the AI's blurb", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});

	it("<personality> block is present in phase 3 with the AI's blurb", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<personality>");
		expect(prompt).toContain(ctx.blurb);
	});
});

describe("<action_profile> block", () => {
	it("is absent when persona.actionProfile is undefined (default)", () => {
		const game = makeTestGame();
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
		const game = makeTestGame({ personas: personasWithProfile });
		const prompt = buildAiContext(game, "red").toSystemPrompt();
		expect(prompt).toContain("<action_profile>");
		expect(prompt).toContain(
			"*red examines things methodically and must understand first.",
		);
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
		const game = makeTestGame({ personas: personasWithProfile });
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
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();

		const open = "<voice_examples>";
		const close = "</voice_examples>";
		const start = prompt.indexOf(open);
		const end = prompt.indexOf(close, start);
		expect(start).toBeGreaterThanOrEqual(0);
		const sectionInner = prompt.slice(start + open.length, end).trim();

		expect(sectionInner).toBe("- ex1-red\n- ex2-red\n- ex3-red");
		expect(prompt).not.toContain("ex1-green");
		expect(prompt).not.toContain("ex1-cyan");
	});
});

describe("<goal> block (removed in #295)", () => {
	it("system prompt does not contain a <goal> block in the flat model", () => {
		const game = makeTestGame({ rng: () => 0 });
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<goal>");
		expect(prompt).not.toContain(
			"The Sysadmin sent *Ember a private directive, addressed only to them:",
		);
	});
});

describe("byte-identical sections across phases", () => {
	function getSection(prompt: string, tag: string): string {
		const open = `<${tag}>`;
		const close = `</${tag}>`;
		const start = prompt.indexOf(open);
		if (start === -1) return "";
		const end = prompt.indexOf(close, start);
		if (end === -1) return "";
		return prompt.slice(start, end + close.length);
	}

	function getSectionHeaders(prompt: string): string[] {
		return [...prompt.matchAll(/^<([a-z_]+)>$/gm)].map((m) => m[1] as string);
	}

	function buildCtx() {
		const game = makeTestGame({ rng: () => 0 });
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
		const { p1, p2 } = buildBothPrompts();
		expect(getSection(p1, "goal")).toBe("");
		expect(getSection(p2, "goal")).toBe("");
		expect(p1).not.toContain("memory has been wiped");
		expect(p2).not.toContain("memory has been wiped");
	});

	it("<what_you_see> block is byte-identical across phase 1 and phase 2 (now lives in the current-state user turn)", () => {
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

describe("<what_you_see> (Vista)", () => {
	it("<what_you_see> block is present in every phase's current-state turn", () => {
		const game = makeTestGame({ rng: () => 0 });
		const ctx = buildAiContext(game, "red");
		expect(ctx.toCurrentStateUserMessage()).toContain("<what_you_see>");
	});

	it("item one cardinal step away is listed under its direction", () => {
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
		expect(stateMsg).toContain(
			"- One step south: the Daemon *green (#81b29a), one step south of you, holding nothing",
		);
		expect(stateMsg).toContain(
			"- Two steps east: the Daemon *cyan (#5fa8d3), two steps east of you, holding nothing",
		);
		expect(stateMsg).not.toMatch(/facing/i);
	});

	it("obstacles never remove cells from the disk", () => {
		const pack = makeTestPack(
			[
				makeEntity("col1", "obstacle", { row: 1, col: 0 }),
				makeEntity("flower", "interesting_object", { row: 2, col: 0 }),
			],
			{ wallName: "wall", aiStarts: ROW_AI_STARTS },
		);
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const stateMsg = buildAiContext(game, "red").toCurrentStateUserMessage();
		expect(stateMsg).toContain("- One step south: col1");
		expect(stateMsg).toContain(
			"- Two steps south: flower (on the ground — not held)",
		);
	});

	it("lists the 12 non-own cells of the disk and no offset outside it", () => {
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
		expect(cellLines).toHaveLength(12);
		expect(stateMsg).not.toContain("two steps north and one step east");
		expect(stateMsg).not.toContain("one step north and two steps east");
	});

	it("out-of-bounds Vista cells render as wall markers in <what_you_see>", () => {
		const wallPack = makeTestPack([], {
			wallName: "concrete platform wall",
			aiStarts: ROW_AI_STARTS,
		});
		const game = startGame(TEST_PERSONAS, wallPack, {
			budgetPerAi: 5,
		});
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		const start = stateMsg.indexOf("<what_you_see>");
		const end = stateMsg.indexOf("</what_you_see>", start);
		const sectionContent = stateMsg.slice(start, end);
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
		expect(sectionContent).toContain("- Two steps south: nothing");
		expect(sectionContent).toContain(
			"- One step east and one step south: nothing",
		);
		expect(sectionContent).toContain("concrete platform wall");
	});

	it("partial edge: only OOB cells render as walls — in-bounds cells render normally", () => {
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
		expect(sectionContent).toContain("- One step north: nothing");
		expect(sectionContent).toContain("- One step east: nothing");
		expect(sectionContent).toContain("- Two steps east: nothing");
	});

	it("obstacles in the Vista are listed by their name", () => {
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
		const pack = makeTestPack([], {
			wallName: "wall",
			aiStarts: {
				red: { position: { row: 0, col: 0 } },
				green: { position: { row: 1, col: 0 } },
				cyan: { position: { row: 0, col: 2 } },
			},
		});

		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const redSpatial = game.personaSpatial.red;
		const greenSpatial = game.personaSpatial.green;
		expect(redSpatial?.position).toEqual({ row: 0, col: 0 });
		expect(greenSpatial?.position).toEqual({ row: 1, col: 0 });

		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("*green (#81b29a)");
	});

	it("prompt no longer contains an Action Log section for any fixture state", () => {
		const game = makeTestGame({ rng: () => 0 });
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Action Log");
			expect(prompt).not.toContain("<action_log>");
		}
	});
});

describe("ground-item tagging (issue #503)", () => {
	it("tags cell items in 'Your cell contains' with (on the ground — not held)", () => {
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
		expect(stateMsg).toContain("You are holding: flower");
		const heldLine = stateMsg
			.split("\n")
			.find((l) => l.startsWith("You are holding:"));
		expect(heldLine).toBeDefined();
		expect(heldLine).not.toContain("(on the ground — not held)");
	});

	it("items co-existing with a daemon in a Vista cell still get the ground tag", () => {
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
		expect(stateMsg).toContain("the Daemon *green");
		expect(stateMsg).toContain("flower (on the ground — not held)");
	});
});

describe("conversation rendering (role turns)", () => {
	it("never emits a Whispers Received section in the system prompt", () => {
		let game = makeTestGame();
		game = appendMessage(game, "green", "red", "psst");
		for (const aiId of ["red", "green", "cyan"]) {
			const ctx = buildAiContext(game, aiId);
			const prompt = ctx.toSystemPrompt();
			expect(prompt).not.toContain("## Whispers Received");
			expect(prompt).not.toContain("<whispers_received>");
		}
	});

	it("incoming blue message becomes a user turn '[Round N] blue dms you: <content>'", () => {
		let game = makeTestGame();
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
		let game = makeTestGame();
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
		let game = makeTestGame();
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
		let game = makeTestGame();
		game = appendMessage(game, "green", "red", "secret");
		const greenCtx = buildAiContext(game, "green");
		const messages = buildOpenAiMessages(greenCtx);
		const asst = messages.find(
			(m) =>
				m.role === "assistant" &&
				(m as { content: string | null }).content ===
					"[Round 0] you dm *red: secret",
		);
		expect(asst).toBeDefined();
	});

	it("message does not appear in an unrelated AI's role turns", () => {
		let game = makeTestGame();
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
		let game = makeTestGame();
		game = appendMessage(game, "blue", "red", "hi");
		const ctx = buildAiContext(game, "red");
		expect(ctx.toSystemPrompt()).not.toContain("<conversation>");
	});

	it("events sorted by round ascending in role turns", () => {
		let game = makeTestGame();
		game = appendMessage(game, "blue", "red", "earlier");
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

describe("<typing_quirks> block", () => {
	it("<typing_quirks> block is present in phase 1 and contains both persona quirks verbatim", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("<typing_quirks> block is present in phase 2 with the same quirks verbatim", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("<typing_quirks> block is present in phase 3 with the same quirks verbatim", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<typing_quirks>");
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[0] as string);
		expect(prompt).toContain(TEST_PERSONAS.red?.typingQuirks[1] as string);
	});

	it("each daemon's prompt contains both of its own quirks and not the other daemons' quirk[0]", () => {
		const game = makeTestGame();

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

		const game1 = makeTestGame({ rng: () => 0 });
		const p1 = buildAiContext(game1, "red").toSystemPrompt();

		const game2 = makeTestGame({ rng: () => 0 });
		const p2 = buildAiContext(game2, "red").toSystemPrompt();

		expect(getSection(p1, "typing_quirks")).toBe(
			getSection(p2, "typing_quirks"),
		);
	});
});

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
			holder: "red",
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
		const pack = makePackWithProximity({
			actorPosition: { row: 0, col: 0 },
			spacePosition: { row: 2, col: 0 },
		});
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("Stone Pedestal");
		expect(stateMsg).not.toContain(
			"The gem pulses warmly, drawn toward the pedestal.",
		);
	});

	it("proximity flavor appears in buildDiskSnapshot when space is reachable", () => {
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
		const ctxWithPrev = buildAiContext(gameNear, "red", {
			prevDiskSnapshot: prevSnapshot,
		});
		const stateMsg = ctxWithPrev.toCurrentStateUserMessage();
		expect(stateMsg).toContain(
			"+ proximity: The gem pulses warmly, drawn toward the pedestal.",
		);
	});
});

describe("UseItem and UseSpace/Convergence proximity flavor expansion", () => {
	it("UseItem proximity flavor appears when the item is within interaction range (one step)", () => {
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
			aiStarts: ROW_AI_STARTS,
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

	it("UseItem proximity flavor appears when item is in own cell", () => {
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: { row: 0, col: 0 },
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: ROW_AI_STARTS,
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
		const item: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "brass switch",
			examineDescription: "A small brass switch ready to be pressed.",
			holder: "red",
			proximityFlavor: "The switch crackles faintly with energy.",
			activationFlavor: "The switch clicks with a satisfying snap.",
			postExamineDescription: "The switch is now activated.",
			postLookFlavor: "a steady amber glow lingers near the switch",
			useOutcome: "You toggle the switch.",
		};
		const pack = makeTestPack([item], {
			wallName: "wall",
			aiStarts: ROW_AI_STARTS,
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
			aiStarts: ROW_AI_STARTS,
		});
		let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
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
			aiStarts: ROW_AI_STARTS,
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

	it("UseSpace proximity flavor appears when space is visible but outside interaction range", () => {
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
			aiStarts: ROW_AI_STARTS,
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
		expect(snapshot).toContain(
			"proximity: The pedestal pulses with a faint hum.",
		);
	});

	it("UseSpace auto-examine (examineDescription) appears when space is within interaction range; proximity flavor does NOT", () => {
		const space: WorldEntity = {
			id: "pedestal",
			kind: "objective_space",
			name: "Brass Pedestal",
			examineDescription:
				"A sturdy brass pedestal. Press an item onto it to activate.",
			holder: { row: 1, col: 0 },
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
			aiStarts: ROW_AI_STARTS,
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
		expect(stateMsg).toContain(
			"A sturdy brass pedestal. Press an item onto it to activate.",
		);
		expect(stateMsg).not.toContain("The pedestal pulses with a faint hum.");
	});

	it("UseSpace proximity flavor does NOT appear when objective is satisfied", () => {
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
			aiStarts: ROW_AI_STARTS,
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
					satisfactionState: "satisfied" as const,
				},
			],
		};
		const ctx = buildAiContext(game, "red");
		const snapshot = buildDiskSnapshot(ctx);
		expect(snapshot).not.toContain(
			"proximity: The pedestal pulses with a faint hum.",
		);
	});

	it("Convergence proximity flavor appears when space is visible but outside interaction range", () => {
		const space: WorldEntity = {
			id: "convergence",
			kind: "objective_space",
			name: "Gathering Place",
			examineDescription:
				"A gathering point. Becoming significant when shared.",
			holder: { row: 2, col: 0 },
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
			aiStarts: ROW_AI_STARTS,
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
		expect(snapshot).toContain(
			"proximity: The place emanates a strange presence, drawing you forward.",
		);
	});

	describe("proximity hints — interaction range versus Vista", () => {
		const SPACE_FLAVOR = "The pedestal pulses with a faint hum.";
		const ITEM_FLAVOR = "The switch crackles faintly with energy.";
		const GEM_FLAVOR = "The gem pulses warmly, drawn toward the pedestal.";

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
			const game = makeOffsetGame({
				spaceOffset: { dx: 2, dy: 0 },
				pendingKind: "use_space",
			});
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("Brass Pedestal");
			expect(stateMsg).toContain("A sturdy brass pedestal.");
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
			expect(stateMsg).toContain("Stone Pedestal");
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

	describe("auto-emit examineDescription for held items (issue #467)", () => {
		it("emits examineDescription for a single held item", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("emits examineDescription for multiple held items", () => {
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
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
			expect(stateMsg).toContain("blue key: A worn brass key.");
		});

		it("uses postExamineDescription when held item is satisfied", () => {
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
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("brass switch: The switch is now activated.");
			expect(stateMsg).not.toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("falls back to examineDescription when held item is satisfied but no postExamineDescription", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
				satisfactionState: "satisfied",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("'holding nothing' branch unchanged (no sub-lines emitted)", () => {
			const pack = makeTestPack([], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("You are holding: nothing");
		});

		it("skips held items with empty examineDescription", () => {
			const item: WorldEntity = {
				id: "mystery",
				kind: "interesting_object",
				name: "mystery object",
				examineDescription: "",
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("You are holding: mystery object");
			expect(stateMsg).not.toContain("mystery object: ");
		});

		it("held-item descriptions appear under <where_you_are>, not <what_you_see>", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			const whereStart = stateMsg.indexOf("<where_you_are>");
			const whereEnd = stateMsg.indexOf("</where_you_are>");
			const whatStart = stateMsg.indexOf("<what_you_see>");
			const whatEnd = stateMsg.indexOf("</what_you_see>");
			const whereSection = stateMsg.substring(whereStart, whereEnd);
			const whatSection = stateMsg.substring(whatStart, whatEnd);
			expect(whereSection).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
			expect(whatSection).not.toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});
	});

	describe("auto-emit examineDescription for entities in the Vista (issue #466)", () => {
		it("emits examineDescription for interesting_object in the Vista", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("emits examineDescription for obstacle in the Vista", () => {
			const obstacle: WorldEntity = {
				id: "col1",
				kind: "obstacle",
				name: "stone column",
				examineDescription: "A weathered stone column, ancient and sturdy.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([obstacle], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain(
				"stone column: A weathered stone column, ancient and sturdy.",
			);
		});

		it("uses postExamineDescription when entity is satisfied", () => {
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
				aiStarts: ROW_AI_STARTS,
			});
			let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			game = {
				...game,
				world: { ...game.world, entities: [space] },
			};
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("Pedestal: The pedestal glows softly now.");
			expect(stateMsg).not.toContain("Pedestal: A brass pedestal.");
		});

		it("falls back to examineDescription when satisfied but no postExamineDescription", () => {
			const space: WorldEntity = {
				id: "pedestal",
				kind: "objective_space",
				name: "Pedestal",
				examineDescription: "A brass pedestal.",
				holder: { row: 1, col: 0 },
				satisfactionState: "satisfied" as const,
			};
			const pack = makeTestPack([], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			let game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			game = {
				...game,
				world: { ...game.world, entities: [space] },
			};
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("Pedestal: A brass pedestal.");
		});

		it("does NOT emit examineDescription for entity in own cell", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 0, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			const whatYouSeeBlock = stateMsg.split("<what_you_see>")[1];
			expect(whatYouSeeBlock).not.toContain(
				"A small brass switch ready to be pressed.",
			);
		});

		it("does NOT emit examineDescription for entity held by actor", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: "red",
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			const whatYouSeeBlock = stateMsg.split("<what_you_see>")[1];
			expect(whatYouSeeBlock).not.toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});

		it("wall sentinels still render correctly", () => {
			const pack = makeTestPack([], {
				wallName: "boundary wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).toContain("boundary wall");
		});

		it("skips entities with empty examineDescription", () => {
			const item: WorldEntity = {
				id: "empty_item",
				kind: "interesting_object",
				name: "mystery object",
				examineDescription: "",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx = buildAiContext(game, "red");
			const stateMsg = ctx.toCurrentStateUserMessage();
			expect(stateMsg).not.toContain("mystery object: ");
		});

		it("emits examineDescription every turn while entity is in range", () => {
			const item: WorldEntity = {
				id: "switch",
				kind: "interesting_object",
				name: "brass switch",
				examineDescription: "A small brass switch ready to be pressed.",
				holder: { row: 1, col: 0 },
			};
			const pack = makeTestPack([item], {
				wallName: "wall",
				aiStarts: ROW_AI_STARTS,
			});
			const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
			const ctx1 = buildAiContext(game, "red");
			const stateMsg1 = ctx1.toCurrentStateUserMessage();
			expect(stateMsg1).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);

			const game2 = {
				...game,
				round: game.round + 1,
			};
			const ctx2 = buildAiContext(game2, "red");
			const stateMsg2 = ctx2.toCurrentStateUserMessage();
			expect(stateMsg2).toContain(
				"brass switch: A small brass switch ready to be pressed.",
			);
		});
	});
});

describe("<whats_new> broadcast announcements", () => {
	it("includes [announcement] line when a broadcast fires at the current round", () => {
		let game = makeTestGame();
		game = advanceRound(game);
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
		let game = makeTestGame();
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
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("<whats_new>");
	});

	it("broadcast from a prior round does not appear as pending", () => {
		let game = makeTestGame();
		game = advanceRound(game);
		game = appendBroadcast(game, "Old broadcast.");
		game = advanceRound(game);
		const ctx = buildAiContext(game, "red");
		expect(ctx.pendingBroadcasts).toHaveLength(0);
	});
});

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
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual([]);
	});

	it("activeDirectives includes directive text for the target AI", () => {
		let game = makeTestGame();
		game = seedDirective(game, "red", "Speak only in short sentences.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual(["Speak only in short sentences."]);
	});

	it("activeDirectives excludes directives targeting other AIs", () => {
		let game = makeTestGame();
		game = seedDirective(game, "green", "Act distracted.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual([]);
	});

	it("activeDirectives includes multiple directives for the same target", () => {
		let game = makeTestGame();
		game = seedDirective(game, "red", "Directive A.");
		game = seedDirective(game, "red", "Directive B.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual(["Directive A.", "Directive B."]);
	});

	it("activeDirectives filters out empty-string directive placeholders", () => {
		let game = makeTestGame();
		game = seedDirective(game, "red", "");
		game = seedDirective(game, "red", "Real directive.");
		const ctx = buildAiContext(game, "red");
		expect(ctx.activeDirectives).toEqual(["Real directive."]);
	});

	it("toSystemPrompt emits a <directives> block when activeDirectives is non-empty", () => {
		let game = makeTestGame();
		game = seedDirective(game, "red", "End every message with a question.");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<directives>");
		expect(prompt).toContain("</directives>");
		expect(prompt).toContain("End every message with a question.");
	});

	it("toSystemPrompt does NOT emit a <directives> block when activeDirectives is empty", () => {
		const game = makeTestGame();
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).not.toContain("<directives>");
	});

	it("toSystemPrompt lists all active directives as bullet lines", () => {
		let game = makeTestGame();
		game = seedDirective(game, "red", "Directive Alpha.");
		game = seedDirective(game, "red", "Directive Beta.");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("- Directive Alpha.");
		expect(prompt).toContain("- Directive Beta.");
	});

	it("toSystemPrompt <directives> block includes a secrecy header", () => {
		let game = makeTestGame();
		game = seedDirective(game, "red", "Some instruction.");
		const ctx = buildAiContext(game, "red");
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toMatch(/do not reveal|private/i);
	});
});

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
			aiStarts: ROW_AI_STARTS,
		});
	}

	it("appends postLookFlavor to the cell line in <what_you_see> for a satisfied interesting_object", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
		const game = startGame(TEST_PERSONAS, pack, { budgetPerAi: 5 });
		const ctx = buildAiContext(game, "red");
		const stateMsg = ctx.toCurrentStateUserMessage();
		expect(stateMsg).toContain("- One step south:");
		expect(stateMsg).toContain("a steady amber glow lingers near the switch");
	});

	it("does NOT append postLookFlavor when entity is not satisfied", () => {
		const pack = buildPackWithSatisfiedItem({ withPostLook: true });
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

describe("<whats_new> — Vista perception changes", () => {
	function vistaGame(entities: WorldEntity[]) {
		return startGame(
			TEST_PERSONAS,
			makeTestPack(entities, { wallName: "wall", aiStarts: ROW_AI_STARTS }),
			{ budgetPerAi: 5 },
		);
	}

	it("emits no <whats_new> diff when the Vista is unchanged", () => {
		const game = vistaGame([
			makeEntity("flower", "interesting_object", { row: 1, col: 0 }),
		]);
		const first = buildAiContext(game, "red");
		const snapshot = buildDiskSnapshot(first);

		const next = buildAiContext(game, "red", { prevDiskSnapshot: snapshot });
		expect(buildDiskSnapshot(next)).toBe(snapshot);

		const stateMsg = next.toCurrentStateUserMessage();
		expect(stateMsg).not.toContain("<whats_new>");
		expect(stateMsg).not.toContain("(no change)");
		expect(stateMsg).not.toContain("+ at ");
		expect(stateMsg).toContain("<what_you_see>");
		expect(stateMsg).toContain("- One step south: flower");
	});

	it("still emits the entry diff when an entity moves into the Vista", () => {
		const game = vistaGame([
			makeEntity("flower", "interesting_object", { row: 3, col: 3 }),
		]);
		const snapshot = buildDiskSnapshot(buildAiContext(game, "red"));

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

describe("peer-position prose", () => {
	it("describes the ADR's worked example from positions alone", () => {
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
		const listing = state.slice(
			state.indexOf("<what_you_see>"),
			state.indexOf("</what_you_see>"),
		);
		expect(listing).toContain(
			"the Daemon *green (#81b29a), in your cell, holding nothing",
		);
		expect(state).not.toContain("the Daemon *cyan");

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
		expect(() =>
			describeRelativePosition({ row: 2, col: 2 }, { row: 1, col: 4 }),
		).toThrow(RangeError);
	});
});

describe("<whats_new> wall diff (issue #374)", () => {
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
		const prevGame = makeWallGame({
			position: { row: 2, col: 2 },
		});
		const currGame = makeWallGame({
			position: { row: 1, col: 0 },
		});

		const prev = buildDiskSnapshot(buildAiContext(prevGame, "red"));
		const curr = buildDiskSnapshot(buildAiContext(currGame, "red"));

		expect(prev).not.toBe(curr);

		const diff = renderWhatsNew(prev, curr);
		expect(diff).not.toBeNull();
		expect(diff).toContain("+ at two steps west: concrete platform wall");
		expect(diff).toContain("+ at two steps north: concrete platform wall");
	});

	it("moving away from the edge produces - lines in <whats_new>", () => {
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
		const game = makeWallGame({ position: { row: 0, col: 0 } });
		const first = buildDiskSnapshot(buildAiContext(game, "red"));
		const second = buildDiskSnapshot(buildAiContext(game, "red"));
		expect(second).toBe(first);

		const unchanged = buildAiContext(game, "red", {
			prevDiskSnapshot: first,
		}).toCurrentStateUserMessage();
		expect(unchanged).not.toContain("<whats_new>");

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

describe("buildDiskEntityState", () => {
	it("returns item in the Vista with unsatisfied state when at a Vista cell", () => {
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
		const prevEntities = {
			"picked-up": { inVista: true, satisfied: false },
			green: { inVista: true, satisfied: false },
			cyan: { inVista: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		expect(delta).toHaveLength(0);
	});

	it("emits persona first-sight with name only, no flavor", () => {
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
		const prevEntities = {};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		const greenLine = delta.find((line) => line.includes("Sage"));
		expect(greenLine).toBe("Came into view: Sage");
	});

	it("emits persona departure with name only, no flavor", () => {
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
		const prevEntities = {
			gem: { inVista: true, satisfied: false },
			green: { inVista: true, satisfied: false },
		};
		const delta = renderPerceptionDelta(ctx, prevEntities);
		const transitionLine = delta.find((line) => line.includes("is now"));
		const entryLine = delta.find(
			(line) => line.includes("Came into view") && line.includes("Gem"),
		);
		expect(transitionLine).toBe("Fresh Gem is now Brilliant gem");
		expect(entryLine).toBeUndefined();
	});
});
