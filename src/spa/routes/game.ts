import { PHASE_1_CONFIG } from "../../content";
import { serializeGameSave } from "../../save-serializer.js";
import {
	BANNER,
	formatTopInfoMobile,
	initPanelChrome,
	type LoadState,
	renderTopInfoLeft,
	topInfoStatus,
} from "../bbs-chrome.js";
import { buildSessionFromAssets } from "../game/bootstrap.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { deriveComposerState } from "../game/composer-reducer.js";
import { getActivePhase, updateActivePhase } from "../game/engine.js";
import { GameSession } from "../game/game-session.js";
import {
	applyAddresseeChange,
	buildPersonaColorMap,
	buildPersonaDisplayNameMap,
	buildPersonaNameMap,
	findFirstMention,
} from "../game/mention-parser.js";
import {
	clearPendingBootstrap,
	getPendingBootstrap,
} from "../game/pending-bootstrap.js";
import { encodeRoundResult } from "../game/round-result-encoder.js";
import type { AiId, AiPersona, PhaseConfig } from "../game/types";
import { AI_TYPING_SPEED, TOKEN_PACE_MS } from "../game/typing-rhythm.js";
import { CapHitError } from "../llm-client.js";
import {
	clearActiveSession,
	getActiveSessionId,
	loadActiveSession,
	saveActiveSession,
} from "../persistence/session-storage.js";

/** Lowercased persona name for transcript prefixes (`> *ember <msg>`). */
function transcriptName(name: string): string {
	return name.toLowerCase();
}

/** Format a USD remaining amount as cents for the panel budget display
 * (e.g. 0.05 → "5.000¢"). Clamps negatives to zero. */
function formatBudget(remainingUsd: number): string {
	return `${(Math.max(0, remainingUsd) * 100).toFixed(3)}¢`;
}

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
	"legacy-save-discarded":
		"Saved game data from an older format has been discarded. Starting a new game.",
	unknown: "Game progress could not be saved due to an unexpected error.",
};

/** Guards against duplicate game_ended events re-binding handlers. */
let gameEnded = false;

let session: GameSession | null = null;
/** The session id `session` was last hydrated from. When the active-session
 * pointer moves (e.g. the user clicks Load on a different session in the
 * picker), this drifts from `getActiveSessionId()` and the next renderGame
 * drops the cache so the restore path runs against the new pointer. */
