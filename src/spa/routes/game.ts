import {
	generatePersonas,
	PHASE_1_CONFIG,
	PHASE_2_CONFIG,
	PHASE_3_CONFIG,
	SETTING_POOL,
} from "../../content";
import { generateContentPacks } from "../../content/content-pack-generator.js";
import { serializeGameSave } from "../../save-serializer.js";
import {
	BANNER,
	formatTopInfoLeft,
	formatTopInfoMobile,
	formatTopInfoRight,
	getOrMintSessionId,
	initPanelChrome,
	TOPINFO_RIGHT_OK_TEXT,
} from "../bbs-chrome.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { deriveComposerState } from "../game/composer-reducer.js";
import { BrowserContentPackProvider } from "../game/content-pack-provider.js";
import { getActivePhase, updateActivePhase } from "../game/engine.js";
import { GameSession } from "../game/game-session.js";
import { BrowserSynthesisProvider } from "../game/llm-synthesis-provider.js";
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

/** Lowercased persona name for transcript prefixes (`> *ember <msg>`). */
function transcriptName(name: string): string {
	return name.toLowerCase();
}

/** Format a USD remaining amount as cents for the panel budget display
 * (e.g. 0.05 → "5.000¢"). Clamps negatives to zero. */
function formatBudget(remainingUsd: number): string {
	return `${(Math.max(0, remainingUsd) * 100).toFixed(3)}¢`;
}

/** Match an AI prefix at the start of a line: `> *<handle> ` (handle is
 * non-whitespace). Capture group 1 is the lowercased handle. */
const AI_PREFIX_RE = /^> \*(\S+) /;

/** Build a regex that matches any persona handle (with an optional leading
 * `*`) as a whole word, case-insensitive. Returns null when no personas
 * are available so callers can short-circuit. */
function buildMentionRegex(
	personas: Record<string, { name: string }>,
): RegExp | null {
	const names = Object.values(personas)
		.map((p) => p.name)
		.filter((n) => n.length > 0);
	if (names.length === 0) return null;
	const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`\\*?\\b(?:${escaped.join("|")})\\b`, "gi");
}

/** Append `text` to `parent`, splitting persona-name occurrences (with an
 * optional leading `*`) into `.msg-mention` spans tinted with the persona's
 * color. Non-matching chunks are wrapped in `defaultClass` when provided
 * (e.g. `msg-you` for player lines), otherwise emitted as bare text nodes
 * so they inherit the parent's amber color. */
function appendMentionAwareText(
	parent: HTMLElement,
	text: string,
	personas: Record<string, { name: string; color?: string }>,
	defaultClass?: string,
): void {
	if (!text) return;
	const doc = parent.ownerDocument;
	const personaList = Object.values(personas);
	const appendChunk = (chunk: string): void => {
		if (!chunk) return;
		if (defaultClass) {
			const span = doc.createElement("span");
			span.className = defaultClass;
			span.textContent = chunk;
			parent.appendChild(span);
		} else {
			parent.appendChild(doc.createTextNode(chunk));
		}
	};
	const re = buildMentionRegex(personas);
	if (!re) {
		appendChunk(text);
		return;
	}
	let lastIdx = 0;
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		appendChunk(text.slice(lastIdx, m.index));
		const matchText = m[0];
		const baseName = matchText.startsWith("*") ? matchText.slice(1) : matchText;
		const persona = personaList.find(
			(p) => p.name.toLowerCase() === baseName.toLowerCase(),
		);
		const span = doc.createElement("span");
		span.className = "msg-mention";
		if (persona?.color) {
			span.style.setProperty("--mention-color", persona.color);
		}
		span.textContent = matchText;
		parent.appendChild(span);
		lastIdx = m.index + matchText.length;
	}
	appendChunk(text.slice(lastIdx));
}

/** Render a saved transcript string into the given element by parsing
 * lines and wrapping each logical message in a `.msg-line` block. AI
 * prefix portions (`> *<handle> `) become `.msg-prefix` spans tinted
 * with the persona's color; player lines (`> <msg>`) become `.msg-you`
 * spans. Lines starting with `[` (bracketed system messages) or `--- `
 * (phase separators) become their own standalone msg-line. Any other
 * orphan amber line is treated as a continuation of the preceding AI
 * msg-line — this matches the live `appendAiTokens` behavior, where an
 * AI response with embedded `\n` collapses into a single msg-line so
 * strip-card mode can render it as one ellipsis-truncated line. */
