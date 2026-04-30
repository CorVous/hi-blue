import { getActivePhase } from "./engine";
import type { AiId, GameState } from "./types";

// Re-export for consumers
export type { GameState };

const AI_IDS: AiId[] = ["red", "green", "blue"];

/**
 * Controls the three-panel chat UI.
 *
 * Responsibilities:
 * - Render three chat panels (one per AI) with name and budget.
 * - Render a target-AI selector and player input form.
 * - Disable input while a round is in flight; re-enable when complete.
 * - Append chat messages to the correct panel.
 * - Show lockout notices in locked-out panels.
 * - Keep the current GameState and expose it via getState().
 */
export class GameUiController {
	private readonly root: HTMLElement;
	private game: GameState;

	constructor(root: HTMLElement, game: GameState) {
		this.root = root;
		this.game = game;
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	render(): void {
		this.root.innerHTML = buildShell(this.game);
		this.syncBudgets();
	}

	setRoundInFlight(inFlight: boolean): void {
		const input = this.root.querySelector<HTMLInputElement>(
			"[data-player-input]",
		);
		const submit = this.root.querySelector<HTMLButtonElement>("[data-submit]");
		if (input) input.disabled = inFlight;
		if (submit) submit.disabled = inFlight;
	}

	appendChatMessage(aiId: AiId, role: "player" | "ai", content: string): void {
		const panel = this.root.querySelector(`[data-ai-panel="${aiId}"]`);
		if (!panel) return;
		const log = panel.querySelector("[data-chat-log]");
		if (!log) return;
		const msg = document.createElement("div");
		msg.setAttribute("data-message", role);
		msg.textContent = content;
		log.appendChild(msg);
	}

	showLockout(aiId: AiId, message: string): void {
		const panel = this.root.querySelector(`[data-ai-panel="${aiId}"]`);
		if (!panel) return;
		const lockout = document.createElement("div");
		lockout.setAttribute("data-lockout", "true");
		lockout.textContent = message;
		panel.appendChild(lockout);
	}

	updateGame(game: GameState): void {
		this.game = game;
		this.syncBudgets();
	}

	getState(): GameState {
		return this.game;
	}

	// ─── Private helpers ───────────────────────────────────────────────────────

	private syncBudgets(): void {
		const phase = getActivePhase(this.game);
		for (const aiId of AI_IDS) {
			const panel = this.root.querySelector(`[data-ai-panel="${aiId}"]`);
			if (!panel) continue;
			const budgetEl = panel.querySelector("[data-budget]");
			if (budgetEl) {
				budgetEl.textContent = String(phase.budgets[aiId].remaining);
			}
		}
	}
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildShell(game: GameState): string {
	const phase = getActivePhase(game);

	const panelsHtml = AI_IDS.map((aiId) => {
		const persona = game.personas[aiId];
		const budget = phase.budgets[aiId];
		return `
<section data-ai-panel="${aiId}" class="chat-panel chat-panel--${aiId}">
  <header class="chat-panel__header">
    <span class="chat-panel__name">${persona.name}</span>
    <span class="chat-panel__budget">Budget: <span data-budget>${budget.remaining}</span>/${budget.total}</span>
  </header>
  <div class="chat-panel__log" data-chat-log></div>
</section>`;
	}).join("\n");

	const selectorOptions = AI_IDS.map(
		(aiId) => `<option value="${aiId}">${game.personas[aiId].name}</option>`,
	).join("");

	return `
<div class="game-panels">
${panelsHtml}
</div>
<form class="player-form" data-player-form>
  <select data-target-select>
    ${selectorOptions}
  </select>
  <input type="text" data-player-input placeholder="Say something…" />
  <button type="submit" data-submit>Send</button>
</form>
`;
}
