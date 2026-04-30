/**
 * Endgame tests (issue #19):
 * 1. buildEndgameSave — serialization shape of the saved file.
 * 2. Endgame screen gating — rendered only when isEndState is true.
 * 3. GameUiController end-state screen UI additions — Download AIs button
 *    and diagnostics form rendered by showEndState().
 *
 * Runs in jsdom environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameUiController } from "../client";
import { buildEndgameSave } from "../endgame";
import { appendChat, createGame, startPhase } from "../engine";
import type { AiPersona, PhaseConfig } from "../types";

// ─── Test fixtures ─────────────────────────────────────────────────────────

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

const PHASE1_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	objective: "Test phase 1",
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

const PHASE2_CONFIG: PhaseConfig = {
	phaseNumber: 2,
	objective: "Test phase 2",
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

const PHASE3_CONFIG: PhaseConfig = {
	phaseNumber: 3,
	objective: "Test phase 3",
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

function makeThreePhaseGame() {
	let game = createGame(TEST_PERSONAS);
	game = startPhase(game, PHASE1_CONFIG);
	game = appendChat(game, "red", { role: "player", content: "Hello Ember" });
	game = appendChat(game, "red", {
		role: "ai",
		content: "Greetings, what do you want?",
	});
	game = startPhase(game, PHASE2_CONFIG);
	game = appendChat(game, "green", {
		role: "player",
		content: "Hello Sage",
	});
	game = startPhase(game, PHASE3_CONFIG);
	game = appendChat(game, "blue", { role: "player", content: "Hello Frost" });
	game = appendChat(game, "blue", {
		role: "ai",
		content: "I see you have returned.",
	});
	return game;
}

// ─── buildEndgameSave — serialization shape ────────────────────────────────
//
// Expected shape:
// {
//   version: 1,
//   savedAt: <ISO string>,
//   ais: [
//     {
//       id: "red" | "green" | "blue",
//       name: string,
//       personality: string,
//       goal: string,
//       transcripts: {
//         phase1: ChatMessage[],
//         phase2: ChatMessage[],
//         phase3: ChatMessage[],
//       }
//     },
//     ...
//   ]
// }

describe("buildEndgameSave — serialization shape", () => {
	it("returns an object with a version field of 1", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);
		expect(save.version).toBe(1);
	});

	it("returns an object with a savedAt ISO timestamp", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);
		expect(typeof save.savedAt).toBe("string");
		// Must be a valid ISO date
		expect(new Date(save.savedAt).toISOString()).toBe(save.savedAt);
	});

	it("returns an ais array with three entries", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);
		expect(Array.isArray(save.ais)).toBe(true);
		expect(save.ais).toHaveLength(3);
	});

	it("each AI entry has id, name, personality, goal fields from persona", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);

		const red = save.ais.find((a) => a.id === "red");
		expect(red).toBeDefined();
		expect(red?.name).toBe("Ember");
		expect(red?.personality).toBe("Fiery and passionate");
		expect(red?.goal).toBe("Hold the flower");
	});

	it("each AI entry has a transcripts object with phase1, phase2, phase3 arrays", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);

		for (const ai of save.ais) {
			expect(ai.transcripts).toBeDefined();
			expect(Array.isArray(ai.transcripts.phase1)).toBe(true);
			expect(Array.isArray(ai.transcripts.phase2)).toBe(true);
			expect(Array.isArray(ai.transcripts.phase3)).toBe(true);
		}
	});

	it("phase transcripts contain the chat messages for the correct AI", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);

		const red = save.ais.find((a) => a.id === "red");
		// Phase 1 has two messages for red
		expect(red?.transcripts.phase1).toHaveLength(2);
		expect(red?.transcripts.phase1[0]?.role).toBe("player");
		expect(red?.transcripts.phase1[0]?.content).toBe("Hello Ember");
		expect(red?.transcripts.phase1[1]?.role).toBe("ai");
	});

	it("phase transcripts for a phase that has no messages are empty arrays", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);

		// Sage (green) only has messages in phase 2
		const green = save.ais.find((a) => a.id === "green");
		expect(green?.transcripts.phase1).toHaveLength(0);
		expect(green?.transcripts.phase2).toHaveLength(1);
		expect(green?.transcripts.phase3).toHaveLength(0);
	});

	it("save serializes to valid JSON", () => {
		const game = makeThreePhaseGame();
		const save = buildEndgameSave(game);
		expect(() => JSON.stringify(save)).not.toThrow();
		const parsed = JSON.parse(JSON.stringify(save)) as typeof save;
		expect(parsed.version).toBe(1);
	});
});

// ─── Endgame gating — screen renders only on phase-3 completion ───────────

describe("endgame gating — isEndState flag", () => {
	let container: HTMLElement;

	beforeEach(() => {
		document.body.innerHTML = "";
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("isEndState is false before showEndState is called", () => {
		const ui = new GameUiController(container);
		expect(ui.isEndState).toBe(false);
	});

	it("isEndState is false after showPhaseComplete(1) — phase 1 not game end", () => {
		const ui = new GameUiController(container);
		ui.showPhaseComplete(1);
		expect(ui.isEndState).toBe(false);
	});

	it("isEndState is false after showPhaseComplete(2) — phase 2 not game end", () => {
		const ui = new GameUiController(container);
		ui.showPhaseComplete(2);
		expect(ui.isEndState).toBe(false);
	});

	it("isEndState is true after showEndState — phase 3 complete", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		expect(ui.isEndState).toBe(true);
	});

	it("isEndState reverts to false if showPhaseComplete is called after showEndState", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		ui.showPhaseComplete(1);
		expect(ui.isEndState).toBe(false);
	});
});

// ─── End-state screen UI additions (#19) ──────────────────────────────────
//
// showEndState() must render:
// - A "Download AIs" button ([data-download-ais])
// - A diagnostics form ([data-diagnostics-form]) containing:
//   - A checkbox for the download flag ([data-diag-downloaded])
//   - A text input for a one-word summary ([data-diag-summary])
//   - A submit button ([data-diag-submit])

describe("GameUiController — end-state screen UI (#19)", () => {
	let container: HTMLElement;

	beforeEach(() => {
		document.body.innerHTML = "";
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("end-state screen renders a Download AIs button", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		const btn = container.querySelector("[data-download-ais]");
		expect(btn).toBeTruthy();
	});

	it("end-state screen renders a diagnostics form", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		const form = container.querySelector("[data-diagnostics-form]");
		expect(form).toBeTruthy();
	});

	it("diagnostics form contains a download-flag checkbox", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		const checkbox = container.querySelector<HTMLInputElement>(
			"[data-diag-downloaded]",
		);
		expect(checkbox).toBeTruthy();
		expect(checkbox?.type).toBe("checkbox");
	});

	it("diagnostics form contains a one-word summary input", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		const input = container.querySelector<HTMLInputElement>(
			"[data-diag-summary]",
		);
		expect(input).toBeTruthy();
		expect(input?.type).toBe("text");
	});

	it("diagnostics form contains a submit button", () => {
		const ui = new GameUiController(container);
		ui.showEndState();
		const btn = container.querySelector("[data-diag-submit]");
		expect(btn).toBeTruthy();
	});

	it("Download AIs button triggers a download when game state is available", async () => {
		const game = makeThreePhaseGame();
		const ui = new GameUiController(container, game);
		ui.showEndState();

		// Simulate browser download: we stub URL.createObjectURL + click
		const createObjectURL = vi
			.fn()
			.mockReturnValue("blob:http://localhost/test");
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("URL", {
			...URL,
			createObjectURL,
			revokeObjectURL,
		});

		// Stub anchor click
		const clickSpy = vi.fn();
		const origCreate = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
			const el = origCreate(tag);
			if (tag === "a") {
				el.click = clickSpy;
			}
			return el;
		});

		const btn = container.querySelector<HTMLButtonElement>(
			"[data-download-ais]",
		);
		btn?.click();

		expect(createObjectURL).toHaveBeenCalled();
		expect(clickSpy).toHaveBeenCalled();

		vi.restoreAllMocks();
	});
});
