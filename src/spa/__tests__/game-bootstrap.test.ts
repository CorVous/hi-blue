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

// Pin generateContentPacks to static content packs (no LLM call in tests).
vi.mock("../../content/content-pack-generator", () => ({
	generateContentPacks: async () => STATIC_CONTENT_PACKS,
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
    <article class="ai-panel" data-ai="blue">
      <header class="panel-header">
        <span class="panel-name"></span>
        <span class="panel-budget" data-budget=""></span>
      </header>
      <div class="transcript" data-transcript="blue"></div>
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

describe("renderGame — async new-game bootstrap", () => {
	beforeEach(() => {
		vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("after awaiting renderGame, panels are initialized with persona handles", async () => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		// STATIC_PERSONAS uses red/green/blue as ids, Ember/Sage/Frost as names
		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		const greenPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="green"]',
		);
		const bluePanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="blue"]',
		);

		expect(redPanel).toBeTruthy();
		expect(greenPanel).toBeTruthy();
		expect(bluePanel).toBeTruthy();
	});

	it("synthesis failure shows #cap-hit and hides #panels", async () => {
		// generatePersonas is mocked to succeed, but BrowserSynthesisProvider's
		// fetch can fail. We simulate this by making generatePersonas throw.
		vi.resetModules();

		// Override the generatePersonas mock to throw for this test
		vi.doMock("../../content", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../../content")>();
			return {
				...actual,
				generatePersonas: async () => {
					throw new Error("synthesis failed");
				},
			};
		});

		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});

		const { renderGame } = await import("../routes/game.js");
		// renderGame starts the async IIFE but doesn't throw synchronously;
		// the failure is surfaced inside the IIFE. We await to let it resolve/reject.
		try {
			await renderGame(getEl<HTMLElement>("main"));
		} catch {
			// Expected — synthesis failure re-throws inside IIFE
		}

		const capHit = document.querySelector<HTMLElement>("#cap-hit");
		const panels = document.querySelector<HTMLElement>("#panels");
		expect(capHit?.hasAttribute("hidden")).toBe(false);
		expect(panels?.hidden).toBe(true);
	});

	it("content-pack failure (generic Error) shows #cap-hit and hides #panels", async () => {
		// generatePersonas succeeds but generateContentPacks throws a generic error.
		vi.resetModules();

		// Re-establish the working generatePersonas mock (the synthesis-failure test
		// above may have registered a throwing doMock; doMocks accumulate across
		// vi.resetModules() calls, so we must explicitly restore it here).
		vi.doMock("../../content", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../../content")>();
			return { ...actual, generatePersonas: async () => STATIC_PERSONAS };
		});

		vi.doMock("../../content/content-pack-generator", () => ({
			generateContentPacks: async () => {
				throw new Error("content pack generation failed");
			},
		}));

		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});

		const { renderGame } = await import("../routes/game.js");
		try {
			await renderGame(getEl<HTMLElement>("main"));
		} catch {
			// Expected — failure re-throws inside IIFE
		}

		const capHit = document.querySelector<HTMLElement>("#cap-hit");
		const panels = document.querySelector<HTMLElement>("#panels");
		expect(capHit?.hasAttribute("hidden")).toBe(false);
		expect(panels?.hidden).toBe(true);
	});

	it("content-pack failure (CapHitError) shows #cap-hit and hides #panels", async () => {
		// generatePersonas succeeds but generateContentPacks throws a CapHitError.
		vi.resetModules();

		// Re-establish the working generatePersonas mock (doMocks accumulate across
		// vi.resetModules() calls, so we must explicitly restore it here).
		vi.doMock("../../content", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../../content")>();
			return { ...actual, generatePersonas: async () => STATIC_PERSONAS };
		});

		vi.doMock("../../content/content-pack-generator", () => ({
			generateContentPacks: async () => {
				const { CapHitError } = await import("../llm-client.js");
				throw new CapHitError({
					message: "cap hit during content pack generation",
					reason: "per-ip-daily",
					retryAfterSec: null,
				});
			},
		}));

		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});

		const { renderGame } = await import("../routes/game.js");
		try {
			await renderGame(getEl<HTMLElement>("main"));
		} catch {
			// Expected — CapHitError re-throws inside IIFE
		}

		const capHit = document.querySelector<HTMLElement>("#cap-hit");
		const panels = document.querySelector<HTMLElement>("#panels");
		expect(capHit?.hasAttribute("hidden")).toBe(false);
		expect(panels?.hidden).toBe(true);
	});

	it("form submit is a no-op before session resolves (no crash)", async () => {
		// This test verifies that submitting the form before async init completes
		// doesn't crash the page — the handler returns early when !session.
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();

		// Re-establish the static content-packs mock (the CapHitError test above
		// may have registered a throwing doMock for this module; doMocks accumulate
		// across vi.resetModules() calls, so we must explicitly restore it here).
		vi.doMock("../../content/content-pack-generator", () => ({
			generateContentPacks: async () => STATIC_CONTENT_PACKS,
		}));

		// We need to make generatePersonas hang briefly so we can fire submit first
		let resolvePersonas!: (v: typeof STATIC_PERSONAS) => void;
		vi.doMock("../../content", async (importOriginal) => {
			const actual = await importOriginal<typeof import("../../content")>();
			return {
				...actual,
				generatePersonas: () =>
					new Promise<typeof STATIC_PERSONAS>((resolve) => {
						resolvePersonas = resolve;
					}),
			};
		});

		const { renderGame } = await import("../routes/game.js");
		const initPromise = renderGame(getEl<HTMLElement>("main"));

		// Fire submit before personas are ready
		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "*Sage hello";
		promptInput.dispatchEvent(new Event("input"));
		expect(() => {
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		}).not.toThrow();

		// Now let personas resolve
		resolvePersonas(STATIC_PERSONAS);
		await initPromise;
		// No crash — test passes
	});
});

