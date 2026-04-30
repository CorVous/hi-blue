/**
 * UI tests for the chat client.
 * - GameUiController (issue #13): three-panel UI controller.
 * - Action log panel (issue #15): action log rendered as a UI panel.
 * - Mid-phase chat-lockout (issue #16): per-panel chat input gating.
 * - mountChatPanel (issue #14): legacy single-panel streaming chat client
 *   with cap-hit (HTTP 429 / `event: cap-hit`) handling.
 *
 * Both surfaces currently coexist; mountChatPanel will be removed once
 * GameUiController is wired to the proxy and absorbs the cap-hit handling.
 *
 * Runs in jsdom environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameUiController, mountChatPanel } from "../client";
import {
	appendActionLog,
	createGame,
	getActivePhase,
	startPhase,
} from "../engine";
import type { ActionLogEntry, AiId, AiPersona, PhaseConfig } from "../types";

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

// ─── Cap-hit banner ───────────────────────────────────────────────────────────

describe("GameUiController — cap-hit banner", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("shows a cap-hit banner in the addressed AI's panel", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.showCapHit("The AIs are resting.", "red");

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		expect(redPanel?.querySelector("[data-cap-hit]")).toBeTruthy();
		expect(redPanel?.textContent).toContain("The AIs are resting.");

		const greenPanel = root.querySelector('[data-ai-panel="green"]');
		expect(greenPanel?.querySelector("[data-cap-hit]")).toBeFalsy();
	});

	it("shows the banner in all panels when no AI is specified", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.showCapHit("AIs are sleeping.");

		for (const aiId of ["red", "green", "blue"] as AiId[]) {
			const panel = root.querySelector(`[data-ai-panel="${aiId}"]`);
			expect(panel?.querySelector("[data-cap-hit]")).toBeTruthy();
		}
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

// ─── Action log panel (issue #15) ────────────────────────────────────────────

describe("GameUiController — action log panel", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("renders an action log region after render()", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const logPanel = root.querySelector("[data-action-log]");
		expect(logPanel).toBeTruthy();
	});

	it("action log is empty when there are no log entries", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const logPanel = root.querySelector("[data-action-log]");
		const entries = logPanel?.querySelectorAll("[data-action-log-entry]");
		expect(entries).toHaveLength(0);
	});

	it("renders existing action log entries on render()", () => {
		let game = makeGame();
		const entry: ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "flower" },
			description: "Ember picked up the flower",
		};
		game = appendActionLog(game, entry);

		const ui = new GameUiController(root, game);
		ui.render();

		const logPanel = root.querySelector("[data-action-log]");
		const entries = logPanel?.querySelectorAll("[data-action-log-entry]");
		expect(entries).toHaveLength(1);
		expect(entries?.[0]?.textContent).toContain("Ember picked up the flower");
	});

	it("renders tool_success entries with their type attribute", () => {
		let game = makeGame();
		const entry: ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "flower" },
			description: "Ember picked up the flower",
		};
		game = appendActionLog(game, entry);

		const ui = new GameUiController(root, game);
		ui.render();

		const logPanel = root.querySelector("[data-action-log]");
		const successEntry = logPanel?.querySelector(
			'[data-action-log-entry="tool_success"]',
		);
		expect(successEntry).toBeTruthy();
	});

	it("renders tool_failure entries with their type attribute", () => {
		let game = makeGame();
		const entry: ActionLogEntry = {
			round: 1,
			actor: "blue",
			type: "tool_failure",
			toolName: "pick_up",
			args: { item: "nonexistent" },
			reason: 'Item "nonexistent" does not exist',
			description:
				'Frost tried to pick_up nonexistent but failed: Item "nonexistent" does not exist',
		};
		game = appendActionLog(game, entry);

		const ui = new GameUiController(root, game);
		ui.render();

		const logPanel = root.querySelector("[data-action-log]");
		const failureEntry = logPanel?.querySelector(
			'[data-action-log-entry="tool_failure"]',
		);
		expect(failureEntry).toBeTruthy();
		expect(failureEntry?.textContent).toContain("Frost");
	});

	it("appendActionLogEntry adds a new entry to the log panel", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		const entry: ActionLogEntry = {
			round: 2,
			actor: "green",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "key" },
			description: "Sage picked up the key",
		};
		ui.appendActionLogEntry(entry);

		const logPanel = root.querySelector("[data-action-log]");
		const entries = logPanel?.querySelectorAll("[data-action-log-entry]");
		expect(entries).toHaveLength(1);
		expect(entries?.[0]?.textContent).toContain("Sage picked up the key");
	});

	it("updateGame refreshes action log with all entries in order", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		// Add two entries to the game state
		let updatedGame = makeGame();
		const entry1: ActionLogEntry = {
			round: 1,
			actor: "red",
			type: "tool_success",
			toolName: "pick_up",
			args: { item: "flower" },
			description: "Ember picked up the flower",
		};
		const entry2: ActionLogEntry = {
			round: 1,
			actor: "blue",
			type: "tool_failure",
			toolName: "pick_up",
			args: { item: "ghost" },
			reason: "Item not found",
			description: "Frost tried to pick_up ghost but failed: Item not found",
		};
		updatedGame = appendActionLog(updatedGame, entry1);
		updatedGame = appendActionLog(updatedGame, entry2);

		ui.updateGame(updatedGame);

		const logPanel = root.querySelector("[data-action-log]");
		const entries = logPanel?.querySelectorAll("[data-action-log-entry]");
		expect(entries).toHaveLength(2);
		expect(entries?.[0]?.textContent).toContain("Ember picked up the flower");
		expect(entries?.[1]?.textContent).toContain("Frost tried to pick_up ghost");
	});

	it("action log entries show the round number", () => {
		let game = makeGame();
		const entry: ActionLogEntry = {
			round: 3,
			actor: "red",
			type: "pass",
			description: "Ember passed",
		};
		game = appendActionLog(game, entry);

		const ui = new GameUiController(root, game);
		ui.render();

		const logPanel = root.querySelector("[data-action-log]");
		const logEntry = logPanel?.querySelector("[data-action-log-entry]");
		expect(logEntry?.textContent).toContain("Round 3");
	});
});

// ─── Legacy single-panel chat (preserved for cap-hit / SSE handling) ─────────

describe("mountChatPanel (legacy single-panel client)", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.removeChild(container);
		vi.restoreAllMocks();
	});

	it("renders a message form and a streamed output area", () => {
		mountChatPanel(container);

		const form = container.querySelector("form");
		const input = container.querySelector("input[type=text]");
		const button = container.querySelector("button[type=submit]");
		const output = container.querySelector("[data-output]");

		expect(form).not.toBeNull();
		expect(input).not.toBeNull();
		expect(button).not.toBeNull();
		expect(output).not.toBeNull();
	});

	it("streams tokens into the output area when a message is submitted", async () => {
		// Stub fetch to return a canned SSE stream
		const sseBody = "data: Hello\n\ndata:  world\n\ndata: [DONE]\n\n";
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseBody));
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(stream, {
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		mountChatPanel(container);

		const input = container.querySelector(
			"input[type=text]",
		) as HTMLInputElement;
		const form = container.querySelector("form") as HTMLFormElement;

		input.value = "ping";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Wait for the async streaming to settle
		await new Promise((resolve) => setTimeout(resolve, 50));

		const output = container.querySelector("[data-output]") as HTMLElement;
		expect(output.textContent).toContain("Hello");
		expect(output.textContent).toContain(" world");
		expect(output.textContent).not.toContain("[DONE]");
	});

	it("POSTs the message to /chat as JSON", async () => {
		const sseBody = "data: [DONE]\n\n";
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseBody));
				controller.close();
			},
		});

		const fetchMock = vi.fn().mockResolvedValue(
			new Response(stream, {
				headers: { "Content-Type": "text/event-stream" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		mountChatPanel(container);

		const input = container.querySelector(
			"input[type=text]",
		) as HTMLInputElement;
		const form = container.querySelector("form") as HTMLFormElement;

		input.value = "hello there";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(fetchMock).toHaveBeenCalledWith(
			"/chat",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({ message: "hello there" }),
			}),
		);
	});

	it("renders in-character sleeping message when the server returns 429", async () => {
		const sleepingMessage =
			"The AIs are resting right now. They need a moment to recover their thoughts. Please come back a little later.";
		// Simulate the cap-hit SSE event with HTTP 429
		const sseBody = `event: cap-hit\ndata: ${sleepingMessage}\n\n`;
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseBody));
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(stream, {
					status: 429,
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		mountChatPanel(container);

		const input = container.querySelector(
			"input[type=text]",
		) as HTMLInputElement;
		const form = container.querySelector("form") as HTMLFormElement;

		input.value = "hello";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		const output = container.querySelector("[data-output]") as HTMLElement;
		// The in-character message should be displayed
		expect(output.textContent).toContain("resting");
		// And the cap-hit data attribute should be set for CSS targeting
		expect(output.getAttribute("data-cap-hit")).toBe("true");
	});

	it("does not crash the chat panel when 429 is received", async () => {
		const sseBody = "event: cap-hit\ndata: AIs are sleeping.\n\n";
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(sseBody));
				controller.close();
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(stream, {
					status: 429,
					headers: { "Content-Type": "text/event-stream" },
				}),
			),
		);

		mountChatPanel(container);

		const input = container.querySelector(
			"input[type=text]",
		) as HTMLInputElement;
		const form = container.querySelector("form") as HTMLFormElement;

		input.value = "ping";
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await new Promise((resolve) => setTimeout(resolve, 50));

		// Panel must still be intact (form and input still present)
		expect(container.querySelector("form")).not.toBeNull();
		expect(container.querySelector("input[type=text]")).not.toBeNull();
	});
});

// ─── Mid-phase chat-lockout UI (issue #16) ────────────────────────────────────
//
// setChatLockout(aiId, message) disables the player→AI chat INPUT for the
// locked AI's panel only. It does NOT disable the global submit button (that
// is the round-in-flight semantics from #13 — a separate concern).
//
// clearChatLockout(aiId) re-enables the locked panel's input.

describe("GameUiController — chat-lockout UI (#16)", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = makeRoot();
	});

	afterEach(() => {
		document.body.removeChild(root);
	});

	it("setChatLockout disables only the locked AI panel's chat input", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setChatLockout(
			"red",
			"Something has come up. I can't speak with you right now.",
		);

		// Red's panel input is disabled
		const redPanel = root.querySelector('[data-ai-panel="red"]');
		const redInput = redPanel?.querySelector<HTMLInputElement>(
			"[data-panel-chat-input]",
		);
		expect(redInput?.disabled).toBe(true);

		// Other panels' inputs are NOT affected
		const greenPanel = root.querySelector('[data-ai-panel="green"]');
		const greenInput = greenPanel?.querySelector<HTMLInputElement>(
			"[data-panel-chat-input]",
		);
		expect(greenInput?.disabled).toBe(false);

		const bluePanel = root.querySelector('[data-ai-panel="blue"]');
		const blueInput = bluePanel?.querySelector<HTMLInputElement>(
			"[data-panel-chat-input]",
		);
		expect(blueInput?.disabled).toBe(false);
	});

	it("setChatLockout does NOT disable the global submit button", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setChatLockout("red", "I can't talk now.");

		const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
		expect(submit?.disabled).toBe(false);
	});

	it("setChatLockout shows an in-character lockout banner in the locked panel", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setChatLockout(
			"green",
			"I must withdraw from this conversation for a while.",
		);

		const greenPanel = root.querySelector('[data-ai-panel="green"]');
		const banner = greenPanel?.querySelector("[data-chat-lockout]");
		expect(banner).toBeTruthy();
		expect(banner?.textContent).toContain(
			"I must withdraw from this conversation for a while.",
		);
	});

	it("setChatLockout banner does not appear in other panels", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setChatLockout("blue", "Our channel is temporarily unavailable.");

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		expect(redPanel?.querySelector("[data-chat-lockout]")).toBeFalsy();

		const greenPanel = root.querySelector('[data-ai-panel="green"]');
		expect(greenPanel?.querySelector("[data-chat-lockout]")).toBeFalsy();
	});

	it("clearChatLockout re-enables the locked panel's chat input", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setChatLockout("red", "Can't talk.");
		ui.clearChatLockout("red");

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		const redInput = redPanel?.querySelector<HTMLInputElement>(
			"[data-panel-chat-input]",
		);
		expect(redInput?.disabled).toBe(false);
	});

	it("clearChatLockout removes the lockout banner from the panel", () => {
		const game = makeGame();
		const ui = new GameUiController(root, game);
		ui.render();

		ui.setChatLockout("red", "Can't talk right now.");
		ui.clearChatLockout("red");

		const redPanel = root.querySelector('[data-ai-panel="red"]');
		expect(redPanel?.querySelector("[data-chat-lockout]")).toBeFalsy();
	});
});
