import { serializeGameSave } from "../../save-serializer.js";
import {
	BANNER,
	formatTopInfoMobile,
	initPanelChrome,
	type LoadState,
	renderTopInfoLeft,
	topInfoStatus,
} from "../bbs-chrome.js";
import {
	recordDaemonError,
	recordDaemonRound,
	recordDaemonSystemPrompt,
	recordDaemonTurnResult,
	setDaemonFooterInFlight,
	updateDaemonFooterDetails,
	updateDaemonFooterSummary,
} from "../dev-inspector/daemon-footer.js";
import { updateGameStripSummary } from "../dev-inspector/game-strip.js";
import { renderInspector } from "../dev-inspector/index.js";
import { updateWorldMap } from "../dev-inspector/world-map.js";
import {
	buildSameDaemonsSession,
	buildSessionFromAssets,
} from "../game/bootstrap.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { isPlayerChatLockedOut } from "../game/complication-engine.js";
import { deriveComposerState } from "../game/composer-reducer.js";
import { appendBroadcast } from "../game/engine.js";
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
	restartContentPacks,
} from "../game/pending-bootstrap.js";
import type {
	LifecyclePhase,
	RoundLLMProvider,
} from "../game/round-llm-provider.js";
import { encodeRoundResult } from "../game/round-result-encoder.js";
import { getSpikeRng } from "../game/spike-seed.js";
import type {
	AiId,
	AiPersona,
	ConversationEntry,
	GameState,
} from "../game/types";
import { AI_TYPING_SPEED, TOKEN_PACE_MS } from "../game/typing-rhythm.js";
import { CapHitError } from "../llm-client.js";
import {
	archiveSession,
	clearActiveSession,
	deactivateActiveSession,
	getActiveSessionId,
	loadActiveSession,
	mintAndActivateNewSession,
	saveActiveSession,
} from "../persistence/session-storage.js";
import { type RenderOpts, renderApp } from "../render-app.js";

export const BOOTSTRAP_LOADING_TIMEOUT_MS = 300_000;

const PLAYER_ID = "blue";
const LOADING_PLACEHOLDER = "loading…";
const UNSET_PROMPT_TARGET = "/?????";
const UNKNOWN_SESSION_ID = "0x????";
const BRAILLE_SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];
const SPINNER_INTERVAL_MS = 80;
const BRIGHTNESS_WIPE_TAU_MS = 60_000;
const BRIGHTNESS_WIPE_MAX_PCT = 99;

function transcriptName(name: string): string {
	return name.toLowerCase();
}

function formatBudgetAsCents(remainingUsd: number): string {
	return `${(Math.max(0, remainingUsd) * 100).toFixed(3)}¢`;
}

function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionRegex(
	personas: Record<string, { name: string }>,
): RegExp | null {
	const names = Object.values(personas)
		.map((p) => p.name)
		.filter((n) => n.length > 0);
	if (names.length === 0) return null;
	const optionalStarThenWholeName = `\\*?\\b(?:${names.map(escapeRegExp).join("|")})\\b`;
	return new RegExp(optionalStarThenWholeName, "gi");
}

function appendMentionAwareText(
	parent: HTMLElement,
	text: string,
	personas: Record<string, { name: string; color?: string }>,
	nonMentionClass?: string,
): void {
	if (!text) return;
	const doc = parent.ownerDocument;
	const personaList = Object.values(personas);
	const appendNonMentionChunk = (chunk: string): void => {
		if (!chunk) return;
		if (nonMentionClass) {
			const span = doc.createElement("span");
			span.className = nonMentionClass;
			span.textContent = chunk;
			parent.appendChild(span);
		} else {
			parent.appendChild(doc.createTextNode(chunk));
		}
	};
	const mentionRegex = buildMentionRegex(personas);
	if (!mentionRegex) {
		appendNonMentionChunk(text);
		return;
	}
	let lastIdx = 0;
	for (
		let m = mentionRegex.exec(text);
		m !== null;
		m = mentionRegex.exec(text)
	) {
		appendNonMentionChunk(text.slice(lastIdx, m.index));
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
	appendNonMentionChunk(text.slice(lastIdx));
}

function fisherYatesShuffledCopy<T>(arr: T[]): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = out[i] as T;
		out[i] = out[j] as T;
		out[j] = tmp;
	}
	return out;
}

function isDevHost(): boolean {
	return (
		__WORKER_BASE_URL__ === "http://localhost:8787" &&
		typeof location !== "undefined" &&
		location.origin === __WORKER_BASE_URL__
	);
}

export function applyTestAffordances(
	gameSession: GameSession,
	searchParams: URLSearchParams,
): GameSession {
	if (!isDevHost()) return gameSession;

	const wantsImmediateWin = searchParams.get("winImmediately") === "1";
	if (!wantsImmediateWin) return gameSession;

	const originalSubmit = gameSession.submitMessage.bind(gameSession);
	gameSession.submitMessage = async (...args) => {
		const result = await originalSubmit(...args);
		return {
			...result,
			result: { ...result.result, gameEnded: true },
			nextState: {
				...result.nextState,
				isComplete: true,
				outcome: "win" as const,
			},
		};
	};

	return gameSession;
}

class BootstrapTimeoutError extends Error {
	constructor() {
		super("bootstrap loading timed out");
		this.name = "BootstrapTimeoutError";
	}
}

