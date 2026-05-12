/**
 * Integration tests for the newGame() async bootstrap flow (issue #122).
 *
 * Tests: seeded RNG + mock LLM → synthesis call → blurbs in session state.
 * Also covers the persistence round-trip for LLM-shaped blurbs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs";
import { STATIC_PERSONAS } from "./fixtures/static-personas";

// Pin to static personas so panel data-ai attributes are stable
vi.mock("../../content", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../content")>();
	return {
		...actual,
		generatePersonas: async () => STATIC_PERSONAS,
	};
});

// Pin generateDualContentPacks to static content packs (no LLM call in tests).
vi.mock("../../content/content-pack-generator", () => ({
	generateDualContentPacks: async () => ({
		packsA: STATIC_CONTENT_PACKS,
		packsB: STATIC_CONTENT_PACKS,
	}),
}));

vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  <aside id="action-log" hidden>
    <h3>Action Log (debug)</h3>
    <ul id="action-log-list"></ul>
  </aside>
  <section id="endgame" hidden></section>
</main>
`;

function getEl<T extends HTMLElement>(selector: string): T {
	const el = document.querySelector<T>(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Post-#173: game.ts no longer runs async bootstrap — it restores from an
 * active session. The async bootstrap tests (synthesis failure, content-pack
 * failure, form submit before resolution) have moved to start.test.ts where
 * they belong: those scenarios now apply to renderStart, not renderGame.
 *
 * This describe block verifies that game.ts correctly restores panels from
 * a pre-existing session (the restore path that replaced the old async IIFE).
 */
describe("renderGame — session restore (formerly async bootstrap)", () => {
	beforeEach(async () => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
		// Pre-populate a valid session so game.ts takes the restore path.
		const store: Record<string, string> = {};
		const stub = {
			getItem: vi.fn((key: string) => store[key] ?? null),
			setItem: vi.fn((key: string, value: string) => {
				store[key] = value;
			}),
			removeItem: vi.fn((key: string) => {
				delete store[key];
			}),
			clear: vi.fn(() => {
				for (const k of Object.keys(store)) delete store[k];
			}),
			get length() {
				return Object.keys(store).length;
			},
			key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
			_store: store,
		};
		const { buildSessionFromAssets } = await import("../game/bootstrap.js");
		const { mintAndActivateNewSession, saveActiveSession } = await import(
			"../persistence/session-storage.js"
		);
		const prev = globalThis.localStorage;
		Object.defineProperty(globalThis, "localStorage", {
			value: stub,
			writable: true,
			configurable: true,
		});
		try {
			mintAndActivateNewSession();
			const session = buildSessionFromAssets({
				personas: STATIC_PERSONAS,
				contentPacksA: STATIC_CONTENT_PACKS,
				contentPacksB: STATIC_CONTENT_PACKS,
			});
			saveActiveSession(session.getState());
		} finally {
			Object.defineProperty(globalThis, "localStorage", {
				value: prev,
				writable: true,
				configurable: true,
			});
		}
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
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		// STATIC_PERSONAS uses red/green/cyan as ids, Ember/Sage/Frost as names
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

// ── Persistence round-trip regression ────────────────────────────────────────

describe("persistence — LLM-shaped blurb round-trips verbatim", () => {
	it("serializeSession + deserializeSession preserves an LLM-shaped blurb", async () => {
		const { serializeSession, deserializeSession } = await import(
			"../persistence/session-codec.js"
		);
		const { createGame, startPhase } = await import("../game/engine.js");
		const { PHASE_1_CONFIG } = await import("../../content/index.js");

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

		const game = startPhase(
			createGame(personasWithLlmBlurb),
			PHASE_1_CONFIG,
			() => 0,
		);
		const now = new Date().toISOString();
		const files = serializeSession(game, now, now);
		const result = deserializeSession(files);

		if (result.kind !== "ok")
			throw new Error(`Expected ok, got ${result.kind}`);
		const restored = result.state;

		// The LLM blurb must survive the round-trip byte-for-byte
		expect(restored.personas.red?.blurb).toBe(LLM_BLURB);
		// Shorter template blurbs also survive intact
		expect(restored.personas.green?.blurb).toBe(
			"Sage is intensely meticulous. Ensure items are evenly distributed.",
		);
	});
});
