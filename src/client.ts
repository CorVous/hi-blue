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

	/**
	 * Surface a cap-hit (HTTP 429) sleeping-AIs banner.
	 * If `aiId` is given, the banner is rendered in that panel only;
	 * otherwise it's rendered in every panel (global rate-limit case).
	 *
	 * This is the GameUiController-shaped equivalent of the cap-hit handling
	 * introduced in issue #14 for the legacy single-panel client. It will be
	 * wired up once the controller talks to the proxy directly.
	 */
	showCapHit(message: string, aiId?: AiId): void {
		const targets: AiId[] = aiId ? [aiId] : AI_IDS;
		for (const id of targets) {
			const panel = this.root.querySelector(`[data-ai-panel="${id}"]`);
			if (!panel) continue;
			const banner = document.createElement("div");
			banner.setAttribute("data-cap-hit", "true");
			banner.textContent = message;
			panel.appendChild(banner);
		}
	}

	/**
	 * Enables a mid-phase chat-lockout for a single AI's panel.
	 *
	 * Distinct from budget-exhaustion lockout (setRoundInFlight / showLockout):
	 * - Only disables the per-panel chat input for the locked AI.
	 * - Does NOT disable the global submit button (that is round-in-flight
	 *   semantics from #13).
	 * - Shows a personality-consistent in-character banner inside the panel.
	 *
	 * Resolves by calling clearChatLockout(aiId).
	 */
	setChatLockout(aiId: AiId, message: string): void {
		const panel = this.root.querySelector(`[data-ai-panel="${aiId}"]`);
		if (!panel) return;

		// Disable the per-panel chat input
		const input = panel.querySelector<HTMLInputElement>(
			"[data-panel-chat-input]",
		);
		if (input) input.disabled = true;

		// Remove any previous banner before adding a new one
		panel.querySelector("[data-chat-lockout]")?.remove();

		// Show in-character lockout banner
		const banner = document.createElement("div");
		banner.setAttribute("data-chat-lockout", "true");
		banner.textContent = message;
		panel.appendChild(banner);
	}

	/**
	 * Resolves a chat-lockout for the given AI's panel.
	 * Re-enables the per-panel chat input and removes the lockout banner.
	 */
	clearChatLockout(aiId: AiId): void {
		const panel = this.root.querySelector(`[data-ai-panel="${aiId}"]`);
		if (!panel) return;

		// Re-enable the per-panel chat input
		const input = panel.querySelector<HTMLInputElement>(
			"[data-panel-chat-input]",
		);
		if (input) input.disabled = false;

		// Remove lockout banner
		panel.querySelector("[data-chat-lockout]")?.remove();
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
  <input type="text" data-panel-chat-input class="chat-panel__input" placeholder="Message ${persona.name}…" />
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

// ─── Legacy single-panel streaming chat client ───────────────────────────────
//
// `mountChatPanel` predates the three-panel UI introduced in issue #13. It
// remains in the codebase because it embeds the SSE / cap-hit handling added
// in issue #14, which the new GameUiController has not yet been wired up to
// (the coordinator in #13 is currently a TS-side construct exercised by tests
// rather than a live proxy client). Keeping this code lets us:
//   - retain the proven cap-hit (HTTP 429 + `event: cap-hit`) handling
//   - keep the #14 client tests green
//   - lift this logic into GameUiController in a follow-up
// Once GameUiController owns the proxy connection, this function and its
// tests should be removed.

/**
 * Vanilla-JS streaming chat client.
 * mountChatPanel attaches a message form and streamed output area to the given container.
 * Submitting the form POSTs to /chat and streams SSE tokens token-by-token into the output area.
 */
export function mountChatPanel(container: HTMLElement): void {
	container.innerHTML = `
		<form id="chat-form">
			<input type="text" name="message" autocomplete="off" placeholder="Type a message…" />
			<button type="submit">Send</button>
		</form>
		<div data-output></div>
	`;

	const form = container.querySelector("form") as HTMLFormElement;
	const input = container.querySelector("input[type=text]") as HTMLInputElement;
	const output = container.querySelector("[data-output]") as HTMLElement;

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const message = input.value.trim();
		if (!message) return;
		input.value = "";
		output.textContent = "";
		streamResponse(message, output);
	});
}

async function streamResponse(
	message: string,
	output: HTMLElement,
): Promise<void> {
	const response = await fetch("/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message }),
	});

	if (!response.body) return;

	// HTTP 429 means a rate or daily-cap limit was hit.
	// The body is still a valid SSE stream with a `cap-hit` event containing
	// the in-character "AIs are sleeping" message — render it as-is.
	const isCapHit = response.status === 429;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let currentEvent = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		// Process complete SSE events (lines ending with \n\n)
		const parts = buffer.split("\n\n");
		// The last element may be incomplete; keep it in the buffer
		buffer = parts.pop() ?? "";

		for (const part of parts) {
			currentEvent = "";
			for (const line of part.split("\n")) {
				if (line.startsWith("event: ")) {
					currentEvent = line.slice("event: ".length).trim();
				} else if (line.startsWith("data: ")) {
					const token = line.slice("data: ".length);
					if (token === "[DONE]") return;

					if (currentEvent === "cap-hit" || isCapHit) {
						// Render the in-character sleeping message with a distinct style
						output.textContent = token;
						output.setAttribute("data-cap-hit", "true");
						return;
					}

					output.textContent = (output.textContent ?? "") + token;
				}
			}
		}
	}
}