let cachedSessionId: string | null = null;

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

	// Drop the in-memory session cache if the active-session pointer no longer
	// matches what we hydrated from. This is what propagates a Load click in
	// the picker without a page refresh: the click writes a new active id and
	// re-enters this route, and the restore branch below picks up the new
	// session instead of re-rendering the stale closure-held one.
	if (session !== null && cachedSessionId !== getActiveSessionId()) {
		session = null;
		cachedSessionId = null;
		gameEnded = false;
		// Action log is live-only (no restore), so clear it for parity with
		// a hard refresh — otherwise entries from the previous session linger.
		if (actionLogList) actionLogList.textContent = "";
	}

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

	/** Update the `/*<handle>` indicator beside `root@hi-blue:` from the
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

	// Reasoning is disabled by default for routine daemon turns (see
	// BrowserLLMProvider). Dev-only `?think=1` opts the model's thinking
	// step back on for prompt-tuning. Gated to wrangler-dev (see isDevHost).
	//
	// Merge hash-query-string params (from the router) with location.search
	// params so flags like ?think=1, ?lockout=1, ?winImmediately=1 work whether
	// they appear in the search string (e.g. "/?lockout=1") or after the hash
	// (e.g. "/#/?lockout=1"). Hash params win on conflict.
	const effectiveParams = new URLSearchParams(location.search);
	if (params) {
		for (const [k, v] of params) effectiveParams.set(k, v);
	}
	const enableReasoning = isDevHost() && effectiveParams.get("think") === "1";

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

	/** Apply the three-phase load state on `#stage` so CSS can drive panel +
	 * status visuals. Removing the attribute (state="stable") restores the
	 * fully-bright "live" look. */
	function setStageLoadState(state: LoadState): void {
		const stageEl = doc.querySelector<HTMLElement>("#stage");
		if (!stageEl) return;
		if (state === "stable") {
			stageEl.removeAttribute("data-load-state");
			stageEl.style.removeProperty("--fill-pct");
		} else {
			stageEl.setAttribute("data-load-state", state);
		}
	}

	/** Paint the right-hand topinfo cell for one of the three load states.
	 * Used during progressive loading; the normal `refreshTopInfo` (session
	 * required) takes over once we transition to stable. */
	function renderLoadingTopInfo(state: LoadState): void {
		const topinfoLeftEl = doc.querySelector<HTMLElement>("#topinfo-left");
		const topinfoRightEl = doc.querySelector<HTMLElement>("#topinfo-right");
		const topinfoMobileEl = doc.querySelector<HTMLElement>("#topinfo-mobile");
		const topinfoMobileStatusEl = doc.querySelector<HTMLElement>(
			"#topinfo-mobile-status",
		);
		const status = topInfoStatus(state);
		const sessionIdLocal = getActiveSessionId() ?? "0x????";
		// Walk the phase chain to count total phases (matches refreshTopInfo).
		let total = 1;
		let cursor: PhaseConfig | undefined = PHASE_1_CONFIG.nextPhaseConfig;
		while (cursor) {
			total += 1;
			cursor = cursor.nextPhaseConfig;
		}
		const inputs = {
			sessionId: sessionIdLocal,
			phaseNumber: 1,
			totalPhases: total,
			turn: 0,
		};
		if (topinfoLeftEl) renderTopInfoLeft(topinfoLeftEl, inputs);
		if (topinfoRightEl) {
			topinfoRightEl.textContent = "";
			const span = doc.createElement("span");
			span.className = status.cls;
			span.textContent = status.desktop;
			topinfoRightEl.appendChild(span);
		}
		if (topinfoMobileEl) {
			topinfoMobileEl.textContent = formatTopInfoMobile(inputs);
		}
		if (topinfoMobileStatusEl) {
			topinfoMobileStatusEl.textContent = "";
			const span = doc.createElement("span");
			span.className = status.cls;
			span.textContent = ` ${status.mobile}`;
			topinfoMobileStatusEl.appendChild(span);
		}
	}

	/** Async loading flow: render an empty "loading daemons" screen
	 * immediately, populate panels with names + braille spinners when
	 * personas resolve, run a fake-progress brightness wipe while waiting
	 * for content packs, then build + persist the session and recurse into
	 * the normal restore path. */
	function renderBootstrapLoadingFlow(
		pending: ReturnType<typeof getPendingBootstrap> & object,
	): Promise<void> {
		// Show route chrome + global header now (start route hides them).
		const startScreenEl = doc.querySelector<HTMLElement>("#start-screen");
		const sessionsScreenEl = doc.querySelector<HTMLElement>("#sessions-screen");
		const panelsEl = doc.querySelector<HTMLElement>("#panels");
		const composerEl = doc.querySelector<HTMLElement>("#composer");
		if (startScreenEl) startScreenEl.setAttribute("hidden", "");
		if (sessionsScreenEl) sessionsScreenEl.setAttribute("hidden", "");
		if (panelsEl) panelsEl.removeAttribute("hidden");
		if (composerEl) composerEl.removeAttribute("hidden");
		const headerEl = doc.querySelector<HTMLElement>("#stage > header");
		const topinfoEl = doc.querySelector<HTMLElement>("#topinfo");
		const bannerWrapEl = doc.querySelector<HTMLElement>("#banner");
		if (headerEl) headerEl.removeAttribute("hidden");
		if (topinfoEl) topinfoEl.removeAttribute("hidden");
		if (bannerWrapEl) bannerWrapEl.removeAttribute("hidden");
		const bannerEl = doc.querySelector<HTMLElement>("#banner");
		if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;

		// Reset panels: clear any stale data-ai/persona-name from a previous
		// session so the loading frames render as empty shells.
		const panelEls = doc.querySelectorAll<HTMLElement>(".ai-panel");
		for (const panel of panelEls) {
			panel.removeAttribute("data-ai");
			panel.style.removeProperty("--panel-color");
			for (const lbl of panel.querySelectorAll<HTMLElement>(".panel-name")) {
				lbl.textContent = "";
			}
			const transcript = panel.querySelector<HTMLElement>(".transcript");
			if (transcript) {
				transcript.dataset.transcript = "";
				transcript.textContent = "";
			}
			const budgetEl = panel.querySelector<HTMLSpanElement>(".panel-budget");
			if (budgetEl) {
				budgetEl.dataset.budget = "";
				budgetEl.textContent = "";
			}
		}

		// Composer: visible but disabled with a "loading…" placeholder.
		_promptInput.disabled = true;
		_sendBtn.disabled = true;
		_promptInput.placeholder = "loading…";

		setStageLoadState("loading-daemons");
		renderLoadingTopInfo("loading-daemons");

		// Braille spinner machinery — duplicated from the round-submit path so
		// we can ride spinners on the panel-name labels while content packs
		// load (no session yet, so we can't share that closure).
		const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const SPINNER_INTERVAL_MS = 80;
		let spinnerInterval: ReturnType<typeof setInterval> | undefined;
		let wipeRaf: ReturnType<typeof requestAnimationFrame> | undefined;

		const cleanupLoadingTimers = (): void => {
			if (spinnerInterval) {
				clearInterval(spinnerInterval);
				spinnerInterval = undefined;
			}
			if (wipeRaf !== undefined) {
				cancelAnimationFrame(wipeRaf);
				wipeRaf = undefined;
			}
		};

		const startSpinners = (): void => {
			let frame = 0;
			spinnerInterval = setInterval(() => {
				frame = (frame + 1) % BRAILLE_FRAMES.length;
				const text = ` ${BRAILLE_FRAMES[frame] ?? ""}`;
				for (const sp of doc.querySelectorAll<HTMLElement>(
					".panel-name .panel-spinner",
				)) {
					sp.textContent = text;
				}
			}, SPINNER_INTERVAL_MS);
		};

		const startBrightnessWipe = (): void => {
			const stageEl = doc.querySelector<HTMLElement>("#stage");
			if (!stageEl) return;
			const startTs =
				typeof performance !== "undefined" ? performance.now() : Date.now();
			// τ chosen so the bright band reaches ~95% at ~3 min (target pack
			// load time) and ~99% at ~4.5 min, asymptotically capped at 99%
			// so the panel never visually completes until packs actually resolve.
			const TAU_MS = 60_000;
			const tick = (): void => {
				const now =
					typeof performance !== "undefined" ? performance.now() : Date.now();
				const elapsed = now - startTs;
				const eased = 1 - Math.exp(-elapsed / TAU_MS);
				const pct = Math.min(99, Math.max(0, eased * 100));
				stageEl.style.setProperty("--fill-pct", `${pct.toFixed(2)}%`);
				wipeRaf = requestAnimationFrame(tick);
			};
			wipeRaf = requestAnimationFrame(tick);
		};

		const buildLoadingPersonaShape = (
			personas: Record<AiId, AiPersona>,
		): void => {
			const ids = Object.keys(personas);
			panelEls.forEach((panel, idx) => {
				const aiId = ids[idx];
				if (!aiId) return;
				const persona = personas[aiId];
				if (!persona) return;
				panel.dataset.ai = aiId;
				panel.style.setProperty("--panel-color", persona.color);
				initPanelChrome(panel, persona);
				// Append a braille spinner span next to each persona name label.
				for (const labelEl of panel.querySelectorAll<HTMLElement>(
					".panel-name",
				)) {
					const sp = doc.createElement("span");
					sp.className = "panel-spinner";
					sp.textContent = ` ${BRAILLE_FRAMES[0] ?? ""}`;
					labelEl.appendChild(sp);
				}
			});
		};

		return pending.personasPromise
			.then((personas) => {
				buildLoadingPersonaShape(personas);
				setStageLoadState("generating-room");
				renderLoadingTopInfo("generating-room");
				startSpinners();
				startBrightnessWipe();
				return pending.contentPacksPromise.then((packs) => ({
					personas,
					contentPacks: packs,
				}));
			})
			.then((assets) => {
				cleanupLoadingTimers();
				let built = buildSessionFromAssets(assets);
				built = applyTestAffordances(built, effectiveParams);

				const saveResult = saveActiveSession(built.getState());
				if (!saveResult.ok) {
					showPersistenceWarning(saveResult.reason);
				}
				clearPendingBootstrap();

				// Strip braille spinners — initPanelChrome below will overwrite
				// .panel-name text content but spinners are appended children,
				// so clear them explicitly first.
				for (const sp of doc.querySelectorAll<HTMLElement>(
					".panel-name .panel-spinner",
				)) {
					sp.remove();
				}

				setStageLoadState("stable");

				// Re-enable composer; the recursive renderGame call below will
				// run refreshComposerState which re-derives sendBtn.disabled from
				// the current text + lockouts (start state: send disabled until
				// a valid mention is typed).
				_promptInput.disabled = false;
				_promptInput.placeholder = "";

				// Hand off to the normal populated path. Setting the module-scope
				// session var lets the recursive call skip both the loading branch
				// and the localStorage restore path.
				session = built;
				cachedSessionId = getActiveSessionId();
				return renderGame(root, params);
			})
			.catch((err: unknown) => {
				cleanupLoadingTimers();
				clearPendingBootstrap();
				if (err instanceof CapHitError && capHitEl) {
					capHitEl.removeAttribute("hidden");
					if (panelsEl) panelsEl.setAttribute("hidden", "");
					if (composerEl) composerEl.setAttribute("hidden", "");
					return;
				}
				// Anything else: bounce to start with a generic broken reason.
				clearActiveSession();
				if (typeof location !== "undefined") {
					location.hash = "#/start?reason=broken";
				}
			});
	}

	// Session restore path: load from active session pointer.
	// If no valid session → redirect to #/start.
	if (!session) {
		// Bootstrap-loading branch: the player just submitted CONNECT, the
		// session can't be built until content packs land, but we want them on
		// the main screen with progressive loading rather than stuck on dial-up.
		const pendingBootstrap = getPendingBootstrap();
		if (pendingBootstrap) {
			return renderBootstrapLoadingFlow(pendingBootstrap);
		}

		// Feature-detect localStorage availability (SecurityError in privacy mode).
		let storageAvailable = true;
		try {
			const probe = `hi-blue-storage-probe-${Math.random().toString(36).slice(2)}`;
			localStorage.setItem(probe, "1");
			localStorage.removeItem(probe);
		} catch {
			storageAvailable = false;
			showPersistenceWarning("unavailable");
		}

		if (!storageAvailable) {
			// Storage unavailable — can't restore or start; redirect to #/start
			// where user can see an error. (The warning is already shown above.)
			// For now, allow fall-through with no session so gameplay still works
			// if the start route already handled this case.
		} else {
			const activeId = getActiveSessionId();
			if (activeId === null) {
				// No active session pointer → redirect to #/start
				location.hash = "#/start";
				return Promise.resolve();
			}

			const loadResult = loadActiveSession();
			if (loadResult.kind === "ok") {
				const restoredState = loadResult.state;
				session = GameSession.restore(restoredState);
				cachedSessionId = loadResult.sessionId;

				// Re-render transcripts from restored state using conversationLogs.
				// (The new format stores conversation logs in daemon .txt files, not as
				// serialized transcript HTML, so we always use the conversationLogs path.)
				const restoredPhase = getActivePhase(restoredState);
				const restoredPersonas = restoredState.personas;
				const restorePanelEls = doc.querySelectorAll<HTMLElement>(".ai-panel");
				Object.keys(restoredPersonas).forEach((aiId, idx) => {
					const panel = restorePanelEls[idx];
					if (!panel) return;
					const transcript = panel.querySelector<HTMLElement>(".transcript");
					if (!transcript) return;
					// Always reset before re-populating: when the user clicks [load] on
					// a different Session in the picker, the panels keep the previous
					// session's transcript children. Clearing inside the entries-only
					// branch left them stale whenever the new session had fewer (or
					// zero) chat entries for this panel slot.
					transcript.textContent = "";
					// Filter to message entries where blue is involved (from blue or to blue)
					// Skip daemon-to-daemon messages from the player-facing transcript.
					const messageEntries = (
						restoredPhase.conversationLogs[aiId] ?? []
					).filter(
						(e) =>
							e.kind === "message" && (e.from === "blue" || e.to === "blue"),
					);
					if (messageEntries.length > 0) {
						// Synthesise from conversationLogs (stored in daemon .txt files).
						const persona = restoredPersonas[aiId];
						const personaName = persona?.name ?? aiId;
						for (const entry of messageEntries) {
							if (entry.kind !== "message") continue;
							const lineEl = doc.createElement("div");
							lineEl.className = "msg-line";
							if (entry.from === "blue") {
								// Incoming from player
								appendMentionAwareText(
									lineEl,
									`> ${entry.content}\n`,
									restoredPersonas,
									"msg-you",
								);
							} else {
								// Outgoing from AI to blue
								const prefixSpan = doc.createElement("span");
								prefixSpan.className = "msg-prefix";
								if (persona?.color) {
									prefixSpan.style.setProperty("--prefix-color", persona.color);
								}
								prefixSpan.textContent = `> *${transcriptName(personaName)} `;
								lineEl.appendChild(prefixSpan);
								appendMentionAwareText(
									lineEl,
									`${entry.content}\n`,
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
				// broken or version-mismatch or none — redirect to #/start with reason
				const reasonParam =
					loadResult.kind === "version-mismatch"
						? "version-mismatch"
						: "broken";
				clearActiveSession();
				location.hash = `#/start?reason=${reasonParam}`;
				return Promise.resolve();
			}
		}
	}

	// Synchronous post-init: runs for both the restore path AND the bootstrap-
	// recursive path (which already set session = built before re-entering).
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

	// Route-entry visibility: game route shows panels/composer and hides start-screen
	// and sessions-screen. The start route hides #panels and #composer on mount;
	// undo that here so the game UI is always visible when we commit to rendering
	// (all early-return paths above have already returned).
	const startScreenEl = doc.querySelector<HTMLElement>("#start-screen");
	const sessionsScreenEl = doc.querySelector<HTMLElement>("#sessions-screen");
	const panelsEl = doc.querySelector<HTMLElement>("#panels");
	const composerEl = doc.querySelector<HTMLElement>("#composer");
	if (startScreenEl) startScreenEl.setAttribute("hidden", "");
	if (sessionsScreenEl) sessionsScreenEl.setAttribute("hidden", "");
	if (panelsEl) panelsEl.removeAttribute("hidden");
	if (composerEl) composerEl.removeAttribute("hidden");
	// Restore the global chrome that the start route hides during the login takeover.
	const headerEl = doc.querySelector<HTMLElement>("#stage > header");
	const topinfoEl = doc.querySelector<HTMLElement>("#topinfo");
	const bannerWrapEl = doc.querySelector<HTMLElement>("#banner");
	if (headerEl) headerEl.removeAttribute("hidden");
	if (topinfoEl) topinfoEl.removeAttribute("hidden");
	if (bannerWrapEl) bannerWrapEl.removeAttribute("hidden");

	// Set initial composer state (Send starts disabled until a valid *mention).
	refreshComposerState();

	const aiIdList: string[] =
		session !== null ? Object.keys(session.getState().personas) : [];

	// Populate panel headers, ASCII border chrome, --panel-color, and budgets.
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
	// Active pointer is guaranteed to be set by the boot path above.
	const sessionId = getActiveSessionId() ?? "0x????";

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
		const inputs = {
			sessionId,
			phaseNumber: phase.phaseNumber,
			totalPhases: total,
			turn: phase.round,
		};
		renderTopInfoLeft(topinfoLeftEl, inputs);
		topinfoRightEl.textContent = "";
		const stableStatus = topInfoStatus("stable");
		const okSpan = doc.createElement("span");
		okSpan.className = stableStatus.cls;
		okSpan.textContent = stableStatus.desktop;
		topinfoRightEl.appendChild(okSpan);
		if (topinfoMobileEl) {
			topinfoMobileEl.textContent = formatTopInfoMobile(inputs);
		}
		// Reset the mobile status pill to "stable" — during progressive
		// loading we put loading/generating in #topinfo-mobile-status; this
		// brings it back to its normal green appearance once a session is live.
		const topinfoMobileStatusEl = doc.querySelector<HTMLElement>(
			"#topinfo-mobile-status",
		);
		if (topinfoMobileStatusEl) {
			topinfoMobileStatusEl.textContent = "";
			const sp = doc.createElement("span");
			sp.className = stableStatus.cls;
			sp.textContent = ` ${stableStatus.mobile}`;
			topinfoMobileStatusEl.appendChild(sp);
		}
	}

	refreshTopInfo();

	/** Register panel-click → addressee mention handlers for the given AI ids.
	 * Called synchronously for the restore path (session is set immediately). */
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

		const rawMessage = promptInput.value.trim();
		if (!rawMessage) return;

		// Strip a leading *DaemonName mention from the message so the player
		// line and the LLM submission carry only the body. Non-leading
		// mentions are left intact.
		const leadingMention = findFirstMention(rawMessage, personaNamesToId);
		const message =
			leadingMention !== null && leadingMention.start === 0
				? rawMessage.slice(leadingMention.end).trimStart()
				: rawMessage;
		if (!message) return;

		const addressed = addressee;
		roundInFlight = true;
		sendBtn.disabled = true;

		// Reset the input to the addressee prefix at send-time so it clears
		// immediately rather than waiting for all daemons to finish.
		const addressedNameNow =
			session.getState().personas[addressed]?.name ?? addressed;
		const persistedPrefix = `*${addressedNameNow} `;
		promptInput.value = persistedPrefix;
		promptInput.setSelectionRange(
			persistedPrefix.length,
			persistedPrefix.length,
		);
		promptInput.focus();
		// Programmatic value-set doesn't fire `input`, so the mention-highlight
		// overlay would keep showing the previous text. Refresh manually so
		// the overlay repaints to match the new prefix.
		refreshComposerState();

		// Append the (mention-stripped) player message to the addressed panel.
		appendPlayerLine(addressed, `> ${message}\n`);

		// Per-daemon braille spinners shown in the panel border, next to the
		// daemon name. Each persona gets a `.panel-spinner` span appended to
		// every `.panel-name` element in its panel (top + bottom brow). The
		// spinner ticks through BRAILLE_FRAMES; stripped per-daemon on first
		// delta, en-masse on safety-net / catch / finally.
		const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		const SPINNER_INTERVAL_MS = 80;
		const spinners = new Map<
			AiId,
			{ els: HTMLElement[]; intervalId: ReturnType<typeof setInterval> }
		>();
		for (const aiId of Object.keys(session.getState().personas) as AiId[]) {
			const panel = doc.querySelector<HTMLElement>(
				`.ai-panel[data-ai="${aiId}"]`,
			);
			if (!panel) continue;
			const els: HTMLElement[] = [];
			for (const labelEl of panel.querySelectorAll<HTMLElement>(
				".panel-name",
			)) {
				const sp = doc.createElement("span");
				sp.className = "panel-spinner";
				sp.textContent = ` ${BRAILLE_FRAMES[0] ?? ""}`;
				labelEl.appendChild(sp);
				els.push(sp);
			}
			if (els.length === 0) continue;
			let frame = 0;
			const intervalId = setInterval(() => {
				frame = (frame + 1) % BRAILLE_FRAMES.length;
				const text = ` ${BRAILLE_FRAMES[frame] ?? ""}`;
				for (const sp of els) sp.textContent = text;
			}, SPINNER_INTERVAL_MS);
			spinners.set(aiId, { els, intervalId });
		}
		const stripSpinner = (aiId: AiId): void => {
			const s = spinners.get(aiId);
			if (!s) return;
			clearInterval(s.intervalId);
			for (const el of s.els) {
				if (el.parentNode) el.remove();
			}
			spinners.delete(aiId);
		};
		const stripAllSpinners = (): void => {
			for (const aiId of [...spinners.keys()]) stripSpinner(aiId);
		};

		// Roll initiative for this round
		const initiative = shuffle(Object.keys(session.getState().personas));

		// Round-local ended flag (distinct from module-level gameEnded)
		let roundGameEnded = false;

		// Track first-delta-seen per AI to strip the spinner exactly once.
		const firstDeltaSeen = new Set<AiId>();

		const onAiDelta = (aiId: AiId, _text: string): void => {
			if (!firstDeltaSeen.has(aiId)) {
				firstDeltaSeen.add(aiId);
				// Strip this daemon's spinner on its first live delta.
				// Post-#213, free-form assistantText is dropped by the engine; actual
				// panel content comes from ConversationEntry message events emitted
				// by the encoder after the round completes. We keep the spinner-strip
				// side-effect here but no longer paint tokens or the AI prefix live.
				stripSpinner(aiId);
			}
			// Free-form delta text is intentionally NOT painted. Panel content is
			// driven by encoder "message" events (conversationLog-based) after the
			// round, ensuring the DM-thread filter (AC #1/2) is always applied.
		};

		try {
			const provider = new BrowserLLMProvider({
				disableReasoning: !enableReasoning,
			});
			const { result, completions, nextState } = await session.submitMessage(
				addressed,
				message,
				provider,
				undefined,
				initiative,
				onAiDelta,
			);

			// Safety-net strip: if no live deltas arrived (mock provider, all AIs
			// locked out, or first delta hasn't fired yet), strip every spinner now.
			stripAllSpinners();

			const phaseAfter = getActivePhase(nextState);
			const events = encodeRoundResult(
				result,
				completions,
				phaseAfter,
				nextState.personas,
			);

			for (const event of events) {
				switch (event.type) {
					case "ai_start":
						// Track the current daemon for budget/lockout events.
						// Panel content is now driven by "message" events, not prefixes.
						break;

					case "token":
						// Token events are no longer emitted by the encoder post-#214.
						// This case is retained for forward-compatibility / safety.
						break;

					case "message": {
						// DM-thread panel painting (AC #1/2/3/4).
						// Only paint daemon→player messages here. The player's own line is
						// written eagerly at submit time (line ~1149) and must NOT be written
						// again from the encoder event — that would double-render it.
						if (event.to === "blue") {
							// Daemon's outgoing message to player (AC #4): existing treatment.
							const daemonId = event.from as AiId;
							const pName = nextState.personas[daemonId]?.name ?? daemonId;
							appendAiPrefix(daemonId, pName);
							appendAiTokens(daemonId, `${event.content}\n`);
						}
						// event.from === "blue" case intentionally omitted: the submit handler
						// already painted the player's line via appendPlayerLine at submit time.
						// No per-message pace() — message events are complete utterances,
						// not per-token chunks. Post-#213 AI speech is tool-call-based so
						// the encoder emits one message event per turn; pacing here would
						// cause test timeouts without a streaming-feel benefit.
						break;
					}

					case "ai_end":
						// No trailing newline needed — message events include their own \n.
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
						clearActiveSession();

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
						cachedSessionId = null;
						break;
					}
				}
			}

			// Persist state after the encoder render loop completes.
			// Conversation logs are stored in daemon .txt files; the transcript HTML
			// is not serialized (restores use conversationLogs path).
			if (!roundGameEnded) {
				const saveResult = saveActiveSession(nextState);
				if (!saveResult.ok) {
					showPersistenceWarning(saveResult.reason);
				}
			}
		} catch (err) {
			stripAllSpinners();
			if (err instanceof CapHitError && capHitEl) {
				capHitEl.removeAttribute("hidden");
			}
		} finally {
			stripAllSpinners();
			roundInFlight = false;
			if (!roundGameEnded) {
				refreshComposerState();
				refreshTopInfo();
			}
		}
	});

	return Promise.resolve();
}