function renderRestoredTranscript(
	transcript: HTMLElement,
	saved: string,
	personas: Record<string, { name: string; color: string }>,
): void {
	const doc = transcript.ownerDocument;
	transcript.textContent = "";
	if (!saved) return;
	const lines = saved.split(/(?<=\n)/);
	// Tracks the most recently opened AI msg-line so consecutive orphan
	// continuation lines (no prefix, not a system marker) can be merged
	// into it instead of becoming new msg-lines.
	let currentAiLine: HTMLElement | null = null;
	const startNewMsgLine = (): HTMLElement => {
		const el = doc.createElement("div");
		el.className = "msg-line";
		transcript.appendChild(el);
		return el;
	};
	for (const line of lines) {
		const m = AI_PREFIX_RE.exec(line);
		const handle = m?.[1];
		const persona = handle
			? Object.values(personas).find((p) => p.name.toLowerCase() === handle)
			: undefined;
		// Only treat as an AI line when the matched handle resolves to a known
		// persona. Player lines now also start with `> *` (the new mention
		// glyph), so without this guard a player message like `> *Sage hi`
		// would be miscoloured as an AI prefix.
		if (handle && persona) {
			const prefixText = `> *${handle} `;
			const prefix = doc.createElement("span");
			prefix.className = "msg-prefix";
			if (persona.color) {
				prefix.style.setProperty("--prefix-color", persona.color);
			}
			prefix.textContent = prefixText;
			const lineEl = startNewMsgLine();
			lineEl.appendChild(prefix);
			const rest = line.slice(prefixText.length);
			if (rest) appendMentionAwareText(lineEl, rest, personas);
			currentAiLine = lineEl;
		} else if (line.startsWith("> ")) {
			appendMentionAwareText(startNewMsgLine(), line, personas, "msg-you");
			currentAiLine = null;
		} else if (line.startsWith("[") || line.startsWith("--- ")) {
			appendMentionAwareText(startNewMsgLine(), line, personas);
			currentAiLine = null;
		} else if (currentAiLine) {
			appendMentionAwareText(currentAiLine, line, personas);
		} else {
			appendMentionAwareText(startNewMsgLine(), line, personas);
		}
	}
}

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

