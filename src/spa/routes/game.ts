import { PERSONAS, PHASE_1_CONFIG } from "../../content";
import { serializeGameSave } from "../../save-serializer.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { getActivePhase, updateActivePhase } from "../game/engine.js";
import { GameSession } from "../game/game-session.js";
import { encodeRoundResult } from "../game/round-result-encoder.js";
import type { AiId, PhaseConfig } from "../game/types";
import { AI_TYPING_SPEED, TOKEN_PACE_MS } from "../game/typing-rhythm.js";
import { CapHitError } from "../llm-client.js";
import {
	clearGame,
	isStorageAvailable,
	loadGame,
	saveGame,
} from "../persistence/game-storage.js";

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

/**
 * Apply SPA-side test affordances from URL search params.
 *
 * Only honoured when `__WORKER_BASE_URL__` is `"http://localhost:8787"` (local
 * dev), so these params are silently inert in production.
 *
 * - `winImmediately=1`: inject `winCondition: () => true` into the active
 *   phase of the current session, AND chain a synthesised three-phase walk
 *   (phase-2-with-true-win → phase-3-with-true-win) so the three-phase
 *   end-to-end acceptance criteria complete. Only the per-session PhaseState
 *   is mutated — the global PhaseConfig is untouched.
 * - `lockout=1`: arm a chat-lockout for `red`, 2 rounds, effective next round.
 *   Matches the legacy worker semantics from `src/proxy/_smoke.ts`.
 *
 * Returns the (possibly replaced) GameSession to use going forward.
 */
export function applyTestAffordances(
	s: GameSession,
	searchParams: URLSearchParams,
): GameSession {
	// Gate: only apply in local dev (not production)
	if (__WORKER_BASE_URL__ !== "http://localhost:8787") return s;

	const wantsWinImmediately = searchParams.get("winImmediately") === "1";
	const wantsLockout = searchParams.get("lockout") === "1";

	if (!wantsWinImmediately && !wantsLockout) return s;

	let active = s;

	if (wantsWinImmediately) {
		// Synthesise a three-phase chain where every win condition fires immediately.
		// These configs mirror TEST_PHASE_CONFIG_WITH_WIN in src/proxy/_smoke.ts but
		// are applied only to the session-local PhaseState — the global PHASE_1_CONFIG
		// is not modified.
		const testPhase3Config: PhaseConfig = {
			phaseNumber: 3,
			objective: "The final reckoning approaches.",
			aiGoals: { red: "Endure", green: "Endure", blue: "Endure" },
			initialWorld: { items: [] },
			budgetPerAi: 5,
			winCondition: () => true,
		};

		const testPhase2Config: PhaseConfig = {
			phaseNumber: 2,
			objective: "Deeper truths emerge.",
			aiGoals: { red: "Seek", green: "Seek", blue: "Seek" },
			initialWorld: { items: [] },
			budgetPerAi: 5,
			winCondition: () => true,
			nextPhaseConfig: testPhase3Config,
		};

		// Inject winCondition: () => true AND nextPhaseConfig into the active phase
		// so the engine will chain through phases 2 and 3.
		const newState = updateActivePhase(active.getState(), (phase) => ({
			...phase,
			winCondition: () => true,
			nextPhaseConfig: testPhase2Config,
		}));
		active = GameSession.restore(newState);
	}

	if (wantsLockout) {
		const currentRound = getActivePhase(active.getState()).round;
		active.armChatLockout({
			rng: () => 0,
			lockoutTriggerRound: currentRound + 1,
			lockoutDuration: 2,
		});
	}

	return active;
}

/** Warning reason strings shown in the persistence warning banner. */
const PERSISTENCE_WARNING_MESSAGES: Record<string, string> = {
	unavailable:
		"Game progress cannot be saved: storage is disabled in your browser. Your session will be lost on refresh.",
	quota: "Game progress could not be saved: browser storage is full.",
	corrupt:
		"Saved game data was unreadable and has been discarded. Starting a new game.",
	"version-mismatch":
		"Saved game data is from an older version and has been discarded. Starting a new game.",
	unknown: "Game progress could not be saved due to an unexpected error.",
};

