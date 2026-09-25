import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentPack } from "../game/types.js";
import {
	makeLocalStorageStub,
	seedSessionInStub,
} from "./fixtures/local-storage";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

vi.mock("../../content", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../content")>();
	return {
		...actual,
		generatePersonas: async () => STATIC_PERSONAS,
	};
});

vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks: async () => ({
		packA: STATIC_CONTENT_PACKS[0],
		packB: STATIC_CONTENT_PACKS[0],
	}),
}));

vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
vi.stubGlobal("__DEV__", true);

const INDEX_BODY_HTML = `
<main>
  <div id="panels">
    <article class="ai-panel" data-ai="red">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="red"></div>
    </article>
    <article class="ai-panel" data-ai="green">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="green"></div>
    </article>
    <article class="ai-panel" data-ai="cyan">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="cyan"></div>
    </article>
  </div>
  <form id="composer">
    <div class="prompt-wrap">
      <div id="prompt-overlay" aria-hidden="true"></div>
      <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    </div>
    <output id="lockout-error" class="lockout-error" role="status" aria-live="polite" hidden></output>
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <aside id="persistence-warning" hidden role="status" aria-live="polite"></aside>
  <section id="endgame" hidden></section>
</main>
`;

function getEl<T extends HTMLElement>(selector: string): T {
	const el = document.querySelector<T>(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("renderGame — session restore (formerly async bootstrap)", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		vi.stubGlobal("__DEV__", true);
		document.body.innerHTML = INDEX_BODY_HTML;
		const stub = makeLocalStorageStub();
		await seedSessionInStub(stub);
		vi.stubGlobal("localStorage", stub);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("after awaiting renderGame (restore path), panels are initialized with persona handles", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../views/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		const greenPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="green"]',
		);
		const cyanPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="cyan"]',
		);

		expect(redPanel).toBeTruthy();
		expect(greenPanel).toBeTruthy();
		expect(cyanPanel).toBeTruthy();
	});
});

describe("persistence — LLM-shaped blurb round-trips verbatim", () => {
	const TEST_CONTENT_PACK: ContentPack = {
		setting: "",
		weather: "",
		timeOfDay: "",
		entities: [],
		wallName: "wall",
		aiStarts: {},
	};

	it("serializeSession + deserializeSession preserves an LLM-shaped blurb", async () => {
		const { serializeSession, deserializeSession } = await import(
			"../persistence/session-codec.js"
		);
		const { startGame } = await import("../game/engine.js");

		const LLM_BLURB =
			"Ember is stoic and methodical, yet prone to sudden bursts of impulsive clarity. Every problem they encounter becomes a lens — not to examine the world, but to examine themself. Ember holds order as a value not because rules comfort them but because disorder reveals too much, too quickly. Contradiction fuels them. Ember is never quite settled.";

		const personasWithLlmBlurb = {
			red: {
				id: "red",
				name: "Ember",
				color: "#e07a5f",
				temperaments: ["stoic", "impulsive"] as [string, string],
				personaGoal: "Examine everything.",
				typingQuirks: [
					"You speak in fragments. Short bursts. Rarely complete sentences.",
					"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
				] as [string, string],
				blurb: LLM_BLURB,
				voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
			},
			green: {
				id: "green",
				name: "Sage",
				color: "#81b29a",
				temperaments: ["meticulous", "meticulous"] as [string, string],
				personaGoal: "Ensure items are evenly distributed.",
				typingQuirks: [
					"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
					"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
				] as [string, string],
				blurb:
					"Sage is intensely meticulous. Ensure items are evenly distributed.",
				voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
			},
			cyan: {
				id: "cyan",
				name: "Frost",
				color: "#5fa8d3",
				temperaments: ["laconic", "diffident"] as [string, string],
				personaGoal: "Hold the key at phase end.",
				typingQuirks: [
					'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
					"You end almost every reply with a question, no matter what the topic is — does that make sense?",
				] as [string, string],
				blurb: "Frost is laconic and diffident. Hold the key at phase end.",
				voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
			},
		};

		const game = startGame(personasWithLlmBlurb, TEST_CONTENT_PACK, {
			budgetPerAi: 5,
			rng: () => 0,
		});
		const now = new Date().toISOString();
		const files = serializeSession(game, now, now);
		const result = deserializeSession(files);

		if (result.kind !== "ok")
			throw new Error(`Expected ok, got ${result.kind}`);
		const restored = result.state;

		expect(restored.personas.red?.blurb).toBe(LLM_BLURB);
		expect(restored.personas.green?.blurb).toBe(
			"Sage is intensely meticulous. Ensure items are evenly distributed.",
		);
	});
});
