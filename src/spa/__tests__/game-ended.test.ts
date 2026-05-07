/**
 * Regression test for issue #89:
 *
 * The form-submit handler's `finally` block was unconditionally re-enabling
 * `#send`, undoing the disable that fires on the `game_ended` SSE event.
 *
 * Fix: hoist `let gameEnded = false` above the `try`, gate the `finally`'s
 * re-enable on `if (!gameEnded)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Provide globals before importing the module
vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");

import { STATIC_PERSONAS } from "./fixtures/static-personas";

// Pin generatePersonas to a static fixture so panel/transcript hookups
// keyed by red/green/blue continue to work in this regression test.
vi.mock("../../content", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../content")>();
	return {
		...actual,
		generatePersonas: async () => STATIC_PERSONAS,
	};
});

// ---------------------------------------------------------------------------
// Module-level mock: GameSession always returns gameEnded:true so we don't
// need a real win-condition in the phase config.
// ---------------------------------------------------------------------------
const AI_BUDGET = { remaining: 4, total: 5 };
const FAKE_PHASE_STATE = {
	phaseNumber: 1,
	objective: "get the key in the keyhole",
	round: 1,
	budgets: { red: AI_BUDGET, green: AI_BUDGET, blue: AI_BUDGET },
	chatHistories: { red: [], green: [], blue: [] },
	whispers: [],
	lockedOut: new Set<string>(),
	chatLockouts: new Map<string, number>(),
	world: { items: [] },
	aiGoals: { red: "test goal", green: "test goal", blue: "test goal" },
};

const FAKE_GAME_STATE = {
	isComplete: true,
	currentPhase: 1,
	phases: [FAKE_PHASE_STATE],
	personas: STATIC_PERSONAS,
};

const GAME_ENDED_RESULT = {
	result: {
		round: 1,
		actions: [],
		phaseEnded: true,
		gameEnded: true,
	},
	// Non-empty completions prevent the lockout branch which needs personas.name
	completions: { red: "done", green: "done", blue: "done" },
	nextState: FAKE_GAME_STATE,
};

vi.mock("../game/game-session.js", () => {
	class MockGameSession {
		submitMessage = vi.fn().mockResolvedValue(GAME_ENDED_RESULT);
		getState = vi.fn().mockReturnValue(FAKE_GAME_STATE);
		static restore = vi.fn().mockReturnValue({
			submitMessage: vi.fn().mockResolvedValue(GAME_ENDED_RESULT),
			getState: vi.fn().mockReturnValue(FAKE_GAME_STATE),
		});
	}
	return { GameSession: MockGameSession };
});

// Matches the body content of src/spa/index.html (three-panel layout)
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
    <input id="prompt" type="text" placeholder="Enter a message…" autocomplete="off" />
    <button id="send" type="submit">Send</button>
  </form>
  <section id="cap-hit" hidden></section>
  <aside id="persistence-warning" hidden role="status" aria-live="polite"></aside>
  <aside id="action-log" hidden>
    <h3>Action Log (debug)</h3>
    <ul id="action-log-list"></ul>
  </aside>
</main>
<script type="module" src="./assets/index.js"></script>
`;

function getEl<T extends HTMLElement>(selector: string): T {
	const el = document.querySelector<T>(selector);
	if (!el) throw new Error(`Element not found: ${selector}`);
	return el;
}

describe("renderGame — game_ended disables #send permanently (regression #89)", () => {
	beforeEach(() => {
		document.body.innerHTML = INDEX_BODY_HTML;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
		document.body.innerHTML = "";
	});

	it("#send stays disabled after game_ended fires (finally block must not re-enable it)", async () => {
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});
		vi.spyOn(Math, "random").mockReturnValue(0.9);

		vi.resetModules();
		const { renderGame } = await import("../routes/game.js");
		await renderGame(getEl<HTMLElement>("main"));

		const form = getEl<HTMLFormElement>("#composer");
		const promptInput = getEl<HTMLInputElement>("#prompt");
		promptInput.value = "@Sage finish the game";
		promptInput.dispatchEvent(new Event("input"));
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Wait for the async submit handler to complete
		await new Promise((resolve) => setTimeout(resolve, 300));

		// Bug: the finally block was unconditionally setting sendBtn.disabled = false,
		// undoing the game_ended handler's sendBtn.disabled = true.
		// Fix: finally only re-enables if !gameEnded.
		const sendBtn = getEl<HTMLButtonElement>("#send");
		expect(sendBtn.disabled).toBe(true);

		// #prompt must also remain disabled (set in the game_ended branch)
		const promptEl = getEl<HTMLInputElement>("#prompt");
		expect(promptEl.disabled).toBe(true);
	});
});