function withBootstrapTimeout<T>(work: Promise<T>): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			reject(new BootstrapTimeoutError());
		}, BOOTSTRAP_LOADING_TIMEOUT_MS);
	});
	return Promise.race([work, timeout]).finally(() => {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	});
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function brailleFrameText(frame: number): string {
	return ` ${BRAILLE_SPINNER_FRAMES[frame] ?? ""}`;
}

function appendPanelSpinners(panel: HTMLElement): HTMLElement[] {
	const doc = panel.ownerDocument;
	const spinnerEls: HTMLElement[] = [];
	for (const labelEl of panel.querySelectorAll<HTMLElement>(".panel-name")) {
		const spinnerEl = doc.createElement("span");
		spinnerEl.className = "panel-spinner";
		spinnerEl.textContent = brailleFrameText(0);
		labelEl.appendChild(spinnerEl);
		spinnerEls.push(spinnerEl);
	}
	return spinnerEls;
}

function removeAllPanelSpinners(doc: Document): void {
	for (const spinnerEl of doc.querySelectorAll<HTMLElement>(
		".panel-name .panel-spinner",
	)) {
		spinnerEl.remove();
	}
}

function dropListenersByCloning(el: Element): void {
	el.replaceWith(el.cloneNode(true));
}

function revealGameRouteChrome(doc: Document): void {
	for (const selector of ["#start-screen", "#sessions-screen"]) {
		doc.querySelector<HTMLElement>(selector)?.setAttribute("hidden", "");
	}
	for (const selector of [
		"#panels",
		"#composer",
		"#stage > header",
		"#topinfo",
		"#banner",
	]) {
		doc.querySelector<HTMLElement>(selector)?.removeAttribute("hidden");
	}
}

function resetPanelsToEmptyShells(panelEls: NodeListOf<HTMLElement>): void {
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
}

function dismissStaleBootstrapRecovery(doc: Document): void {
	const recoveryEl = doc.querySelector<HTMLElement>("#bootstrap-recovery");
	if (!recoveryEl) return;
	recoveryEl.setAttribute("hidden", "");
	const staleRegenBtn = doc.querySelector<HTMLButtonElement>(
		"#bootstrap-recovery-regen",
	);
	if (staleRegenBtn) dropListenersByCloning(staleRegenBtn);
	const staleAbandonLink = doc.querySelector<HTMLAnchorElement>(
		"#bootstrap-recovery-abandon",
	);
	if (staleAbandonLink) dropListenersByCloning(staleAbandonLink);
}

function isLocalStorageAvailable(): boolean {
	try {
		const probe = `hi-blue-storage-probe-${Math.random().toString(36).slice(2)}`;
		localStorage.setItem(probe, "1");
		localStorage.removeItem(probe);
		return true;
	} catch {
		return false;
	}
}