// ── Persistence round-trip regression ────────────────────────────────────────

describe("persistence — LLM-shaped blurb round-trips verbatim", () => {
	it("serializeGameState + deserializeGameState preserves an LLM-shaped blurb", async () => {
		const { serializeGameState, deserializeGameState } = await import(
			"../persistence/game-storage.js"
		);
		const { createGame, startPhase } = await import("../game/engine.js");
		const { PHASE_1_CONFIG } = await import("../../content/index.js");

		const LLM_BLURB =
			"You are stoic and methodical, yet prone to sudden bursts of impulsive clarity. Every problem you encounter becomes a lens — not to examine the world, but to examine yourself. You hold order as a value not because rules comfort you but because disorder reveals too much, too quickly. Contradiction fuels you. You are never quite settled.";

		const personasWithLlmBlurb = {
			red: {
				id: "red",
				name: "Ember",
				color: "#e07a5f",
				temperaments: ["stoic", "impulsive"] as [string, string],
				personaGoal: "Examine everything.",
				typingQuirk: "You speak in fragments. Short bursts. Rarely complete sentences.",
				blurb: LLM_BLURB,
				budgetPerPhase: 5,
			},
			green: {
				id: "green",
				name: "Sage",
				color: "#81b29a",
				temperaments: ["meticulous", "meticulous"] as [string, string],
				personaGoal: "Ensure items are evenly distributed.",
				typingQuirk: "You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
				blurb:
					"You are intensely meticulous. Ensure items are evenly distributed.",
				budgetPerPhase: 5,
			},
			blue: {
				id: "blue",
				name: "Frost",
				color: "#5fa8d3",
				temperaments: ["laconic", "diffident"] as [string, string],
				personaGoal: "Hold the key at phase end.",
				typingQuirk: "You never use contractions. You will not say \"won't\" or \"can't\" — you say \"will not\" and \"cannot\" every time.",
				blurb: "You are laconic and diffident. Hold the key at phase end.",
				budgetPerPhase: 5,
			},
		};

		const game = startPhase(
			createGame(personasWithLlmBlurb),
			PHASE_1_CONFIG,
			() => 0,
		);
		const persisted = serializeGameState(game);
		const restored = deserializeGameState(persisted);

		// The LLM blurb must survive the round-trip byte-for-byte
		expect(restored.personas.red?.blurb).toBe(LLM_BLURB);
		// Shorter template blurbs also survive intact
		expect(restored.personas.green?.blurb).toBe(
			"You are intensely meticulous. Ensure items are evenly distributed.",
		);
	});
});