export function renderGame(
	root: HTMLElement,
	params?: URLSearchParams,
): Promise<void> {
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

	if (!form || !promptInput || !sendBtn) return Promise.resolve();

	// Mention-based addressing state — built lazily after session init below,
	// since persona handles are procedurally generated per session.
	let personaNamesToId: ReturnType<typeof buildPersonaNameMap>;
	let personaColors: ReturnType<typeof buildPersonaColorMap>;
	let personaDisplayNames: ReturnType<typeof buildPersonaDisplayNameMap>;
	const lockouts: Map<AiId, boolean> = new Map();
	let roundInFlight = false;

	// promptInput and sendBtn are guaranteed non-null (checked above).
	const _promptInput = promptInput;
	const _sendBtn = sendBtn;

	// Overlay for mention highlight rendering.
	const overlay = doc.querySelector<HTMLElement>("#prompt-overlay");

	// Prompt-target indicator inside the BBS-style command-line prefix.
	const promptTargetEl = doc.querySelector<HTMLElement>(".prompt-target");

	/** Update the `/*<handle>` indicator beside `guest@hi-blue.bbs:` from the
	 * current addressee. `null` resets to dim `/?????`. */
	function refreshPromptTarget(addressee: AiId | null): void {
		if (!promptTargetEl) return;
		if (addressee == null) {
			promptTargetEl.textContent = "/?????";
			promptTargetEl.classList.remove("is-set");
			promptTargetEl.style.removeProperty("--target-color");
			return;
		}
		const personas = session?.getState().personas ?? {};
		const persona = personas[addressee];
		const handle = persona?.name ?? addressee;
		promptTargetEl.textContent = `/*${handle}`;
		promptTargetEl.classList.add("is-set");
		if (persona?.color) {
			promptTargetEl.style.setProperty("--target-color", persona.color);
		} else {
			promptTargetEl.style.removeProperty("--target-color");
		}
	}

	/** Set or clear the --panel-color CSS custom property on an element. */
	function setPanelColor(el: HTMLElement, color: string | null): void {
		if (color != null) {
			el.style.setProperty("--panel-color", color);
		} else {
			el.style.removeProperty("--panel-color");
		}
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
		span.className = "mention-highlight";
		span.style.setProperty("--panel-color", color);
		span.style.color = color;
		span.appendChild(doc.createTextNode(text.slice(start, end)));
		ov.appendChild(span);
		if (end < text.length) {
			ov.appendChild(doc.createTextNode(text.slice(end)));
		}
	}

	function refreshComposerState(): void {
		if (!personaNamesToId || !personaColors || !personaDisplayNames) return;
		const state = deriveComposerState({
			text: _promptInput.value,
			lockouts,
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		_sendBtn.disabled = !state.sendEnabled || roundInFlight;
		setPanelColor(_promptInput, state.borderColor);

		// Panel addressing + lockout muting
		for (const aiId of personaColors.keys()) {
			const panel = doc.querySelector<HTMLElement>(
				`.ai-panel[data-ai="${aiId}"]`,
			);
			if (!panel) continue;
			const isAddressed = state.panelHighlight === aiId;
			panel.classList.toggle("panel--addressed", isAddressed);
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
		refreshPromptTarget(state.addressee);
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

	// Promise that resolves when session init is complete (async new-game path).
	// Undefined for the restore path (sync).
	let asyncInitPromise: Promise<void> | undefined;

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

			// Re-render transcripts from restored state. Map aiIds to panels by
			// slot order — matches the panel-init loop below; needed because the
			// HTML scaffold has empty data-transcript attributes that get filled
			// in at panel-init time.
			const restoredPhase = getActivePhase(loadResult.state);
			const restoredPersonas = loadResult.state.personas;
			const restorePanelEls = doc.querySelectorAll<HTMLElement>(".ai-panel");
			Object.keys(restoredPersonas).forEach((aiId, idx) => {
				const panel = restorePanelEls[idx];
				if (!panel) return;
				const transcript = panel.querySelector<HTMLElement>(".transcript");
				if (!transcript) return;
				if (typeof restored.transcripts[aiId] === "string") {
					// Verbatim restore from persisted transcript snapshot —
					// re-wrap player lines and AI-prefix portions for coloring.
					renderRestoredTranscript(
						transcript,
						restored.transcripts[aiId],
						restoredPersonas,
					);
				} else if ((restoredPhase.chatHistories[aiId]?.length ?? 0) > 0) {
					// Fallback: synthesise from chatHistories (legacy saves).
					transcript.textContent = "";
					const persona = restoredPersonas[aiId];
					const personaName = persona?.name ?? aiId;
					for (const msg of restoredPhase.chatHistories[aiId] ?? []) {
						const lineEl = doc.createElement("div");
						lineEl.className = "msg-line";
						if (msg.role === "player") {
							appendMentionAwareText(
								lineEl,
								`> ${msg.content}\n`,
								restoredPersonas,
								"msg-you",
							);
						} else {
							const prefixSpan = doc.createElement("span");
							prefixSpan.className = "msg-prefix";
							if (persona?.color) {
								prefixSpan.style.setProperty("--prefix-color", persona.color);
							}
							prefixSpan.textContent = `> *${transcriptName(personaName)} `;
							lineEl.appendChild(prefixSpan);
							appendMentionAwareText(
								lineEl,
								`${msg.content}\n`,
								restoredPersonas,
							);
						}
						transcript.appendChild(lineEl);
					}
				}
			});

			// Action log is populated from live SSE events only (no reload restore).

			// Scroll restored transcripts to the bottom on first paint so the
			// most recent messages are visible after a page refresh. Deferred
			// via rAF so layout (scrollHeight) is computed before we assign.
			requestAnimationFrame(() => {
				for (const panel of restorePanelEls) {
					scrollToBottom(panel.querySelector<HTMLElement>(".transcript"));
				}
			});
		} else {
			if (loadResult.error) {
				showPersistenceWarning(loadResult.error);
			}
			// Async bootstrap: generatePersonas now requires an LLM call.
			// session remains null until the promise resolves; the form submit
			// handler early-returns when session is null, so clicks before
			// synthesis completes are silently dropped (safe).
			asyncInitPromise = (async () => {
				try {
					const synth = new BrowserSynthesisProvider({ disableReasoning });
					const packLLM = new BrowserContentPackProvider({ disableReasoning });
					const personasPromise = generatePersonas(Math.random, synth);
					const aiIdsPromise = personasPromise.then((p) => Object.keys(p));
					// Silence derived-promise unhandled rejection when personasPromise
					// rejects but packs path returns before awaiting aiIdsPromise; the
					// rejection still propagates through personasPromise into Promise.all.
					aiIdsPromise.catch(() => {});
					const packsPromise = generateContentPacks(
						Math.random,
						SETTING_POOL,
						[PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG],
						packLLM,
						aiIdsPromise,
					);
					const [personas, contentPacks] = await Promise.all([
						personasPromise,
						packsPromise,
					]);
					session = new GameSession(PHASE_1_CONFIG, personas, contentPacks);

					// Apply SPA-side test affordances from location.search
					session = applyTestAffordances(session, effectiveParams);

					// Build persona maps from runtime state
					const runtimePersonas = session.getState().personas;
					personaNamesToId = buildPersonaNameMap(runtimePersonas);
					personaColors = buildPersonaColorMap(runtimePersonas);
					personaDisplayNames = buildPersonaDisplayNameMap(runtimePersonas);

					// Hydrate lockouts
					const activePhaseForLockouts = getActivePhase(session.getState());
					for (const aiId of Object.keys(runtimePersonas)) {
						lockouts.set(aiId, activePhaseForLockouts.chatLockouts.has(aiId));
					}

					gameEnded = false;

					// Populate panels now that session is available
					const panelElsAsync = doc.querySelectorAll<HTMLElement>(".ai-panel");
					const aiIdListAsync = Object.keys(runtimePersonas);
					panelElsAsync.forEach((panel, idx) => {
						const aiId = aiIdListAsync[idx];
						if (!aiId) return;
						panel.dataset.ai = aiId;
						const persona = runtimePersonas[aiId];
						if (!persona) return;
						panel.style.setProperty("--panel-color", persona.color);
						initPanelChrome(panel, persona);
						const budgetEl =
							panel.querySelector<HTMLSpanElement>(".panel-budget");
						const phase = activePhaseForLockouts;
						if (budgetEl) {
							const budget = phase.budgets[aiId];
							if (budget) {
								budgetEl.dataset.budget = String(budget.remaining);
								budgetEl.textContent = formatBudget(budget.remaining);
							}
						}
					});

					const handlesAsync = Object.values(runtimePersonas)
						.map((p) => `@${p.name}`)
						.join(" | ");
					if (handlesAsync) _promptInput.placeholder = `${handlesAsync} …`;

					// Register panel-click handlers now that panels have data-ai set.
					registerPanelClickHandlers(aiIdListAsync);

					refreshComposerState();
					refreshTopInfo();
				} catch (err) {
					// Funnel synthesis failure through the "AIs are sleeping" panel —
					// same UX path as CapHitError during gameplay.
					if (capHitEl) capHitEl.removeAttribute("hidden");
					const panelsEl = doc.querySelector<HTMLElement>("#panels");
					if (panelsEl) panelsEl.hidden = true;
					_sendBtn.disabled = true;
					_promptInput.disabled = true;
					// Re-throw to surface in console for debugging.
					throw err;
				}
			})();
		}

		// Synchronous post-init: only runs for the restore path (session is set).
		// The async new-game path handles this block inside its IIFE above.
		if (session !== null) {
			// Apply SPA-side test affordances from location.search (e.g. ?winImmediately=1
			// or ?lockout=1). These are gated inside applyTestAffordances to only fire
			// when __WORKER_BASE_URL__ === "http://localhost:8787" (local dev).
			// Note: we use location.search (not the hash params) because these flags are
			// intended to be set on the page URL itself, matching the legacy worker pattern.
			session = applyTestAffordances(session, effectiveParams);

			// Build persona maps from runtime state (after affordances may have replaced session)
			const runtimePersonas = session.getState().personas;
			personaNamesToId = buildPersonaNameMap(runtimePersonas);
			personaColors = buildPersonaColorMap(runtimePersonas);
			personaDisplayNames = buildPersonaDisplayNameMap(runtimePersonas);

			// Hydrate lockouts from the active phase's chatLockouts map so that
			// a reload preserves the Send-disabled state for locked-out AIs.
			const activePhaseForLockouts = getActivePhase(session.getState());
			for (const aiId of Object.keys(runtimePersonas)) {
				lockouts.set(aiId, activePhaseForLockouts.chatLockouts.has(aiId));
			}

			// Reset module-level gameEnded flag on fresh session init
			gameEnded = false;
		}
	}

	// Set initial composer state (Send starts disabled until a valid *mention).
	refreshComposerState();

	// For the sync restore path session is already set; for the async new-game
	// path session is still null here (the IIFE above handles panel init).
	const aiIdList: string[] =
		session !== null ? Object.keys(session.getState().personas) : [];

	// Populate panel headers, ASCII border chrome, --panel-color, and budgets.
	// Skipped for the async new-game path (handled inside the IIFE above).
	if (session !== null) {
		const panelEls = doc.querySelectorAll<HTMLElement>(".ai-panel");
		const runtimePersonasForPanels = session.getState().personas;
		const sessionRef = session;
		panelEls.forEach((panel, idx) => {
			const aiId = aiIdList[idx];
			if (!aiId) return;
			panel.dataset.ai = aiId;
			const persona = runtimePersonasForPanels[aiId];
			if (!persona) return;
			panel.style.setProperty("--panel-color", persona.color);
			initPanelChrome(panel, persona);
			const budgetEl = panel.querySelector<HTMLSpanElement>(".panel-budget");
			const phase = getActivePhase(sessionRef.getState());
			if (budgetEl) {
				const budget = phase.budgets[aiId];
				if (budget) {
					budgetEl.dataset.budget = String(budget.remaining);
					budgetEl.textContent = formatBudget(budget.remaining);
				}
			}
		});

		// Populate the input placeholder with the runtime handles, e.g.
		// `*Ember | *Sage | *Frost …` (test fixtures) or
		// `*a4b2 | *9bx2 | *cd3f …` (production).
		const handles = Object.values(session.getState().personas)
			.map((p) => `*${p.name}`)
			.join(" | ");
		if (handles) _promptInput.placeholder = `${handles} …`;
	}

	// One-time chrome: ASCII banner + initial top-info row.
	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;
	const sessionId = getOrMintSessionId();
	const topinfoLeftEl = doc.querySelector<HTMLElement>("#topinfo-left");
	const topinfoRightEl = doc.querySelector<HTMLElement>("#topinfo-right");
	const topinfoMobileEl = doc.querySelector<HTMLElement>("#topinfo-mobile");

	function refreshTopInfo(): void {
		if (!session) return;
		if (!topinfoLeftEl || !topinfoRightEl) return;
		const state = session.getState();
		const phase = getActivePhase(state);
		// Walk the nextPhaseConfig chain from PHASE_1_CONFIG to count total phases.
		let total = 1;
		let cursor: PhaseConfig | undefined = PHASE_1_CONFIG.nextPhaseConfig;
		while (cursor) {
			total += 1;
			cursor = cursor.nextPhaseConfig;
		}
		const personas = state.personas;
		const daemons = Object.keys(personas).filter(
			(id) => !phase.chatLockouts.has(id),
		).length;
		const inputs = {
			sessionId,
			phaseNumber: phase.phaseNumber,
			totalPhases: total,
			turn: phase.round,
			daemonsOnline: daemons,
		};
		topinfoLeftEl.textContent = formatTopInfoLeft(inputs);
		topinfoRightEl.textContent = formatTopInfoRight(inputs);
		const okSpan = doc.createElement("span");
		okSpan.className = "ok";
		okSpan.textContent = TOPINFO_RIGHT_OK_TEXT;
		topinfoRightEl.appendChild(okSpan);
		if (topinfoMobileEl) {
			topinfoMobileEl.textContent = formatTopInfoMobile(inputs);
		}
	}

	refreshTopInfo();

	/** Register panel-click → addressee mention handlers for the given AI ids.
	 * Called synchronously for the restore path (session is set immediately),
	 * or from inside the async IIFE for the new-game path (after session resolves). */
	function registerPanelClickHandlers(ids: string[]): void {
		for (const aiId of ids) {
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
					personas: session?.getState().personas ?? {},
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
	}

	// For the restore path, aiIdList is non-empty and handlers are registered now.
	// For the async new-game path, aiIdList is empty here; handlers are registered
	// inside the IIFE above after session resolves.
	registerPanelClickHandlers(aiIdList);

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

	// Helper: scroll the transcript's parent (the .scroll container) to
	// the bottom so newly appended content stays in view.
	function scrollToBottom(transcriptEl: HTMLElement | null): void {
		const scrollEl = transcriptEl?.parentElement;
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	}

	// Helper: open a fresh empty `.msg-line` div as a child of the transcript
	// and return it. Use for events that semantically start a new line
	// (player message, AI prefix, restored message).
	function startMsgLine(transcript: HTMLElement): HTMLElement {
		const div = doc.createElement("div");
		div.className = "msg-line";
		transcript.appendChild(div);
		return div;
	}

	// Helper: append streamed AI tokens to the current AI message's msg-line.
	// Embedded `\n` characters do NOT split into new msg-lines — the entire
	// AI message stays in one msg-line so strip-card preview can render it
	// as a single ellipsis-truncated line. The line opened by appendAiPrefix
	// is the target; if missing for any reason, a fallback line is opened.
	// The accumulated body is stored on the line's dataset so each delta can
	// re-render the body with mention-aware highlighting from the start.
	function appendAiTokens(aiId: AiId, text: string): void {
		const el = getTranscript(aiId);
		if (!el) return;
		const last = el.lastElementChild as HTMLElement | null;
		const line = last?.classList.contains("msg-line") ? last : startMsgLine(el);
		line.dataset.body = (line.dataset.body ?? "") + text;
		const personas = session?.getState().personas ?? {};
		const prefix = line.querySelector<HTMLElement>(":scope > .msg-prefix");
		while (line.lastChild && line.lastChild !== prefix) {
			line.removeChild(line.lastChild);
		}
		appendMentionAwareText(line, line.dataset.body, personas);
		scrollToBottom(el);
	}

	// Helper: append a system-generated line (phase separator, lockout text,
	// error brackets) as its own .msg-line block. Always opens a fresh line
	// — never merges into an in-progress AI message.
	function appendStandaloneLine(aiId: AiId, text: string): void {
		const el = getTranscript(aiId);
		if (!el) return;
		const line = startMsgLine(el);
		const personas = session?.getState().personas ?? {};
		appendMentionAwareText(line, text, personas);
		scrollToBottom(el);
	}

	// Helper: append a player line wrapped in a .msg-you span (warm white)
	// inside its own .msg-line block. Persona-name mentions inside the
	// message body are split into .msg-mention spans so they pick up the
	// addressed daemon's color instead of warm white.
	function appendPlayerLine(aiId: AiId, text: string): void {
		const el = getTranscript(aiId);
		if (!el) return;
		const line = startMsgLine(el);
		const personas = session?.getState().personas ?? {};
		appendMentionAwareText(line, text, personas, "msg-you");
		scrollToBottom(el);
	}

	// Helper: append an AI persona-prefix span (`> *<handle> `) tinted with
	// the persona's color, opening a fresh .msg-line block for it. The
	// streaming AI tokens that follow continue inside the same .msg-line
	// until a `\n` closes the message.
	function appendAiPrefix(aiId: AiId, personaName: string): void {
		const el = getTranscript(aiId);
		if (!el) return;
		const line = startMsgLine(el);
		const span = doc.createElement("span");
		span.className = "msg-prefix";
		const color = session?.getState().personas[aiId]?.color;
		if (color) span.style.setProperty("--prefix-color", color);
		span.textContent = `> *${transcriptName(personaName)} `;
		line.appendChild(span);
		scrollToBottom(el);
	}

	// Helper: pace token emission
	function pace(): Promise<void> {
		const ms = TOKEN_PACE_MS * AI_TYPING_SPEED * (0.5 + Math.random());
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
		budgetEl.dataset.budget = String(remaining);
		budgetEl.textContent = formatBudget(remaining);
	}

	// Helper: update chat lockout status in the lockouts map
	function setChatLockout(aiId: AiId, locked: boolean): void {
		lockouts.set(aiId, locked);
		refreshComposerState();
		refreshTopInfo();
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
		appendPlayerLine(addressed, `> ${message}\n`);

		// Show a "thinking…" placeholder in the addressed panel while the
		// first live delta arrives. Stripped on the first onAiDelta call;
		// the safety-net strip after submitMessage handles mock/locked-AI paths.
		const addressedTranscript = getTranscript(addressed);
		const placeholderEl = doc.createElement("span");
		placeholderEl.className = "msg-placeholder";
		placeholderEl.textContent = "thinking…";
		if (addressedTranscript) {
			addressedTranscript.appendChild(placeholderEl);
			scrollToBottom(addressedTranscript);
		}
		const stripPlaceholder = (): void => {
			if (placeholderEl.parentNode) placeholderEl.remove();
		};

		// Roll initiative for this round
		const initiative = shuffle(Object.keys(session.getState().personas));

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
				const personaName = session?.getState().personas[aiId]?.name ?? aiId;
				appendAiPrefix(aiId, personaName);
				liveAis.add(aiId);
			}
			appendAiTokens(aiId, text);
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
							const sName = nextState.personas[event.aiId]?.name ?? event.aiId;
							appendAiPrefix(event.aiId, sName);
						}
						// If live, prefix was already painted; just track speakingAi.
						break;

					case "token":
						if (speakingAi) {
							if (!liveAis.has(speakingAi)) {
								// Synthetic path: append token and pace.
								appendAiTokens(speakingAi, event.text);
							}
							// Live path: text already painted; still await pace() so the
							// overall timing shape is preserved (important for token-pacing
							// tests and consistent UI behaviour).
							await pace();
						}
						break;

					case "ai_end":
						if (speakingAi) {
							appendAiTokens(speakingAi, "\n");
						}
						speakingAi = null;
						break;

					case "budget":
						updateBudget(event.aiId, event.remaining);
						break;

					case "lockout":
						appendStandaloneLine(event.aiId, `[${event.content}]\n`);
						break;

					case "chat_lockout":
						setChatLockout(event.aiId, true);
						appendStandaloneLine(event.aiId, `[${event.message}]\n`);
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
							phaseBannerEl.textContent = `Phase ${event.phase}: ${event.setting}`;
							phaseBannerEl.removeAttribute("hidden");
						}
						// Clear all transcript panels
						const advAiIds = Object.keys(nextState.personas);
						for (const aid of advAiIds) {
							const tEl = getTranscript(aid);
							if (tEl) tEl.textContent = "";
						}
						// Refresh budget displays from new phase
						const currentSession = session;
						if (currentSession) {
							const newPhase = getActivePhase(currentSession.getState());
							for (const aid of advAiIds) {
								const panel = doc.querySelector<HTMLElement>(
									`.ai-panel[data-ai="${aid}"]`,
								);
								if (!panel) continue;
								const budgetEl =
									panel.querySelector<HTMLSpanElement>(".panel-budget");
								if (budgetEl) {
									const b = newPhase.budgets[aid];
									if (b) {
										budgetEl.dataset.budget = String(b.remaining);
										budgetEl.textContent = formatBudget(b.remaining);
									}
								}
								// Re-enable chat-locked AIs that were carried over
								lockouts.set(aid, false);
							}
							refreshComposerState();
						}
						// Append phase separator to each transcript
						for (const aid of advAiIds) {
							appendStandaloneLine(
								aid,
								`--- Phase ${event.phase} begins: ${event.setting} ---\n`,
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
				for (const aiId of Object.keys(nextState.personas)) {
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
				const addressedName = nextState.personas[addressed]?.name ?? addressed;
				const persistedPrefix = `*${addressedName} `;
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
			if (!roundGameEnded) {
				refreshComposerState();
				refreshTopInfo();
			}
		}
	});

	// Return the async init promise so callers can await session readiness.
	// For the restore path (sync), returns an already-resolved promise.
	return asyncInitPromise ?? Promise.resolve();
}