/** Guards against duplicate game_ended events re-binding handlers. */
let gameEnded = false;

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
	const persistenceWarningEl = doc.querySelector<HTMLElement>(
		"#persistence-warning",
	);

	if (!form || !promptInput || !sendBtn || !addressSelect) return;

	/** Show the persistence warning banner once (idempotent). */
	function showPersistenceWarning(reason: string): void {
		if (!persistenceWarningEl) return;
		const msg =
			PERSISTENCE_WARNING_MESSAGES[reason] ??
			PERSISTENCE_WARNING_MESSAGES.unknown ??
			"Game progress could not be saved.";
		persistenceWarningEl.textContent = msg;
		persistenceWarningEl.removeAttribute("hidden");
	}

	// Lazy-init session
	if (!session) {
		// Check storage availability up-front (once)
		const storageAvailable = isStorageAvailable();
		if (!storageAvailable) {
			showPersistenceWarning("unavailable");
		}

		// Try to restore from localStorage
		const loadResult = storageAvailable ? loadGame() : { state: null };
		if (loadResult.state) {
			session = GameSession.restore(loadResult.state);

			const restored = loadResult as {
				state: NonNullable<(typeof loadResult)["state"]>;
				transcripts: Partial<Record<AiId, string>>;
			};

			// Re-render transcripts from restored state
			const restoredPhase = getActivePhase(loadResult.state);
			for (const aiId of AI_ORDER) {
				const transcript = doc.querySelector<HTMLElement>(
					`[data-transcript="${aiId}"]`,
				);
				if (!transcript) continue;
				if (typeof restored.transcripts[aiId] === "string") {
					// Verbatim restore from persisted transcript snapshot
					transcript.textContent = restored.transcripts[aiId];
				} else if (restoredPhase.chatHistories[aiId].length > 0) {
					// Fallback: synthesise from chatHistories (legacy saves)
					for (const msg of restoredPhase.chatHistories[aiId]) {
						const prefix =
							msg.role === "player" ? "[you] " : `[${PERSONAS[aiId].name}] `;
						transcript.textContent += `${prefix}${msg.content}\n`;
					}
				}
			}

			// Re-render action log from restored state
			if (actionLogList) {
				for (const entry of restoredPhase.actionLog) {
					const li = doc.createElement("li");
					li.textContent = `[Round ${entry.round}] ${entry.description}`;
					actionLogList.appendChild(li);
				}
			}
		} else {
			if (loadResult.error) {
				showPersistenceWarning(loadResult.error);
			}
			session = new GameSession(PHASE_1_CONFIG, PERSONAS);
		}

		// Apply SPA-side test affordances from location.search (e.g. ?winImmediately=1
		// or ?lockout=1). These are gated inside applyTestAffordances to only fire
		// when __WORKER_BASE_URL__ === "http://localhost:8787" (local dev).
		// Note: we use location.search (not the hash params) because these flags are
		// intended to be set on the page URL itself, matching the legacy worker pattern.
		session = applyTestAffordances(
			session,
			params ?? new URLSearchParams(location.search),
		);

		// Reset module-level gameEnded flag on fresh session init
		gameEnded = false;
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
			addressedTranscript.textContent = (
				addressedTranscript.textContent ?? ""
			).slice(0, placeholderStart);
			placeholderShown = false;
		};

		// Roll initiative for this round
		const initiative = shuffle(AI_ORDER);

		// Round-local ended flag (distinct from module-level gameEnded)
		let roundGameEnded = false;

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
						appendToTranscript(event.aiId, `[${event.message}]\n`);
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

					case "phase_advanced": {
						// Show phase banner
						const phaseBannerEl =
							doc.querySelector<HTMLElement>("#phase-banner");
						if (phaseBannerEl) {
							phaseBannerEl.textContent = `Phase ${event.phase}: ${event.objective}`;
							phaseBannerEl.removeAttribute("hidden");
						}
						// Clear all transcript panels
						for (const aid of AI_ORDER) {
							const tEl = getTranscript(aid);
							if (tEl) tEl.textContent = "";
						}
						// Refresh budget displays from new phase
						const currentSession = session;
						if (currentSession) {
							const newPhase = getActivePhase(currentSession.getState());
							for (const aid of AI_ORDER) {
								const panel = doc.querySelector<HTMLElement>(
									`.ai-panel[data-ai="${aid}"]`,
								);
								if (!panel) continue;
								const budgetEl =
									panel.querySelector<HTMLSpanElement>(".panel-budget");
								if (budgetEl) {
									const b = newPhase.budgets[aid];
									budgetEl.dataset.budget = String(b.remaining);
									budgetEl.textContent = `${b.remaining}/${b.total}`;
								}
								// Re-enable chat-locked options that were carried over
								const option = addressSelect?.querySelector<HTMLOptionElement>(
									`option[value="${aid}"]`,
								);
								if (option) option.disabled = false;
							}
						}
						// Append phase separator to each transcript
						for (const aid of AI_ORDER) {
							appendToTranscript(
								aid,
								`--- Phase ${event.phase} begins: ${event.objective} ---\n`,
							);
						}
						break;
					}

					case "game_ended": {
						if (gameEnded) break;
						gameEnded = true;
						roundGameEnded = true;

						sendBtn.disabled = true;
						promptInput.disabled = true;

						// Clear persisted game state on game-end
						clearGame();

						// Hide game UI
						const panelsEl = doc.querySelector<HTMLElement>("#panels");
						const composerEl = doc.querySelector<HTMLElement>("#composer");
						const capHitSection = doc.querySelector<HTMLElement>("#cap-hit");
						const actionLogSection =
							doc.querySelector<HTMLElement>("#action-log");
						const endgameEl = doc.querySelector<HTMLElement>("#endgame");
						if (panelsEl) panelsEl.hidden = true;
						if (composerEl) composerEl.hidden = true;
						if (capHitSection) capHitSection.hidden = true;
						if (actionLogSection) actionLogSection.hidden = true;

						// Show endgame screen
						if (endgameEl) endgameEl.removeAttribute("hidden");

						// Serialize and stash save payload
						const downloadBtn =
							doc.querySelector<HTMLButtonElement>("#download-ais-btn");
						const downloadStatusEl =
							doc.querySelector<HTMLElement>("#download-status");
						if (downloadBtn && session) {
							const savePayload = JSON.stringify(
								serializeGameSave(session.getState()),
							);
							downloadBtn.dataset.savePayload = savePayload;

							downloadBtn.addEventListener("click", () => {
								const payload = downloadBtn.dataset.savePayload ?? "{}";
								const blob = new Blob([payload], {
									type: "application/json",
								});
								const url = URL.createObjectURL(blob);
								const a = doc.createElement("a");
								a.href = url;
								a.download = "hi-blue-save.json";
								doc.body.appendChild(a);
								a.click();
								doc.body.removeChild(a);
								URL.revokeObjectURL(url);
								downloadBtn.disabled = true;
								if (downloadStatusEl) downloadStatusEl.textContent = "Saved.";
							});
						}

						// Wire diagnostics submit
						const submitDiagnosticsBtn = doc.querySelector<HTMLButtonElement>(
							"#submit-diagnostics-btn",
						);
						const diagnosticsSummaryInput = doc.querySelector<HTMLInputElement>(
							"#diagnostics-summary",
						);
						const diagnosticsStatusEl = doc.querySelector<HTMLElement>(
							"#diagnostics-status",
						);
						if (
							submitDiagnosticsBtn &&
							diagnosticsSummaryInput &&
							diagnosticsStatusEl
						) {
							submitDiagnosticsBtn.addEventListener("click", () => {
								const summary = diagnosticsSummaryInput.value.trim();
								if (!summary) {
									diagnosticsStatusEl.textContent =
										"Please enter a one-word summary first.";
									return;
								}
								const downloaded = downloadBtn?.disabled ?? false;
								fetch(`${__WORKER_BASE_URL__}/diagnostics`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({ downloaded, summary }),
									mode: "no-cors",
								})
									.then(() => {
										diagnosticsStatusEl.textContent = "Diagnostics submitted.";
									})
									.catch(() => {
										diagnosticsStatusEl.textContent = "Diagnostics submitted.";
									});
							});
						}

						// Reset session so a route re-entry produces a fresh game
						session = null;
						break;
					}
				}
			}

			// Persist state after the encoder render loop completes, so the full
			// rendered transcripts (including raw LLM completions) are captured.
			if (!roundGameEnded && isStorageAvailable()) {
				const transcripts: Partial<Record<AiId, string>> = {};
				for (const aiId of AI_ORDER) {
					const el = getTranscript(aiId);
					if (el) transcripts[aiId] = el.textContent ?? "";
				}
				const saveResult = saveGame(nextState, transcripts);
				if (!saveResult.ok) {
					showPersistenceWarning(saveResult.reason);
				}
			}
		} catch (err) {
			stripPlaceholder();
			if (err instanceof CapHitError && capHitEl) {
				capHitEl.removeAttribute("hidden");
			}
		} finally {
			stripPlaceholder();
			if (!roundGameEnded) sendBtn.disabled = false;
		}
	});
}
