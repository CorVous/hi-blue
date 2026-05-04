import { PERSONAS, PHASE_1_CONFIG } from "../../content";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { getActivePhase } from "../game/engine.js";
import { GameSession } from "../game/game-session.js";
import { encodeRoundResult } from "../game/round-result-encoder.js";
import type { AiId } from "../game/types";
import { AI_TYPING_SPEED, TOKEN_PACE_MS } from "../game/typing-rhythm.js";
import { CapHitError } from "../llm-client.js";

const AI_ORDER: AiId[] = ["red", "green", "blue"];

/** Fisher-Yates shuffle (returns a new array). */
function shuffle<T>(arr: T[]): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = out[i] as T;
		out[i] = out[j] as T;
		out[j] = tmp;
	}
	return out;
}

let session: GameSession | null = null;

export function renderGame(root: HTMLElement, params?: URLSearchParams): void {
	const doc = root.ownerDocument;
	const form = doc.querySelector<HTMLFormElement>("#composer");
	const promptInput = doc.querySelector<HTMLInputElement>("#prompt");
	const sendBtn = doc.querySelector<HTMLButtonElement>("#send");
	const addressSelect = doc.querySelector<HTMLSelectElement>("#address");
	const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
	const actionLogEl = doc.querySelector<HTMLElement>("#action-log");
	const actionLogList = doc.querySelector<HTMLUListElement>("#action-log-list");

	if (!form || !promptInput || !sendBtn || !addressSelect) return;

	// Lazy-init session
	if (!session) {
		session = new GameSession(PHASE_1_CONFIG, PERSONAS);
	}

	// Populate panel headers from PERSONAS so renames don't require HTML edits
	for (const aiId of AI_ORDER) {
		const panel = doc.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		if (!panel) continue;
		const nameEl = panel.querySelector<HTMLSpanElement>(".panel-name");
		const budgetEl = panel.querySelector<HTMLSpanElement>(".panel-budget");
		const persona = PERSONAS[aiId];
		if (nameEl) nameEl.textContent = persona.name;
		const phase = getActivePhase(session.getState());
		if (budgetEl) {
			const budget = phase.budgets[aiId];
			budgetEl.dataset.budget = String(budget.remaining);
			budgetEl.textContent = `${budget.remaining}/${budget.total}`;
		}
	}

	// Debug toggle: show action log if ?debug=1
	const debug = params?.get("debug") === "1";
	if (actionLogEl) {
		if (debug) {
			actionLogEl.removeAttribute("hidden");
		} else {
			actionLogEl.setAttribute("hidden", "");
		}
	}

	// Helper: get transcript element for an AI
	function getTranscript(aiId: AiId): HTMLElement | null {
		return doc.querySelector<HTMLElement>(`[data-transcript="${aiId}"]`);
	}

	// Helper: append text to a transcript
	function appendToTranscript(aiId: AiId, text: string): void {
		const el = getTranscript(aiId);
		if (el) el.textContent += text;
	}

	// Helper: pace token emission
	function pace(aiId: AiId): Promise<void> {
		const ms = TOKEN_PACE_MS * AI_TYPING_SPEED[aiId] * (0.5 + Math.random());
		return new Promise((r) => setTimeout(r, ms));
	}

	// Helper: update budget display
	function updateBudget(aiId: AiId, remaining: number): void {
		const panel = doc.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		if (!panel) return;
		const budgetEl = panel.querySelector<HTMLSpanElement>(".panel-budget");
		if (!budgetEl) return;
		// session is guaranteed non-null here (checked at top of renderGame)
		const currentSession = session;
		if (!currentSession) return;
		const phase = getActivePhase(currentSession.getState());
		const total = phase.budgets[aiId]?.total ?? 5;
		budgetEl.dataset.budget = String(remaining);
		budgetEl.textContent = `${remaining}/${total}`;
	}

	// Helper: update chat lockout status in dropdown
	function setChatLockout(aiId: AiId, locked: boolean): void {
		const option = addressSelect?.querySelector<HTMLOptionElement>(
			`option[value="${aiId}"]`,
		);
		if (option) option.disabled = locked;
	}

	form.addEventListener("submit", async (evt) => {
		evt.preventDefault();
		const message = promptInput.value.trim();
		if (!message || !session) return;

		const addressed = addressSelect.value as AiId;
		promptInput.value = "";
		sendBtn.disabled = true;

		// Append player's message to the addressed panel
		appendToTranscript(addressed, `\n[you] ${message}\n`);

		// Show a global "thinking…" placeholder in the addressed panel while
		// the round runs (round-coordinator buffers all three AI responses
		// before the encoder splits them into per-panel token events).
		const addressedTranscript = getTranscript(addressed);
		const placeholderStart = addressedTranscript?.textContent?.length ?? 0;
		if (addressedTranscript) addressedTranscript.textContent += "thinking…";
		let placeholderShown = true;
		const stripPlaceholder = (): void => {
			if (!placeholderShown || !addressedTranscript) return;
			addressedTranscript.textContent =
				(addressedTranscript.textContent ?? "").slice(0, placeholderStart);
			placeholderShown = false;
		};

		// Roll initiative for this round
		const initiative = shuffle(AI_ORDER);

		try {
			const provider = new BrowserLLMProvider();
			const { result, completions, nextState } = await session.submitMessage(
				addressed,
				message,
				provider,
				undefined,
				initiative,
			);

			stripPlaceholder();

			const phaseAfter = getActivePhase(nextState);
			const events = encodeRoundResult(
				result,
				completions,
				phaseAfter,
				nextState.personas,
			);

			let speakingAi: AiId | null = null;

			for (const event of events) {
				switch (event.type) {
					case "ai_start":
						speakingAi = event.aiId;
						appendToTranscript(event.aiId, `[${PERSONAS[event.aiId].name}] `);
						break;

					case "token":
						if (speakingAi) {
							appendToTranscript(speakingAi, event.text);
							await pace(speakingAi);
						}
						break;

					case "ai_end":
						if (speakingAi) {
							appendToTranscript(speakingAi, "\n");
						}
						speakingAi = null;
						break;

					case "budget":
						updateBudget(event.aiId, event.remaining);
						break;

					case "lockout":
						appendToTranscript(event.aiId, `[${event.content}]\n`);
						break;

					case "chat_lockout":
						setChatLockout(event.aiId, true);
						break;

					case "chat_lockout_resolved":
						setChatLockout(event.aiId, false);
						break;

					case "action_log":
						// Always accumulate in the DOM (even if hidden) so ?debug=1 shows history
						if (actionLogList) {
							const li = doc.createElement("li");
							li.textContent = `[Round ${event.entry.round}] ${event.entry.description}`;
							actionLogList.appendChild(li);
						}
						break;

					case "phase_advanced":
						// TODO(#45): phase progression UI
						break;

					case "game_ended":
						sendBtn.disabled = true;
						promptInput.disabled = true;
						break;
				}
			}
		} catch (err) {
			stripPlaceholder();
			if (err instanceof CapHitError && capHitEl) {
				capHitEl.removeAttribute("hidden");
			}
		} finally {
			stripPlaceholder();
			sendBtn.disabled = false;
		}
	});
}