function scrollTranscriptToBottom(transcriptEl: HTMLElement | null): void {
	const scrollContainer = transcriptEl?.parentElement;
	if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

type MessageEntry = Extract<ConversationEntry, { kind: "message" }>;

function isPlayerFacingMessage(
	entry: ConversationEntry,
): entry is MessageEntry {
	return (
		entry.kind === "message" &&
		(entry.from === PLAYER_ID || entry.to === PLAYER_ID)
	);
}

function repaintRestoredTranscripts(
	doc: Document,
	restoredState: GameState,
): void {
	const restoredPersonas = restoredState.personas;
	const restorePanelEls = doc.querySelectorAll<HTMLElement>(".ai-panel");
	Object.keys(restoredPersonas).forEach((aiId, idx) => {
		const panel = restorePanelEls[idx];
		if (!panel) return;
		const transcript = panel.querySelector<HTMLElement>(".transcript");
		if (!transcript) return;
		transcript.textContent = "";
		const visibleEntries = (restoredState.conversationLogs[aiId] ?? []).filter(
			isPlayerFacingMessage,
		);
		const persona = restoredPersonas[aiId];
		const personaName = persona?.name ?? aiId;
		for (const entry of visibleEntries) {
			const lineEl = doc.createElement("div");
			lineEl.className = "msg-line";
			if (entry.from === PLAYER_ID) {
				appendMentionAwareText(
					lineEl,
					`> ${entry.content}\n`,
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
				appendMentionAwareText(lineEl, `${entry.content}\n`, restoredPersonas);
			}
			transcript.appendChild(lineEl);
		}
	});

	requestAnimationFrame(() => {
		for (const panel of restorePanelEls) {
			scrollTranscriptToBottom(panel.querySelector<HTMLElement>(".transcript"));
		}
	});
}

function paintDesktopStatus(
	el: HTMLElement,
	status: ReturnType<typeof topInfoStatus>,
): void {
	el.textContent = "";
	const span = el.ownerDocument.createElement("span");
	span.className = status.cls;
	span.textContent = status.desktop;
	el.appendChild(span);
}

function paintMobileStatusPill(
	el: HTMLElement,
	status: ReturnType<typeof topInfoStatus>,
): void {
	el.textContent = "";
	const span = el.ownerDocument.createElement("span");
	span.className = status.cls;
	span.textContent = ` ${status.mobile}`;
	el.appendChild(span);
}

function trySetCaret(input: HTMLInputElement, position: number): void {
	try {
		input.setSelectionRange(position, position);
	} catch {}
}

type ComposerState = ReturnType<typeof deriveComposerState>;

function paintPanelAddressingAndLockouts(
	doc: Document,
	aiIds: Iterable<AiId>,
	state: ComposerState,
): void {
	for (const aiId of aiIds) {
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
}

function paintLockoutError(doc: Document, lockoutError: string | null): void {
	const lockoutErrorEl = doc.querySelector<HTMLOutputElement>("#lockout-error");
	if (!lockoutErrorEl) return;
	if (lockoutError) {
		lockoutErrorEl.textContent = lockoutError;
		lockoutErrorEl.removeAttribute("hidden");
	} else {
		lockoutErrorEl.textContent = "";
		lockoutErrorEl.setAttribute("hidden", "");
	}
}

function setRoundInFlightMarker(doc: Document, inFlight: boolean): void {
	const stageEl = doc.querySelector<HTMLElement>("#stage");
	if (inFlight) stageEl?.setAttribute("data-round-in-flight", "true");
	else stageEl?.removeAttribute("data-round-in-flight");
}

function hideRoundError(doc: Document): void {
	const roundErrorEl = doc.querySelector<HTMLOutputElement>("#round-error");
	if (!roundErrorEl) return;
	roundErrorEl.textContent = "";
	roundErrorEl.setAttribute("hidden", "");
}

function showRoundError(doc: Document): void {
	const roundErrorEl = doc.querySelector<HTMLOutputElement>("#round-error");
	if (!roundErrorEl) return;
	roundErrorEl.textContent = "the daemons stuttered — try again";
	roundErrorEl.removeAttribute("hidden");
}

function stripLeadingMention(
	rawMessage: string,
	personaNamesToId: ReturnType<typeof buildPersonaNameMap>,
): string {
	const leadingMention = findFirstMention(rawMessage, personaNamesToId);
	return leadingMention !== null && leadingMention.start === 0
		? rawMessage.slice(leadingMention.end).trimStart()
		: rawMessage;
}

function withDevInspectorRecording(
	rawProvider: RoundLLMProvider,
	gameSession: GameSession,
): RoundLLMProvider {
	return {
		streamRound: async (messages, tools, onDelta, daemonId, onLifecycle) => {
			if (daemonId && messages[0]?.role === "system") {
				recordDaemonSystemPrompt(daemonId, messages[0].content);
				recordDaemonRound(daemonId, gameSession.getState().round);
			}
			const result = await rawProvider.streamRound(
				messages,
				tools,
				onDelta,
				daemonId,
				onLifecycle,
			);
			if (daemonId) {
				recordDaemonTurnResult(daemonId, {
					...result,
					lastRawCompletion: result.assistantText,
					lastToolCalls: result.toolCalls.map((tc) => ({
						name: tc.name,
						argumentsJson: tc.argumentsJson,
					})),
				});
			}
			return result;
		},
	};
}

function updateDaemonFooterOnLifecycle(event: LifecyclePhase): void {
	if (!event.daemonId) return;
	const panel = document.querySelector<HTMLElement>(
		`.ai-panel[data-ai="${event.daemonId}"]`,
	);
	if (!panel) return;
	switch (event.phase) {
		case "started":
			setDaemonFooterInFlight(panel, "in-flight");
			break;
		case "completed":
			setDaemonFooterInFlight(panel, "idle");
			break;
		case "errored":
			setDaemonFooterInFlight(panel, "errored");
			recordDaemonError(event.daemonId, event.error);
			break;
		case "first-token":
			break;
	}
}

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

let gameEndHandled = false;

let session: GameSession | null = null;
let hydratedSessionId: string | null = null;
let hydratedEpoch: number = 1;

export function renderGame(
	root: HTMLElement,
	opts?: RenderOpts,
): Promise<void> {
	const doc = root.ownerDocument;
	const form = doc.querySelector<HTMLFormElement>("#composer");
	const promptInput = doc.querySelector<HTMLInputElement>("#prompt");
	const sendBtn = doc.querySelector<HTMLButtonElement>("#send");
	const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
	const persistenceWarningEl = doc.querySelector<HTMLElement>(
		"#persistence-warning",
	);

	if (!form || !promptInput || !sendBtn) return Promise.resolve();

	const activePointerMoved =
		session !== null && hydratedSessionId !== getActiveSessionId();
	if (activePointerMoved) {
		session = null;
		hydratedSessionId = null;
		gameEndHandled = false;
	}

	let personaNamesToId: ReturnType<typeof buildPersonaNameMap>;
	let personaColors: ReturnType<typeof buildPersonaColorMap>;
	let personaDisplayNames: ReturnType<typeof buildPersonaDisplayNameMap>;
	const lockouts: Map<AiId, boolean> = new Map();
	let roundInFlight = false;
	let connectionUnstable = false;

	const composerInput: HTMLInputElement = promptInput;
	const composerSendBtn: HTMLButtonElement = sendBtn;

	const mentionOverlay = doc.querySelector<HTMLElement>("#prompt-overlay");
	const promptTargetEl = doc.querySelector<HTMLElement>(".prompt-target");

	function refreshPromptTarget(addressee: AiId | null): void {
		if (!promptTargetEl) return;
		if (addressee == null) {
			promptTargetEl.textContent = UNSET_PROMPT_TARGET;
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

	function setPanelColor(el: HTMLElement, color: string | null): void {
		if (color != null) {
			el.style.setProperty("--panel-color", color);
		} else {
			el.style.removeProperty("--panel-color");
		}
	}

	function rebuildMentionOverlay(
		ov: HTMLElement | null,
		text: string,
		highlight: { start: number; end: number; color: string } | null,
	): void {
		if (!ov) return;
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
			text: composerInput.value,
			lockouts,
			personaNamesToId,
			personaColors,
			personaDisplayNames,
		});
		composerSendBtn.disabled = !state.sendEnabled || roundInFlight;
		setPanelColor(composerInput, state.borderColor);
		paintPanelAddressingAndLockouts(doc, personaColors.keys(), state);
		paintLockoutError(doc, state.lockoutError);
		rebuildMentionOverlay(
			mentionOverlay,
			composerInput.value,
			state.mentionHighlight,
		);
		if (mentionOverlay) mentionOverlay.scrollLeft = composerInput.scrollLeft;
		refreshPromptTarget(state.addressee);
	}

	promptInput.addEventListener("input", refreshComposerState);
	promptInput.addEventListener("scroll", () => {
		if (mentionOverlay) mentionOverlay.scrollLeft = composerInput.scrollLeft;
	});

	const searchParams = new URLSearchParams(location.search);
	const enableReasoning = isDevHost() && searchParams.get("think") === "1";

	function showPersistenceWarning(reason: string): void {
		if (!persistenceWarningEl) return;
		const msg =
			PERSISTENCE_WARNING_MESSAGES[reason] ??
			PERSISTENCE_WARNING_MESSAGES.unknown ??
			"Game progress could not be saved.";
		persistenceWarningEl.textContent = msg;
		persistenceWarningEl.removeAttribute("hidden");
	}

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

	function renderLoadingTopInfo(state: LoadState): void {
		const topinfoLeftEl = doc.querySelector<HTMLElement>("#topinfo-left");
		const topinfoRightEl = doc.querySelector<HTMLElement>("#topinfo-right");
		const topinfoMobileEl = doc.querySelector<HTMLElement>("#topinfo-mobile");
		const topinfoMobileStatusEl = doc.querySelector<HTMLElement>(
			"#topinfo-mobile-status",
		);
		const status = topInfoStatus(state);
		const inputs = {
			sessionId: getActiveSessionId() ?? UNKNOWN_SESSION_ID,
			epoch: hydratedEpoch,
			turn: 0,
		};
		if (topinfoLeftEl) renderTopInfoLeft(topinfoLeftEl, inputs);
		if (topinfoRightEl) paintDesktopStatus(topinfoRightEl, status);
		if (topinfoMobileEl) {
			topinfoMobileEl.textContent = formatTopInfoMobile(inputs);
		}
		if (topinfoMobileStatusEl) {
			paintMobileStatusPill(topinfoMobileStatusEl, status);
		}
	}

	function showComposerAsLoading(): void {
		composerInput.disabled = true;
		composerInput.placeholder = LOADING_PLACEHOLDER;
	}

	function renderBootstrapLoadingFlow(
		pending: ReturnType<typeof getPendingBootstrap> & object,
	): Promise<void> {
		revealGameRouteChrome(doc);
		const panelsEl = doc.querySelector<HTMLElement>("#panels");
		const composerEl = doc.querySelector<HTMLElement>("#composer");
		const bannerEl = doc.querySelector<HTMLElement>("#banner");
		if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;

		const panelEls = doc.querySelectorAll<HTMLElement>(".ai-panel");
		resetPanelsToEmptyShells(panelEls);

		showComposerAsLoading();
		composerSendBtn.disabled = true;

		setStageLoadState("loading-daemons");
		renderLoadingTopInfo("loading-daemons");

		if (__DEV__) {
			renderInspector(root, { pendingBootstrap: pending });
		}

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
				frame = (frame + 1) % BRAILLE_SPINNER_FRAMES.length;
				const text = brailleFrameText(frame);
				for (const spinnerEl of doc.querySelectorAll<HTMLElement>(
					".panel-name .panel-spinner",
				)) {
					spinnerEl.textContent = text;
				}
			}, SPINNER_INTERVAL_MS);
		};

		const startBrightnessWipe = (): void => {
			const stageEl = doc.querySelector<HTMLElement>("#stage");
			if (!stageEl) return;
			const startTs = nowMs();
			const tick = (): void => {
				const elapsed = nowMs() - startTs;
				const eased = 1 - Math.exp(-elapsed / BRIGHTNESS_WIPE_TAU_MS);
				const pct = Math.min(BRIGHTNESS_WIPE_MAX_PCT, Math.max(0, eased * 100));
				stageEl.style.setProperty("--fill-pct", `${pct.toFixed(2)}%`);
				wipeRaf = requestAnimationFrame(tick);
			};
			wipeRaf = requestAnimationFrame(tick);
		};

		const paintLoadingPersonaPanels = (
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
				appendPanelSpinners(panel);
			});
		};

		const runBootstrapChain = (
			pendingBootstrap: ReturnType<typeof getPendingBootstrap> & object,
		): Promise<void> => {
			const bootstrapPromise = pendingBootstrap.personasPromise
				.then((personas) => {
					paintLoadingPersonaPanels(personas);
					setStageLoadState("generating-room");
					renderLoadingTopInfo("generating-room");
					if (__DEV__) {
						renderInspector(root, { pendingBootstrap });
					}
					startSpinners();
					startBrightnessWipe();
					return pendingBootstrap.contentPacksPromise.then(
						({ packsA, packsB, objectiveTypes }) => ({
							personas,
							contentPacksA: packsA,
							contentPacksB: packsB,
							objectiveTypes,
						}),
					);
				})
				.then((assets) => {
					cleanupLoadingTimers();
					const gameSessionRng = getSpikeRng("gameSession");
					let built = buildSessionFromAssets(
						assets,
						gameSessionRng ? { rng: gameSessionRng } : undefined,
					);
					built = applyTestAffordances(built, searchParams);

					const bootstrapInvalidatedMidFlight =
						loadActiveSession().kind !== "none";
					if (bootstrapInvalidatedMidFlight) {
						clearPendingBootstrap();
						renderApp(root);
						return;
					}

					const saveResult = saveActiveSession(built.getState());
					if (!saveResult.ok) {
						showPersistenceWarning(saveResult.reason);
					}
					clearPendingBootstrap();

					removeAllPanelSpinners(doc);
					dismissStaleBootstrapRecovery(doc);
					setStageLoadState("stable");

					composerInput.disabled = false;
					composerInput.placeholder = "";

					session = built;
					hydratedSessionId = getActiveSessionId();
					return renderGame(root, opts);
				});

			return withBootstrapTimeout(bootstrapPromise);
		};

		return runBootstrapChain(pending).catch(async (err: unknown) => {
			cleanupLoadingTimers();

			if (__DEV__) {
				renderInspector(root, { pendingBootstrap: pending });
			}

			if (err instanceof CapHitError && capHitEl) {
				capHitEl.removeAttribute("hidden");
				if (panelsEl) panelsEl.setAttribute("hidden", "");
				if (composerEl) composerEl.setAttribute("hidden", "");
				return;
			}

			const recoveryEl = doc.querySelector<HTMLElement>("#bootstrap-recovery");
			const recoveryTitleEl = doc.querySelector<HTMLElement>(
				"#bootstrap-recovery-title",
			);
			const recoveryBodyEl = doc.querySelector<HTMLElement>(
				"#bootstrap-recovery-body",
			);
			const regenBtn = doc.querySelector<HTMLButtonElement>(
				"#bootstrap-recovery-regen",
			);
			const abandonLink = doc.querySelector<HTMLAnchorElement>(
				"#bootstrap-recovery-abandon",
			);

			const recoveryUiMissing =
				!recoveryEl || !recoveryTitleEl || !recoveryBodyEl;
			if (recoveryUiMissing) {
				clearActiveSession();
				clearPendingBootstrap();
				renderApp(root, { reason: "broken" });
				return;
			}

			const timedOut = err instanceof BootstrapTimeoutError;
			if (timedOut) {
				recoveryTitleEl.textContent = "the room is taking too long";
				recoveryBodyEl.textContent =
					"the world generation timed out. try regenerating with the same daemons, or abandon and reconnect.";
			} else {
				recoveryTitleEl.textContent = "the room collapsed";
				recoveryBodyEl.textContent =
					"the world we tried to build was malformed. try regenerating with the same daemons, or abandon and reconnect.";
			}

			recoveryEl.removeAttribute("hidden");
			if (panelsEl) panelsEl.setAttribute("hidden", "");
			if (composerEl) composerEl.setAttribute("hidden", "");
			setStageLoadState("unstable");

			if (regenBtn) {
				regenBtn.disabled = false;
				const runRegenerate = async (): Promise<void> => {
					recoveryEl.setAttribute("hidden", "");
					const persistenceWarningEl = doc.querySelector<HTMLElement>(
						"#persistence-warning",
					);
					if (persistenceWarningEl)
						persistenceWarningEl.setAttribute("hidden", "");

					if (panelsEl) panelsEl.removeAttribute("hidden");
					if (composerEl) composerEl.removeAttribute("hidden");
					showComposerAsLoading();

					regenBtn.disabled = true;

					const pendingWithCachedPersonas = restartContentPacks();

					try {
						await runBootstrapChain(pendingWithCachedPersonas);
					} catch (regenErr: unknown) {
						cleanupLoadingTimers();

						if (regenErr instanceof CapHitError && capHitEl) {
							capHitEl.removeAttribute("hidden");
							recoveryEl.setAttribute("hidden", "");
							if (panelsEl) panelsEl.setAttribute("hidden", "");
							if (composerEl) composerEl.setAttribute("hidden", "");
							return;
						}

						recoveryEl.removeAttribute("hidden");
						if (panelsEl) panelsEl.setAttribute("hidden", "");
						if (composerEl) composerEl.setAttribute("hidden", "");
						setStageLoadState("unstable");
						regenBtn.disabled = false;
					}
				};

				dropListenersByCloning(regenBtn);
				const newRegenBtn = doc.querySelector<HTMLButtonElement>(
					"#bootstrap-recovery-regen",
				);
				if (newRegenBtn) {
					newRegenBtn.addEventListener("click", (e) => {
						e.preventDefault();
						void runRegenerate();
					});
				}
			}

			if (abandonLink) {
				dropListenersByCloning(abandonLink);
				const newAbandonLink = doc.querySelector<HTMLAnchorElement>(
					"#bootstrap-recovery-abandon",
				);
				if (newAbandonLink) {
					newAbandonLink.addEventListener("click", (e) => {
						e.preventDefault();
						clearActiveSession();
						clearPendingBootstrap();
						renderApp(root, { reason: "broken" });
					});
				}
			}
		});
	}

	if (!session) {
		const pendingBootstrap = getPendingBootstrap();
		if (pendingBootstrap) {
			const activeSessionIsEmpty = loadActiveSession().kind === "none";
			if (activeSessionIsEmpty) {
				return renderBootstrapLoadingFlow(pendingBootstrap);
			}
			clearPendingBootstrap();
			renderApp(root);
			return Promise.resolve();
		}

		const storageAvailable = isLocalStorageAvailable();
		if (!storageAvailable) {
			showPersistenceWarning("unavailable");
		} else {
			const noActiveSessionPointer = getActiveSessionId() === null;
			if (noActiveSessionPointer) {
				renderApp(root);
				return Promise.resolve();
			}

			const loadResult = loadActiveSession();
			if (loadResult.kind === "ok") {
				session = GameSession.restore(loadResult.state);
				hydratedSessionId = loadResult.sessionId;
				hydratedEpoch = loadResult.epoch;
				repaintRestoredTranscripts(doc, loadResult.state);
			} else {
				const reasonParam: "broken" | "version-mismatch" =
					loadResult.kind === "version-mismatch"
						? "version-mismatch"
						: "broken";
				const schemaVersion =
					loadResult.kind === "version-mismatch"
						? loadResult.schemaVersion
						: undefined;
				if (loadResult.kind === "version-mismatch") {
					deactivateActiveSession();
				} else {
					clearActiveSession();
				}
				renderApp(root, {
					reason: reasonParam,
					...(schemaVersion !== undefined ? { schemaVersion } : {}),
				});
				return Promise.resolve();
			}
		}
	}

	if (session !== null) {
		session = applyTestAffordances(session, searchParams);

		const runtimePersonas = session.getState().personas;
		personaNamesToId = buildPersonaNameMap(runtimePersonas);
		personaColors = buildPersonaColorMap(runtimePersonas);
		personaDisplayNames = buildPersonaDisplayNameMap(runtimePersonas);

		const sessionState = session.getState();
		for (const aiId of Object.keys(runtimePersonas)) {
			lockouts.set(aiId, isPlayerChatLockedOut(sessionState, aiId));
		}

		gameEndHandled = false;
	}

	revealGameRouteChrome(doc);

	const aiIdList: string[] =
		session !== null ? Object.keys(session.getState().personas) : [];

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
			const gameState = sessionRef.getState();
			if (budgetEl) {
				const budget = gameState.budgets[aiId];
				if (budget) {
					budgetEl.dataset.budget = String(budget.remaining);
					budgetEl.textContent = formatBudgetAsCents(budget.remaining);
				}
			}
		});

		const handlesPlaceholder = Object.values(session.getState().personas)
			.map((p) => `*${p.name}`)
			.join(" | ");
		if (handlesPlaceholder)
			composerInput.placeholder = `${handlesPlaceholder} …`;
	}

	refreshComposerState();

	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;
	const sessionId = getActiveSessionId() ?? UNKNOWN_SESSION_ID;

	const topinfoLeftEl = doc.querySelector<HTMLElement>("#topinfo-left");
	const topinfoRightEl = doc.querySelector<HTMLElement>("#topinfo-right");
	const topinfoMobileEl = doc.querySelector<HTMLElement>("#topinfo-mobile");

	function refreshTopInfo(): void {
		if (!session) return;
		if (!topinfoLeftEl || !topinfoRightEl) return;
		const state = session.getState();
		const inputs = {
			sessionId,
			epoch: hydratedEpoch,
			turn: state.round,
		};
		renderTopInfoLeft(topinfoLeftEl, inputs);
		const status = topInfoStatus(connectionUnstable ? "unstable" : "stable");
		paintDesktopStatus(topinfoRightEl, status);
		if (topinfoMobileEl) {
			topinfoMobileEl.textContent = formatTopInfoMobile(inputs);
		}
		const topinfoMobileStatusEl = doc.querySelector<HTMLElement>(
			"#topinfo-mobile-status",
		);
		if (topinfoMobileStatusEl) {
			paintMobileStatusPill(topinfoMobileStatusEl, status);
		}
	}

	refreshTopInfo();

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
					text: composerInput.value,
					selectionStart: composerInput.selectionStart,
					targetPersona: targetAi,
					personaNamesToId,
					personas: session?.getState().personas ?? {},
				});
				composerInput.value = result.text;
				trySetCaret(composerInput, result.selectionStart);
				refreshComposerState();
			});
		}
	}

	registerPanelClickHandlers(aiIdList);

	if (__DEV__ && session !== null) {
		renderInspector(root, {
			session,
		});
	}

	function getTranscriptEl(aiId: AiId): HTMLElement | null {
		return doc.querySelector<HTMLElement>(`[data-transcript="${aiId}"]`);
	}

	function openMsgLine(transcript: HTMLElement): HTMLElement {
		const div = doc.createElement("div");
		div.className = "msg-line";
		transcript.appendChild(div);
		return div;
	}

	function appendAiTokensToCurrentMsgLine(aiId: AiId, text: string): void {
		const el = getTranscriptEl(aiId);
		if (!el) return;
		const last = el.lastElementChild as HTMLElement | null;
		const line = last?.classList.contains("msg-line") ? last : openMsgLine(el);
		line.dataset.body = (line.dataset.body ?? "") + text;
		const personas = session?.getState().personas ?? {};
		const prefix = line.querySelector<HTMLElement>(":scope > .msg-prefix");
		while (line.lastChild && line.lastChild !== prefix) {
			line.removeChild(line.lastChild);
		}
		appendMentionAwareText(line, line.dataset.body, personas);
		scrollTranscriptToBottom(el);
	}

	function appendStandaloneLine(aiId: AiId, text: string): void {
		const el = getTranscriptEl(aiId);
		if (!el) return;
		const line = openMsgLine(el);
		const personas = session?.getState().personas ?? {};
		appendMentionAwareText(line, text, personas);
		scrollTranscriptToBottom(el);
	}

	function appendPlayerLine(aiId: AiId, text: string): void {
		const el = getTranscriptEl(aiId);
		if (!el) return;
		const line = openMsgLine(el);
		const personas = session?.getState().personas ?? {};
		appendMentionAwareText(line, text, personas, "msg-you");
		scrollTranscriptToBottom(el);
	}

	function appendAiPrefix(aiId: AiId, personaName: string): void {
		const el = getTranscriptEl(aiId);
		if (!el) return;
		const line = openMsgLine(el);
		const span = doc.createElement("span");
		span.className = "msg-prefix";
		const color = session?.getState().personas[aiId]?.color;
		if (color) span.style.setProperty("--prefix-color", color);
		span.textContent = `> *${transcriptName(personaName)} `;
		line.appendChild(span);
		scrollTranscriptToBottom(el);
	}

	function _pace(): Promise<void> {
		const ms = TOKEN_PACE_MS * AI_TYPING_SPEED * (0.5 + Math.random());
		return new Promise((r) => setTimeout(r, ms));
	}

	function updateBudget(aiId: AiId, remaining: number): void {
		const panel = doc.querySelector<HTMLElement>(
			`.ai-panel[data-ai="${aiId}"]`,
		);
		if (!panel) return;
		const budgetEl = panel.querySelector<HTMLSpanElement>(".panel-budget");
		if (!budgetEl) return;
		budgetEl.dataset.budget = String(remaining);
		budgetEl.textContent = formatBudgetAsCents(remaining);
	}

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

		const message = stripLeadingMention(rawMessage, personaNamesToId);
		if (!message) return;

		const addressed = addressee;
		roundInFlight = true;
		sendBtn.disabled = true;
		setRoundInFlightMarker(doc, true);

		hideRoundError(doc);
		connectionUnstable = false;

		const addressedNameNow =
			session.getState().personas[addressed]?.name ?? addressed;
		const addresseePrefix = `*${addressedNameNow} `;
		promptInput.value = addresseePrefix;
		promptInput.setSelectionRange(
			addresseePrefix.length,
			addresseePrefix.length,
		);
		promptInput.focus();
		refreshComposerState();

		appendPlayerLine(addressed, `> ${message}\n`);

		const spinners = new Map<
			AiId,
			{ els: HTMLElement[]; intervalId: ReturnType<typeof setInterval> }
		>();
		for (const aiId of Object.keys(session.getState().personas) as AiId[]) {
			const panel = doc.querySelector<HTMLElement>(
				`.ai-panel[data-ai="${aiId}"]`,
			);
			if (!panel) continue;
			const els = appendPanelSpinners(panel);
			if (els.length === 0) continue;
			let frame = 0;
			const intervalId = setInterval(() => {
				frame = (frame + 1) % BRAILLE_SPINNER_FRAMES.length;
				const text = brailleFrameText(frame);
				for (const spinnerEl of els) spinnerEl.textContent = text;
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

		const initiativeOrder = fisherYatesShuffledCopy(
			Object.keys(session.getState().personas),
		);

		let roundGameEnded = false;

		try {
			const rawProvider = new BrowserLLMProvider({
				disableReasoning: !enableReasoning,
			});

			const provider: RoundLLMProvider = __DEV__
				? withDevInspectorRecording(rawProvider, session)
				: rawProvider;

			const onLifecycle: ((event: LifecyclePhase) => void) | undefined = __DEV__
				? updateDaemonFooterOnLifecycle
				: undefined;

			const onAiTurnComplete = (aiId: AiId): void => stripSpinner(aiId);
			const { result, completions, nextState } = await session.submitMessage(
				addressed,
				message,
				provider,
				initiativeOrder,
				undefined,
				onAiTurnComplete,
				onLifecycle,
			);

			const events = encodeRoundResult(
				result,
				completions,
				nextState,
				nextState.personas,
			);

			for (const event of events) {
				switch (event.type) {
					case "ai_start":
					case "token":
					case "ai_end":
					case "system_broadcast":
					case "action_log":
						break;

					case "message": {
						const playerLineAlreadyPaintedAtSubmit = event.from === PLAYER_ID;
						if (playerLineAlreadyPaintedAtSubmit) break;
						const isDaemonToPlayer = event.to === PLAYER_ID;
						if (isDaemonToPlayer) {
							const daemonId = event.from as AiId;
							const daemonName = nextState.personas[daemonId]?.name ?? daemonId;
							appendAiPrefix(daemonId, daemonName);
							appendAiTokensToCurrentMsgLine(daemonId, `${event.content}\n`);
						}
						break;
					}

					case "budget":
						updateBudget(event.aiId, event.remaining);
						break;

					case "lockout":
						appendStandaloneLine(event.aiId, `[${event.content}]\n`);
						break;

					case "chat_lockout":
						setChatLockout(event.aiId, true);
						break;

					case "chat_lockout_resolved":
						setChatLockout(event.aiId, false);
						break;

					case "game_ended": {
						if (gameEndHandled) break;
						gameEndHandled = true;
						roundGameEnded = true;

						sendBtn.disabled = true;
						promptInput.disabled = true;

						const endedSessionId = getActiveSessionId();
						const endedState = session?.getState();
						session = null;
						hydratedSessionId = null;

						const panelsEl = doc.querySelector<HTMLElement>("#panels");
						const composerEl = doc.querySelector<HTMLElement>("#composer");
						const capHitSection = doc.querySelector<HTMLElement>("#cap-hit");
						const endgameEl = doc.querySelector<HTMLElement>("#endgame");
						if (panelsEl) panelsEl.hidden = true;
						if (composerEl) composerEl.hidden = true;
						if (capHitSection) capHitSection.hidden = true;

						if (endgameEl) endgameEl.removeAttribute("hidden");

						const newDaemonsBtn = doc.querySelector<HTMLButtonElement>(
							"#endgame-new-daemons-btn",
						);
						const sameDaemonsBtn = doc.querySelector<HTMLButtonElement>(
							"#endgame-same-daemons-btn",
						);
						const continueBtn = doc.querySelector<HTMLButtonElement>(
							"#endgame-continue-btn",
						);
						const choiceStatus = doc.querySelector<HTMLElement>(
							"#endgame-choice-status",
						);

						const hasOpenRouterKey =
							localStorage.getItem("openrouter_key") !== null;
						if (continueBtn && hasOpenRouterKey) {
							continueBtn.removeAttribute("hidden");
						}

						const disableChoiceButtons = () => {
							if (newDaemonsBtn) newDaemonsBtn.disabled = true;
							if (sameDaemonsBtn) sameDaemonsBtn.disabled = true;
							if (continueBtn) continueBtn.disabled = true;
						};

						if (newDaemonsBtn) {
							newDaemonsBtn.addEventListener("click", () => {
								disableChoiceButtons();
								if (choiceStatus) choiceStatus.textContent = "archiving…";
								(endedSessionId
									? archiveSession(endedSessionId)
									: Promise.resolve()
								)
									.then(() => {
										clearActiveSession();
										session = null;
										hydratedSessionId = null;
										renderApp(root);
									})
									.catch(() => {
										clearActiveSession();
										session = null;
										hydratedSessionId = null;
										renderApp(root);
									});
							});
						}

						if (sameDaemonsBtn) {
							sameDaemonsBtn.addEventListener("click", () => {
								disableChoiceButtons();
								if (!endedState) {
									renderApp(root);
									return;
								}
								if (choiceStatus) choiceStatus.textContent = "archiving…";
								(endedSessionId
									? archiveSession(endedSessionId)
									: Promise.resolve()
								)
									.then(() => {
										if (choiceStatus)
											choiceStatus.textContent = "spinning up a new room…";
										return buildSameDaemonsSession(endedState.personas);
									})
									.then((newSess) => {
										clearActiveSession();
										mintAndActivateNewSession();
										saveActiveSession(newSess.getState());
										session = null;
										hydratedSessionId = null;
										gameEndHandled = false;
										renderApp(root);
									})
									.catch(() => {
										clearActiveSession();
										session = null;
										hydratedSessionId = null;
										renderApp(root);
									});
							});
						}

						if (continueBtn) {
							continueBtn.addEventListener("click", () => {
								disableChoiceButtons();
								if (!endedState) {
									renderApp(root);
									return;
								}
								if (choiceStatus)
									choiceStatus.textContent = "spinning up a new room…";
								buildSameDaemonsSession(endedState.personas)
									.then((newSess) => {
										let newState = newSess.getState();
										newState = appendBroadcast(
											newState,
											"The sysadmin has created a new room.",
										);
										saveActiveSession(newState);
										session = null;
										hydratedSessionId = null;
										gameEndHandled = false;
										renderApp(root);
									})
									.catch(() => {
										session = null;
										hydratedSessionId = null;
										renderApp(root);
									});
							});
						}

						const downloadBtn =
							doc.querySelector<HTMLButtonElement>("#download-ais-btn");
						const downloadStatusEl =
							doc.querySelector<HTMLElement>("#download-status");
						if (downloadBtn && endedState) {
							const savePayload = JSON.stringify(serializeGameSave(endedState));
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

						session = null;
						hydratedSessionId = null;
						break;
					}
				}
			}

			if (__DEV__ && session) {
				const stripEl = document.querySelector<HTMLElement>("#dev-game-strip");
				if (stripEl) updateGameStripSummary(stripEl, session);

				const mapEl = document.querySelector<HTMLElement>("#dev-world-map");
				if (mapEl) updateWorldMap(mapEl, session);

				for (const aiId of Object.keys(nextState.personas)) {
					const panel = document.querySelector<HTMLElement>(
						`.ai-panel[data-ai="${aiId}"]`,
					);
					if (panel) {
						updateDaemonFooterSummary(panel, aiId, session);
						updateDaemonFooterDetails(panel, aiId, session);
					}
				}
			}

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
			} else {
				connectionUnstable = true;
				showRoundError(doc);
			}
		} finally {
			stripAllSpinners();
			roundInFlight = false;
			setRoundInFlightMarker(doc, false);
			if (!roundGameEnded) {
				refreshComposerState();
				refreshTopInfo();
			}
		}
	});

	return Promise.resolve();
}
