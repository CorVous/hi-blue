import { PERSONAS, PHASE_1_CONFIG } from "../../content";
import { serializeGameSave } from "../../save-serializer.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { deriveComposerState } from "../game/composer-reducer.js";
import { getActivePhase, updateActivePhase } from "../game/engine.js";
import { GameSession } from "../game/game-session.js";
import {
	applyAddresseeChange,
	buildPersonaColorMap,
	buildPersonaDisplayNameMap,
	buildPersonaNameMap,
} from "../game/mention-parser.js";
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
 * True when the SPA is being served by `pnpm wrangler dev` (SPA + worker
 * co-served on http://localhost:8787). Any other host — production
 * GitHub Pages, a separate static server pointed at the local worker —
 * fails this check, so the dev affordances stay inert.
 *
 * The build-time-constant half (`__WORKER_BASE_URL__ === "http://localhost:8787"`)
 * is defence in depth: it disables affordances for any production-targeted
 * build even if a future deploy somehow co-serves SPA + worker on one origin.
 */
function isDevHost(): boolean {
	return (
		__WORKER_BASE_URL__ === "http://localhost:8787" &&
		typeof location !== "undefined" &&
		location.origin === __WORKER_BASE_URL__
	);
}

/**
 * Recursively deep-clone a PhaseConfig chain, overriding `winCondition` to
 * `() => true` at every level.
 *
 * Only the config objects are cloned — the `initialWorld` and `aiGoals` values
 * are shallow-copied (they are plain data with no function members that need
 * patching). The original configs are never mutated.
 */
function patchPhaseChain(config: PhaseConfig): PhaseConfig {
	return {
		...config,
		winCondition: () => true,
		...(config.nextPhaseConfig !== undefined
			? { nextPhaseConfig: patchPhaseChain(config.nextPhaseConfig) }
			: {}),
	};
}

/**
 * Apply SPA-side test affordances from URL search params.
 *
 * Only honoured when the SPA is served by `pnpm wrangler dev` (see
 * `isDevHost`). Silently inert in any other host.
 *
 * - `winImmediately=1`: recursively patch the real phase chain reachable from
 *   the active phase, injecting `winCondition: () => true` into the active
 *   phase AND every phase reachable via `nextPhaseConfig`. This uses the real
 *   PHASE_1 → PHASE_2 → PHASE_3 config chain (deep-cloned; originals are
 *   untouched). A cold-start `goto("/?winImmediately=1")` followed by three
 *   submitted messages will reliably reach `game_ended`.
 * - `lockout=1`: arm a chat-lockout for `red`, 2 rounds, effective next round.
 *   Matches the legacy worker semantics from `src/proxy/_smoke.ts`.
 *
 * Returns the (possibly replaced) GameSession to use going forward.
 */
export function applyTestAffordances(
	s: GameSession,
	searchParams: URLSearchParams,
): GameSession {
	// Gate: only apply when wrangler dev is the host
	if (!isDevHost()) return s;

	const wantsWinImmediately = searchParams.get("winImmediately") === "1";
	const wantsLockout = searchParams.get("lockout") === "1";

	if (!wantsWinImmediately && !wantsLockout) return s;

	let active = s;

	if (wantsWinImmediately) {
		// Patch the real phase chain: inject winCondition: () => true into the
		// active phase AND every phase reachable via nextPhaseConfig.
		// patchPhaseChain deep-clones each config level so the global
		// PHASE_1_CONFIG (and its linked configs) are never mutated.
		const newState = updateActivePhase(active.getState(), (phase) => ({
			...phase,
			winCondition: () => true,
			...(phase.nextPhaseConfig !== undefined
				? { nextPhaseConfig: patchPhaseChain(phase.nextPhaseConfig) }
				: {}),
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
	const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
	const actionLogEl = doc.querySelector<HTMLElement>("#action-log");
	const actionLogList = doc.querySelector<HTMLUListElement>("#action-log-list");
	const persistenceWarningEl = doc.querySelector<HTMLElement>(
		"#persistence-warning",
	);

	if (!form || !promptInput || !sendBtn) return;

	// Mention-based addressing state
	const personaNamesToId = buildPersonaNameMap(PERSONAS);
	const personaColors = buildPersonaColorMap(PERSONAS);
	const personaDisplayNames = buildPersonaDisplayNameMap(PERSONAS);
	const lockouts: Map<AiId, boolean> = new Map([
		["red", false],
		["green", false],
		["blue", false],
	]);
	let roundInFlight = false;

	// promptInput and sendBtn are guaranteed non-null (checked above).
	const _promptInput = promptInput;
	const _sendBtn = sendBtn;

	// Overlay for mention highlight rendering.
	const overlay = doc.querySelector<HTMLElement>("#prompt-overlay");

	/** Remove any class on `el` that starts with `prefix`, then add `${prefix}${value}` if non-null. */
	function setColorClass(
		el: HTMLElement,
		prefix: string,
		value: string | null,
	): void {
		for (const cls of [...el.classList]) {
			if (cls.startsWith(prefix)) el.classList.remove(cls);
		}
		if (value != null) el.classList.add(`${prefix}${value}`);
	}

	/** Rebuild the overlay's DOM to reflect the current text and highlight range. */
	function rebuildOverlay(
		ov: HTMLElement | null,
		text: string,
		highlight: { start: number; end: number; color: string } | null,
	): void {
		if (!ov) return;
		// Remove all children.
		while (ov.firstChild) ov.removeChild(ov.firstChild);
		if (!highlight) {
			ov.appendChild(doc.createTextNode(text));
			return;
		}
		const { start, end, color } = highlight;
		if (start > 0) {
			ov.appendChild(doc.createTextNode(text.slice(0, start)));
		}
		const span = doc.createElement("span");
		span.className = `mention-highlight mention--${color}`;
		span.appendChild(doc.createTextNode(text.slice(start, end)));
		ov.appendChild(span);
		if (end < text.length) {
			ov.appendChild(doc.createTextNode(text.slice(end)));
		}
	}

	function refreshComposerState(): void {
		const state = deriveComposerState({
			text: _promptInput.value,
			lockouts,
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		_sendBtn.disabled = !state.sendEnabled || roundInFlight;
		setColorClass(_promptInput, "composer-border--", state.borderColor);

		// Panel muting (panel--locked) and addressing
		for (const aiId of AI_ORDER) {
			const panel = doc.querySelector<HTMLElement>(
				`.ai-panel[data-ai="${aiId}"]`,
			);
			if (!panel) continue;
			const isAddressed = state.panelHighlight === aiId;
			panel.classList.toggle("panel--addressed", isAddressed);
			const color = personaColors.get(aiId);
			if (color)
				panel.classList.toggle(`panel--addressed-${color}`, isAddressed);
			// Lock muting
			const isLocked = state.lockedPanels.has(aiId);
			panel.classList.toggle("panel--locked", isLocked);
			panel.setAttribute("aria-disabled", isLocked ? "true" : "false");
		}

		// Inline lockout error element
		const lockoutErrorEl =
			doc.querySelector<HTMLOutputElement>("#lockout-error");
		if (lockoutErrorEl) {
			if (state.lockoutError) {
				lockoutErrorEl.textContent = state.lockoutError;
				lockoutErrorEl.removeAttribute("hidden");
			} else {
				lockoutErrorEl.textContent = "";
				lockoutErrorEl.setAttribute("hidden", "");
			}
		}

		rebuildOverlay(overlay, _promptInput.value, state.mentionHighlight);
		if (overlay) overlay.scrollLeft = _promptInput.scrollLeft;
	}

	promptInput.addEventListener("input", refreshComposerState);
	promptInput.addEventListener("scroll", () => {
		if (overlay) overlay.scrollLeft = _promptInput.scrollLeft;
	});

	// Dev-only: ?think=0 disables the model's thinking step (OpenRouter
	// reasoning.enabled=false). Gated to wrangler-dev host (see isDevHost).
	//
	// Merge hash-query-string params (from the router) with location.search
	// params so flags like ?think=0, ?lockout=1, ?winImmediately=1 work whether
	// they appear in the search string (e.g. "/?lockout=1") or after the hash
	// (e.g. "/#/?lockout=1"). Hash params win on conflict.
	const effectiveParams = new URLSearchParams(location.search);
	if (params) {
		for (const [k, v] of params) effectiveParams.set(k, v);
	}
	const disableReasoning = isDevHost() && effectiveParams.get("think") === "0";

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
		session = applyTestAffordances(session, effectiveParams);

		// Hydrate lockouts from the active phase's chatLockouts map so that
		// a reload preserves the Send-disabled state for locked-out AIs.
		const activePhaseForLockouts = getActivePhase(session.getState());
		for (const aiId of AI_ORDER) {
			lockouts.set(aiId, activePhaseForLockouts.chatLockouts.has(aiId));
		}

		// Reset module-level gameEnded flag on fresh session init
		gameEnded = false;
	}

	// Set initial composer state (Send starts disabled until a valid @mention).
	refreshComposerState();

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

	// Panel-click → addressee mention mutation (issue #108)
	for (const aiId of AI_ORDER) {
		const panel = doc.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		if (!panel) continue;
		panel.addEventListener("click", () => {
			const targetAi = panel.dataset.ai as AiId | undefined;
			if (!targetAi) return;
			if (lockouts.get(targetAi) === true) return;
			const result = applyAddresseeChange({
				text: _promptInput.value,
				selectionStart: _promptInput.selectionStart,
				targetPersona: targetAi,
				personaNamesToId,
				personas: PERSONAS,
			});
			_promptInput.value = result.text;
			try {
				_promptInput.setSelectionRange(
					result.selectionStart,
					result.selectionStart,
				);
			} catch {
				/* ignore */
			}
			refreshComposerState();
		});
	}

	// Debug toggle: show action log if ?debug=1
	const debug = effectiveParams.get("debug") === "1";
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

	// Helper: update chat lockout status in the lockouts map
	function setChatLockout(aiId: AiId, locked: boolean): void {
		lockouts.set(aiId, locked);
		refreshComposerState();
	}

	form.addEventListener("submit", async (evt) => {
		evt.preventDefault();
		if (!session) return;

		const { sendEnabled, addressee } = deriveComposerState({
			text: promptInput.value,
			lockouts,
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		if (!sendEnabled || !addressee) return;

		const message = promptInput.value.trim();
		if (!message) return;

		const addressed = addressee;
		roundInFlight = true;
		sendBtn.disabled = true;

		// Append player's message to the addressed panel
		appendToTranscript(addressed, `[you] ${message}\n`);

		// Show a "thinking…" placeholder in the addressed panel while the
		// first live delta arrives. Stripped on the first onAiDelta call;
		// the safety-net strip after submitMessage handles mock/locked-AI paths.
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

		// Track AIs that have received at least one live delta from the wire.
		// When an AI is in this set, the encoder skips re-appending token text
		// (it's already painted live) but still awaits pace() for timing shape.
		const liveAis = new Set<AiId>();
		// Track first-delta-seen per AI to emit the persona prefix exactly once.
		const firstDeltaSeen = new Set<AiId>();

		const onAiDelta = (aiId: AiId, text: string): void => {
			if (!firstDeltaSeen.has(aiId)) {
				firstDeltaSeen.add(aiId);
				// Strip "thinking…" on first live delta for any AI — before painting.
				stripPlaceholder();
				// Emit persona prefix live (encoder will skip it for this AI).
				appendToTranscript(aiId, `[${PERSONAS[aiId].name}] `);
				liveAis.add(aiId);
			}
			appendToTranscript(aiId, text);
		};

		try {
			const provider = new BrowserLLMProvider({ disableReasoning });
			const { result, completions, nextState } = await session.submitMessage(
				addressed,
				message,
				provider,
				undefined,
				initiative,
				onAiDelta,
			);

			// Safety-net strip: if no live deltas arrived (mock provider, all AIs
			// locked out, or first delta hasn't fired yet), strip placeholder now.
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
						if (!liveAis.has(event.aiId)) {
							// Not live — emit persona prefix now (synthetic path).
							appendToTranscript(event.aiId, `[${PERSONAS[event.aiId].name}] `);
						}
						// If live, prefix was already painted; just track speakingAi.
						break;

					case "token":
						if (speakingAi) {
							if (!liveAis.has(speakingAi)) {
								// Synthetic path: append token and pace.
								appendToTranscript(speakingAi, event.text);
							}
							// Live path: text already painted; still await pace() so the
							// overall timing shape is preserved (important for token-pacing
							// tests and consistent UI behaviour).
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
								// Re-enable chat-locked AIs that were carried over
								lockouts.set(aid, false);
							}
							refreshComposerState();
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

			// Persist the addressee prefix so threaded conversations don't require
			// re-picking the mention each turn. Body is cleared; cursor lands at end.
			// Only written on success (not in catch) and not on round-game-ended.
			if (!roundGameEnded) {
				const persistedPrefix = `@${PERSONAS[addressed].name} `;
				promptInput.value = persistedPrefix;
				promptInput.setSelectionRange(
					persistedPrefix.length,
					persistedPrefix.length,
				);
				promptInput.focus();
			}
		} catch (err) {
			stripPlaceholder();
			if (err instanceof CapHitError && capHitEl) {
				capHitEl.removeAttribute("hidden");
			}
		} finally {
			stripPlaceholder();
			roundInFlight = false;
			if (!roundGameEnded) refreshComposerState();
		}
	});
}
