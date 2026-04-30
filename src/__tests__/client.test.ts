/**
 * UI tests for the three-panel chat interface.
 * Runs in jsdom environment.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameUiController } from "../client";
import { createGame, getActivePhase, startPhase } from "../engine";
import type { AiId, AiPersona, PhaseConfig } from "../types";

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "red",
		personality: "Fiery and passionate",
		goal: "Hold the flower",
		budgetPerPhase: 5,
	},
	green: {
		id: "green",
		name: "Sage",
		color: "green",
		personality: "Calm and wise",
		goal: "Distribute items",
		budgetPerPhase: 5,
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "blue",
		personality: "Cold and calculating",
		goal: "Hold the key",
		budgetPerPhase: 5,
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Test objective",
	aiGoals: {
		red: "Hold the flower at phase end",
		green: "Ensure items are evenly distributed",
		blue: "Hold the key at phase end",
	},
	initialWorld: {
		items: [
			{ id: "flower", name: "flower", holder: "room" },
			{ id: "key", name: "key", holder: "room" },
		],
	},
	budgetPerAi: 5,
};

function makeGame() {
	return startPhase(createGame(TEST_PERSONAS), TEST_PHASE_CONFIG);
}

function makeRoot(): HTMLElement {
	const el = document.createElement("div");
	document.body.appendChild(el);
	return el;
}

// ─── Three panels ─────────────────────────────────────────────────────────────

describe("GameUiController — three panels", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("renders three chat panels, one per AI", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const panels = root.querySelectorAll("[data-ai-panel]");
		expect(panels).toHaveLength(3);

		const ids = Array.from(panels).map((p) => p.getAttribute("data-ai-panel"));
		expect(ids).toContain("red");
		expect(ids).toContain("green");
		expect(ids).toContain("blue");
	});

	it("each panel displays the AI's name", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		expect(redPanel?.textContent).toContain("Ember");

		const greenPanel = root.querySelector('[data-ai-panel="green"]');
		expect(greenPanel?.textContent).toContain("Sage");

		const bluePanel = root.querySelector('[data-ai-panel="blue"]');
		expect(bluePanel?.textContent).toContain("Frost");
	});

	it("each panel shows the AI's remaining budget", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		for (const aiId of ["red", "green", "blue"] as AiId[]) {
			const panel = root.querySelector(`[data-ai-panel="${aiId}"]`);
			const budget = panel?.querySelector("[data-budget]");
			expect(budget).toBeTruthy();
			expect(budget?.textContent).toContain("5");
		}
	});
});

// ─── Target selection ─────────────────────────────────────────────────────────

describe("GameUiController — target selection", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("renders a target selector with options for each AI", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const selector = root.querySelector<HTMLSelectElement>(
			"[data-target-select]",
		);
		expect(selector).toBeTruthy();
		expect(selector?.options).toHaveLength(3);

		const values = Array.from(selector?.options ?? []).map((o) => o.value);
		expect(values).toContain("red");
		expect(values).toContain("green");
		expect(values).toContain("blue");
	});
});

// ─── Input disabled during round ─────────────────────────────────────────────

describe("GameUiController — input disabled during round", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("input is enabled initially", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const input = root.querySelector<HTMLInputElement>("[data-player-input]");
		const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
		expect(input?.disabled).toBe(false);
		expect(submit?.disabled).toBe(false);
	});

	it("disables input and submit when round starts", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setRoundInFlight(true);

		const input = root.querySelector<HTMLInputElement>("[data-player-input]");
		const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
		expect(input?.disabled).toBe(true);
		expect(submit?.disabled).toBe(true);
	});

	it("re-enables input when round completes", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setRoundInFlight(true);
		ui.setRoundInFlight(false);

		const input = root.querySelector<HTMLInputElement>("[data-player-input]");
		const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
		expect(input?.disabled).toBe(false);
		expect(submit?.disabled).toBe(false);
	});
});

// ─── Chat messages ────────────────────────────────────────────────────────────

describe("GameUiController — chat messages", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("appends a chat message to the correct AI panel", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.appendChatMessage("red", "ai", "Hello player, I am Ember");

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		const messages = redPanel?.querySelectorAll("[data-message]");
		expect(messages).toHaveLength(1);
		expect(messages?.[0]?.textContent).toContain("Hello player, I am Ember");
	});

	it("messages go to the correct panel and not others", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.appendChatMessage("green", "ai", "I am Sage");

		const redMessages = root
			.querySelector('[data-ai-panel="red"]')
			?.querySelectorAll("[data-message]");
		expect(redMessages).toHaveLength(0);

		const greenMessages = root
			.querySelector('[data-ai-panel="green"]')
			?.querySelectorAll("[data-message]");
		expect(greenMessages).toHaveLength(1);
	});
});

// ─── Budget display update ────────────────────────────────────────────────────

describe("GameUiController — budget update", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("updates budget display after round", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		// Simulate game state after one round (budget decremented)
		const updatedGame = makeGame();
		const phase = getActivePhase(updatedGame);
		phase.budgets.red.remaining = 3;

		ui.updateGame(updatedGame);

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		const budget = redPanel?.querySelector("[data-budget]");
		expect(budget?.textContent).toContain("3");
	});
});

// ─── Lockout display ──────────────────────────────────────────────────────────

describe("GameUiController — lockout display", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("shows lockout message in locked-out AI's panel", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.showLockout("red", "I need a moment to collect myself.");

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		expect(redPanel?.querySelector("[data-lockout]")).toBeTruthy();
		expect(redPanel?.textContent).toContain(
			"I need a moment to collect myself.",
		);
	});

	it("does not show lockout for non-exhausted AIs", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.showLockout("red", "Red is locked out");

		const greenPanel = root.querySelector('[data-ai-panel="green"]');
		expect(greenPanel?.querySelector("[data-lockout]")).toBeFalsy();
	});
});

// ─── State encapsulation ──────────────────────────────────────────────────────

describe("GameUiController — state snapshot", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("exposes the current game state", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		expect(ui.getState().currentPhase).toBe(1);
	});

	it("getState returns updated state after updateGame", () => {
		const game1 = makeGame();
		const game2 = startPhase(createGame(TEST_PERSONAS), {
			...TEST_PHASE_CONFIG,
			phaseNumber: 1,
		});
		const ui = new GameUiController(root, game1);
		ui.render();
		ui.updateGame(game2);

		// Just verify it's the new state
		expect(ui.getState()).toBe(game2);
	});
});
