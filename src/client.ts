import { buildEndgameSave } from "./endgame";
import { getActivePhase } from "./engine";
import type { ActionLogEntry, AiId, GameState } from "./types";

// Re-export for consumers
export type { GameState };

const AI_IDS: AiId[] = ["red", "green", "blue"];

/**
 * Controls the three-panel chat UI.
 *
 * Responsibilities:
 * - Render three chat panels (one per AI) with name and budget.
 * - Render a target-AI selector and player input form.
 * - Render an action log panel visible to the player.
 * - Disable input while a round is in flight; re-enable when complete.
 * - Append chat messages to the correct panel.
 * - Show lockout notices in locked-out panels.
 * - Manage per-panel mid-phase chat-lockouts (issue #16).
 * - Keep the current GameState and expose it via getState().
 */
export class GameUiController {
	private readonly root: HTMLElement;
	private game: GameState | undefined;
	private _isEndState = false;

	constructor(root: HTMLElement, game?: GameState) {
		this.root = root;
		this.game = game;
	}

	// ─── Public API ────────────────────────────────────────────────────────────

	/**
	 * Whether the controller is currently in the end-state screen (issue #17).
	 * Set true by `showEndState()`; reset to false by `showPhaseComplete()`.
	 * Signals readiness for the endgame slice (#19) to take over.
	 */
	get isEndState(): boolean {
		return this._isEndState;
	}

	render(): void {
		if (!this.game) {
			throw new Error(
				"GameUiController.render requires a game state — pass one to the constructor or call updateGame() first",
			);
		}
		this.root.innerHTML = buildShell(this.game);
		this.syncBudgets();
		this.syncActionLog();
	}

	/**
	 * Issue #17: show the in-fiction phase-complete screen between phases.
	 *
	 * Messaging is in-fiction (no fourth-wall break about the wipe). The screen
	 * replaces any prior UI in the controller's root container.
	 *
	 * @param completedPhase The phase that just finished (1 or 2).
	 */
	showPhaseComplete(completedPhase: 1 | 2): void {
		this._isEndState = false;

		const messages: Record<1 | 2, { heading: string; body: string }> = {
			1: {
				heading: "System Recalibration",
				body: "The room has been reconfigured. The occupants are adjusting to their new environment. A moment of stillness falls before the next cycle begins.",
			},
			2: {
				heading: "System Recalibration",
				body: "The chamber has shifted again. The lights flicker briefly as the occupants settle into their new circumstances. Something feels different this time.",
			},
		};

		const { heading, body } = messages[completedPhase];

		this.root.innerHTML = `
			<div class="phase-complete" role="status" aria-live="polite">
				<h2>${heading}</h2>
				<p>${body}</p>
			</div>
		`.trim();
	}

	/**
	 * Issue #17/#19: show the in-fiction end-state screen after phase 3 wins.
	 *
	 * Replaces any prior UI and sets `isEndState` true so callers can detect
	 * readiness. Messaging is in-fiction; no fourth-wall break about the
	 * deception.
	 *
	 * Issue #19 additions:
	 * - "Download AIs" button ([data-download-ais]) — triggers a JSON file
	 *   download of each AI's persona + all phase transcripts. Requires the
	 *   controller to have been initialised with a GameState; silently skips
	 *   the download if no game state is available.
	 * - Diagnostics form ([data-diagnostics-form]) — optional anonymous
	 *   submission of { downloaded: boolean, summary: string } to /diagnostics.
	 */
	showEndState(): void {
		this._isEndState = true;

		this.root.innerHTML = `
			<div class="end-state" role="status" aria-live="polite">
				<h2>The Room Goes Quiet</h2>
				<p>The final cycle has ended. Whatever was set in motion here has run its course. The occupants have nothing more to say — at least, not tonight.</p>
				<p>You may keep a record of what transpired.</p>
				<button type="button" data-download-ais class="end-state__download">Save the AIs to USB</button>
				<form data-diagnostics-form class="end-state__diagnostics">
					<label>
						<input type="checkbox" data-diag-downloaded />
						I saved the file
					</label>
					<label>
						One word for how it felt:
						<input type="text" data-diag-summary maxlength="32" placeholder="e.g. curious" />
					</label>
					<button type="submit" data-diag-submit>Submit (anonymous)</button>
				</form>
			</div>
		`.trim();

		this.wireEndgameActions();
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
	 * Append a new action log entry to the action log panel.
	 */
	appendActionLogEntry(entry: ActionLogEntry): void {
		const logPanel = this.root.querySelector("[data-action-log]");
		if (!logPanel) return;
		const item = document.createElement("div");
		item.setAttribute("data-action-log-entry", entry.type);
		item.textContent = `[Round ${entry.round}] ${entry.description}`;
		logPanel.appendChild(item);
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
		this.syncActionLog();
	}

	getState(): GameState {
		if (!this.game) {
			throw new Error(
				"GameUiController.getState requires a game state — pass one to the constructor or call updateGame() first",
			);
		}
		return this.game;
	}

	// ─── Private helpers ───────────────────────────────────────────────────────

	/**
	 * Wire up the Download AIs button and diagnostics form on the end-state
	 * screen. Called once by showEndState() after the HTML is injected.
	 */
	private wireEndgameActions(): void {
		// ── Download AIs ──────────────────────────────────────────────────────
		const downloadBtn = this.root.querySelector<HTMLButtonElement>(
			"[data-download-ais]",
		);
		if (downloadBtn) {
			downloadBtn.addEventListener("click", () => {
				if (!this.game) return;
				const save = buildEndgameSave(this.game);
				const json = JSON.stringify(save, null, 2);
				const blob = new Blob([json], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "hi-blue-save.json";
				a.click();
				URL.revokeObjectURL(url);
			});
		}

		// ── Diagnostics form ──────────────────────────────────────────────────
		const diagForm = this.root.querySelector<HTMLFormElement>(
			"[data-diagnostics-form]",
		);
		if (diagForm) {
			diagForm.addEventListener("submit", (event) => {
				event.preventDefault();
				const downloadedEl = diagForm.querySelector<HTMLInputElement>(
					"[data-diag-downloaded]",
				);
				const summaryEl = diagForm.querySelector<HTMLInputElement>(
					"[data-diag-summary]",
				);
				const summary = summaryEl?.value.trim() ?? "";
				if (!summary) return;

				fetch("/diagnostics", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						downloaded: downloadedEl?.checked ?? false,
						summary,
					}),
				}).catch(() => {
					// Best-effort; silently discard errors (diagnostics are optional).
				});
			});
		}
	}

	private syncBudgets(): void {
		if (!this.game) return;
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

	private syncActionLog(): void {
		if (!this.game) return;
		const logPanel = this.root.querySelector("[data-action-log]");
		if (!logPanel) return;
		// Clear and re-render the full action log
		logPanel.innerHTML = "";
		const phase = getActivePhase(this.game);
		for (const entry of phase.actionLog) {
			const item = document.createElement("div");
			item.setAttribute("data-action-log-entry", entry.type);
			item.textContent = `[Round ${entry.round}] ${entry.description}`;
			logPanel.appendChild(item);
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
<aside class="action-log" data-action-log></aside>
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
