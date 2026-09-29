import {
	BANNER,
	formatTopInfoMobile,
	initPanelChrome,
	type LoadState,
	type LoadStateStatus,
	renderTopInfoLeft,
	type TopInfoInputs,
	topInfoStatus,
} from "../bbs-chrome.js";
import { isDevHost } from "../dev-host.js";
import {
	type DaemonFooterPipState,
	recordDaemonError,
	recordDaemonRound,
	recordDaemonSystemPrompt,
	recordDaemonTurnResult,
	setDaemonFooterInFlight,
} from "../dev-inspector/daemon-footer.js";
import {
	refreshInspectorAfterRound,
	renderInspector,
} from "../dev-inspector/index.js";
import {
	buildSessionFromAssets,
	type NewGameAssets,
} from "../game/bootstrap.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { isPlayerChatLockedOut } from "../game/complication-engine.js";
import {
	type ComposerInput,
	type ComposerState,
	deriveComposerState,
} from "../game/composer-reducer.js";
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
	failPendingBootstrap,
	getPendingBootstrap,
	type PendingBootstrap,
	restartContentPacks,
} from "../game/pending-bootstrap.js";
import type {
	LifecyclePhase,
	RoundLLMProvider,
} from "../game/round-llm-provider.js";
import {
	encodeRoundResult,
	type SseEvent,
} from "../game/round-result-encoder.js";
import { fisherYatesShuffledCopy } from "../game/shuffle.js";
import { getSpikeRng } from "../game/spike-seed.js";
import type {
	AiId,
	AiPersona,
	ConversationEntry,
	GameState,
} from "../game/types";
import { CapHitError, upstreamMessageOf } from "../llm-client.js";
import {
	clearActiveSession,
	deactivateActiveSession,
	getActiveSessionId,
	type LoadResult,
	listSessions,
	loadActiveSession,
	type SaveResult,
	saveActiveSession,
} from "../persistence/session-storage.js";
import { type RenderOpts, renderApp } from "../render-app.js";
import { dropListenersByCloning, setHidden, trySetCaret } from "./dom.js";
import { showEndgame } from "./game-endgame.js";
import {
	appendMentionAwareText,
	type MessageEntry,
	PLAYER_ID,
	transcriptMessageLine,
} from "./transcript-lines.js";

export const BOOTSTRAP_LOADING_TIMEOUT_MS = 300_000;

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
const PANEL_SPINNER_SELECTOR = ".panel-name .panel-spinner";
const BRIGHTNESS_WIPE_TAU_MS = 60_000;
const BRIGHTNESS_WIPE_MAX_PCT = 99;

type SaveFailureReason = Extract<SaveResult, { ok: false }>["reason"];

const PERSISTENCE_WARNING_MESSAGES: Record<SaveFailureReason, string> = {
	unavailable:
		"Game progress cannot be saved: storage is disabled in your browser. Your session will be lost on refresh.",
	quota: "Game progress could not be saved: browser storage is full.",
	unknown: "Game progress could not be saved due to an unexpected error.",
};

const DAEMON_FOOTER_STATE_BY_PHASE: Partial<
	Record<LifecyclePhase["phase"], DaemonFooterPipState>
> = {
	started: "in-flight",
	completed: "idle",
	errored: "errored",
};

type PersonaLookups = Pick<
	ComposerInput,
	"personaNamesToId" | "personaColors" | "personaDisplayNames"
>;

type MessageEvent = Extract<SseEvent, { type: "message" }>;
type UnloadableSession = Exclude<LoadResult, { kind: "ok" }>;

interface DevHooks {
	showPendingBootstrap(root: HTMLElement, pending: PendingBootstrap): void;
	showSession(root: HTMLElement, session: GameSession): void;
	recordingProvider(
		provider: RoundLLMProvider,
		session: GameSession,
	): RoundLLMProvider;
	lifecycleListener: ((event: LifecyclePhase) => void) | undefined;
	refreshAfterRound(
		doc: Document,
		session: GameSession,
		aiIds: readonly AiId[],
	): void;
}

interface GameViewContext {
	root: HTMLElement;
	opts: RenderOpts | undefined;
	doc: Document;
	form: HTMLFormElement;
	promptInput: HTMLInputElement;
	sendBtn: HTMLButtonElement;
	capHitEl: HTMLElement | null;
	persistenceWarningEl: HTMLElement | null;
	mentionOverlay: HTMLElement | null;
	promptTargetEl: HTMLElement | null;
	searchParams: URLSearchParams;
	enableReasoning: boolean;
	sessionLabel: string;
	dev: DevHooks;
	personaLookups: PersonaLookups | null;
	lockouts: Map<AiId, boolean>;
	roundInFlight: boolean;
	connectionUnstable: boolean;
}

interface LoadingTimers {
	spinnerInterval: ReturnType<typeof setInterval> | undefined;
	wipeRaf: ReturnType<typeof requestAnimationFrame> | undefined;
}

interface LoadingFlow {
	sessionId: string | null;
	pending: PendingBootstrap;
	timers: LoadingTimers;
	blockedBy: "cap-hit" | "recovery" | null;
}

interface RoundSpinners {
	strip(aiId: AiId): void;
	stripAll(): void;
}

interface RoundDraft {
	addressee: AiId;
	message: string;
}

interface RoundOutcome {
	gameEnded: boolean;
}

interface RoundOwner {
	session: GameSession;
	sessionId: string | null;
}

let gameEndHandled = false;

let session: GameSession | null = null;
let hydratedSessionId: string | null = null;
let hydratedEpoch: number = 1;
let viewCtx: GameViewContext | null = null;
let loadingFlow: LoadingFlow | null = null;

export function renderGame(
	root: HTMLElement,
	opts?: RenderOpts,
): Promise<void> {
	const ctx = enterGameViewContext(root, opts);
	if (!ctx) return Promise.resolve();
	hidePersistenceWarning(ctx.persistenceWarningEl);
	dropSessionIfActivePointerMoved();
	if (!session) {
		const detour = enterWithoutCachedSession(ctx);
		if (detour) return detour;
	}
	mountSessionView(ctx);
	return Promise.resolve();
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

function enterGameViewContext(
	root: HTMLElement,
	opts: RenderOpts | undefined,
): GameViewContext | null {
	const fresh = createGameViewContext(root, opts);
	if (!fresh) return null;
	const previous = viewCtx;
	if (previous && previous.form === fresh.form) {
		Object.assign(previous, fresh, {
			roundInFlight: previous.roundInFlight,
			connectionUnstable: previous.connectionUnstable,
		});
		return previous;
	}
	viewCtx = fresh;
	wireViewListeners(fresh);
	return fresh;
}

function createGameViewContext(
	root: HTMLElement,
	opts: RenderOpts | undefined,
): GameViewContext | null {
	const doc = root.ownerDocument;
	const form = doc.querySelector<HTMLFormElement>("#composer");
	const promptInput = doc.querySelector<HTMLInputElement>("#prompt");
	const sendBtn = doc.querySelector<HTMLButtonElement>("#send");
	if (!form || !promptInput || !sendBtn) return null;
	const searchParams = new URLSearchParams(location.search);
	return {
		root,
		opts,
		doc,
		form,
		promptInput,
		sendBtn,
		capHitEl: doc.querySelector<HTMLElement>("#cap-hit"),
		persistenceWarningEl: doc.querySelector<HTMLElement>(
			"#persistence-warning",
		),
		mentionOverlay: doc.querySelector<HTMLElement>("#prompt-overlay"),
		promptTargetEl: doc.querySelector<HTMLElement>(".prompt-target"),
		searchParams,
		enableReasoning: !(isDevHost() && searchParams.get("think") === "0"),
		sessionLabel: getActiveSessionId() ?? UNKNOWN_SESSION_ID,
		dev: __DEV__ ? inspectorDevHooks(doc) : NOOP_DEV_HOOKS,
		personaLookups: null,
		lockouts: new Map(),
		roundInFlight: false,
		connectionUnstable: false,
	};
}

function dropSessionIfActivePointerMoved(): void {
	const activePointerMoved =
		session !== null && hydratedSessionId !== getActiveSessionId();
	if (!activePointerMoved) return;
	session = null;
	hydratedSessionId = null;
	gameEndHandled = false;
}

function releaseSession(): void {
	session = null;
	hydratedSessionId = null;
}

function currentPersonas(): Record<AiId, AiPersona> {
	return session?.getState().personas ?? {};
}

const NOOP_DEV_HOOKS: DevHooks = {
	showPendingBootstrap: () => undefined,
	showSession: () => undefined,
	recordingProvider: (provider) => provider,
	lifecycleListener: undefined,
	refreshAfterRound: () => undefined,
};

function inspectorDevHooks(doc: Document): DevHooks {
	return {
		showPendingBootstrap: (root, pendingBootstrap) =>
			renderInspector(root, { pendingBootstrap }),
		showSession: (root, gameSession) =>
			renderInspector(root, { session: gameSession }),
		recordingProvider: withDevInspectorRecording,
		lifecycleListener: (event) => updateDaemonFooterOnLifecycle(doc, event),
		refreshAfterRound: refreshInspectorAfterRound,
	};
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

function updateDaemonFooterOnLifecycle(
	doc: Document,
	event: LifecyclePhase,
): void {
	if (!event.daemonId) return;
	const panel = findPanel(doc, event.daemonId);
	if (!panel) return;
	const footerState = DAEMON_FOOTER_STATE_BY_PHASE[event.phase];
	if (!footerState) return;
	setDaemonFooterInFlight(panel, footerState);
	if (event.phase === "errored") recordDaemonError(event.daemonId, event.error);
}

function findPanel(doc: Document, aiId: AiId): HTMLElement | null {
	return doc.querySelector<HTMLElement>(`.ai-panel[data-ai="${aiId}"]`);
}

function enterWithoutCachedSession(ctx: GameViewContext): Promise<void> | null {
	const pendingBootstrap = getPendingBootstrap();
	if (pendingBootstrap) {
		const activeSessionIsEmpty = loadActiveSession().kind === "none";
		if (activeSessionIsEmpty) {
			const runningFlow = runningLoadingFlowFor(pendingBootstrap);
			if (runningFlow) {
				revealRunningLoadingFlow(ctx, runningFlow);
				return Promise.resolve();
			}
			return renderBootstrapLoadingFlow(ctx, pendingBootstrap);
		}
		clearPendingBootstrap();
		renderApp(ctx.root);
		return Promise.resolve();
	}

	if (!isLocalStorageAvailable()) {
		showPersistenceWarning(ctx.persistenceWarningEl, "unavailable");
		return null;
	}

	const noActiveSessionPointer = getActiveSessionId() === null;
	if (noActiveSessionPointer) {
		renderApp(ctx.root);
		return Promise.resolve();
	}

	return restoreActiveSession(ctx);
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

function hidePersistenceWarning(warningEl: HTMLElement | null): void {
	warningEl?.setAttribute("hidden", "");
}

function showPersistenceWarning(
	warningEl: HTMLElement | null,
	reason: SaveFailureReason,
): void {
	if (!warningEl) return;
	warningEl.textContent = PERSISTENCE_WARNING_MESSAGES[reason];
	warningEl.removeAttribute("hidden");
}

function restoreActiveSession(ctx: GameViewContext): Promise<void> | null {
	const loadResult = loadActiveSession();
	if (loadResult.kind !== "ok") {
		redirectUnloadableSession(ctx.root, loadResult);
		return Promise.resolve();
	}
	session = GameSession.restore(loadResult.state);
	hydratedSessionId = loadResult.sessionId;
	hydratedEpoch = loadResult.epoch;
	repaintRestoredTranscripts(ctx.doc, loadResult.state);
	return null;
}

function redirectUnloadableSession(
	root: HTMLElement,
	loadResult: UnloadableSession,
): void {
	if (loadResult.kind === "version-mismatch") {
		deactivateActiveSession();
		renderApp(root, {
			reason: "version-mismatch",
			schemaVersion: loadResult.schemaVersion,
		});
		return;
	}
	clearActiveSession();
	renderApp(root, { reason: "broken" });
}

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
		const transcript =
			restorePanelEls[idx]?.querySelector<HTMLElement>(".transcript");
		if (!transcript) return;
		transcript.textContent = "";
		const visibleEntries = (restoredState.conversationLogs[aiId] ?? []).filter(
			isPlayerFacingMessage,
		);
		for (const entry of visibleEntries) {
			transcript.appendChild(
				transcriptMessageLine(doc, entry, aiId, restoredPersonas),
			);
		}
	});

	requestAnimationFrame(() => {
		for (const panel of restorePanelEls) {
			scrollTranscriptToBottom(panel.querySelector<HTMLElement>(".transcript"));
		}
	});
}

function mountSessionView(ctx: GameViewContext): void {
	const { doc } = ctx;
	if (session !== null) session = adoptSession(ctx, session);

	revealGameRouteChrome(doc);
	ctx.promptInput.disabled = false;

	if (session !== null) {
		const state = session.getState();
		paintSessionPanels(doc, state);
		paintHandlesPlaceholder(ctx.promptInput, state.personas);
	}

	refreshComposerState(ctx);
	paintBannerOnce(doc);
	refreshTopInfo(ctx);

	if (session !== null) ctx.dev.showSession(ctx.root, session);

	const restoredState = session?.getState();
	if (restoredState?.isComplete) {
		gameEndHandled = true;
		enterEndgame(ctx, restoredState, hydratedSessionId);
	}
}

function adoptSession(
	ctx: GameViewContext,
	gameSession: GameSession,
): GameSession {
	const adopted = applyTestAffordances(gameSession, ctx.searchParams);
	const state = adopted.getState();
	ctx.personaLookups = {
		personaNamesToId: buildPersonaNameMap(state.personas),
		personaColors: buildPersonaColorMap(state.personas),
		personaDisplayNames: buildPersonaDisplayNameMap(state.personas),
	};
	for (const aiId of Object.keys(state.personas)) {
		ctx.lockouts.set(aiId, isPlayerChatLockedOut(state, aiId));
	}
	gameEndHandled = false;
	return adopted;
}

function revealGameRouteChrome(doc: Document): void {
	setHidden(doc, ["#start-screen", "#sessions-screen", "#endgame"], true);
	setHidden(
		doc,
		["#panels", "#composer", "#stage > header", "#topinfo", "#banner"],
		false,
	);
}

function paintBannerOnce(doc: Document): void {
	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;
}

function setGameSurfaceHidden(doc: Document, hidden: boolean): void {
	setHidden(doc, ["#panels", "#composer"], hidden);
}

function paintPersonaPanels(
	doc: Document,
	personas: Record<AiId, AiPersona>,
	paintPanelExtras: (panel: HTMLElement, aiId: AiId) => void,
): void {
	const aiIds = Object.keys(personas);
	doc.querySelectorAll<HTMLElement>(".ai-panel").forEach((panel, idx) => {
		const aiId = aiIds[idx];
		if (!aiId) return;
		const persona = personas[aiId];
		if (!persona) return;
		panel.dataset.ai = aiId;
		panel.style.setProperty("--panel-color", persona.color);
		initPanelChrome(panel, persona);
		paintPanelExtras(panel, aiId);
	});
}

function paintSessionPanels(doc: Document, state: GameState): void {
	paintPersonaPanels(doc, state.personas, (panel, aiId) => {
		const budget = state.budgets[aiId];
		if (budget) paintPanelBudget(panel, budget.remaining);
	});
}

function paintPanelBudget(panel: HTMLElement, remaining: number): void {
	const budgetEl = panel.querySelector<HTMLSpanElement>(".panel-budget");
	if (!budgetEl) return;
	budgetEl.dataset.budget = String(remaining);
	budgetEl.textContent = formatBudgetAsCents(remaining);
}

function formatBudgetAsCents(remainingUsd: number): string {
	return `${(Math.max(0, remainingUsd) * 100).toFixed(3)}¢`;
}

function paintHandlesPlaceholder(
	input: HTMLInputElement,
	personas: Record<AiId, AiPersona>,
): void {
	const handlesPlaceholder = Object.values(personas)
		.map((p) => `*${p.name}`)
		.join(" | ");
	if (handlesPlaceholder) input.placeholder = `${handlesPlaceholder} …`;
}

function refreshTopInfo(ctx: GameViewContext): void {
	if (!session) return;
	const { doc } = ctx;
	const hasDesktopTopInfo =
		doc.querySelector("#topinfo-left") && doc.querySelector("#topinfo-right");
	if (!hasDesktopTopInfo) return;
	paintTopInfo(
		doc,
		{
			sessionId: ctx.sessionLabel,
			epoch: hydratedEpoch,
			turn: session.getState().round,
		},
		topInfoStatus(ctx.connectionUnstable ? "unstable" : "stable"),
	);
}

function renderLoadingTopInfo(doc: Document, state: LoadState): void {
	paintTopInfo(
		doc,
		{
			sessionId: getActiveSessionId() ?? UNKNOWN_SESSION_ID,
			epoch: hydratedEpoch,
			turn: 0,
		},
		topInfoStatus(state),
	);
}

function paintTopInfo(
	doc: Document,
	inputs: TopInfoInputs,
	status: LoadStateStatus,
): void {
	const leftEl = doc.querySelector<HTMLElement>("#topinfo-left");
	const rightEl = doc.querySelector<HTMLElement>("#topinfo-right");
	const mobileEl = doc.querySelector<HTMLElement>("#topinfo-mobile");
	const mobileStatusEl = doc.querySelector<HTMLElement>(
		"#topinfo-mobile-status",
	);
	if (leftEl) renderTopInfoLeft(leftEl, inputs);
	if (rightEl) paintStatusSpan(rightEl, status.cls, status.desktop);
	if (mobileEl) mobileEl.textContent = formatTopInfoMobile(inputs);
	if (mobileStatusEl) {
		paintStatusSpan(mobileStatusEl, status.cls, ` ${status.mobile}`);
	}
}

function paintStatusSpan(el: HTMLElement, cls: string, text: string): void {
	el.textContent = "";
	const span = el.ownerDocument.createElement("span");
	span.className = cls;
	span.textContent = text;
	el.appendChild(span);
}

function setStageLoadState(doc: Document, state: LoadState): void {
	const stageEl = doc.querySelector<HTMLElement>("#stage");
	if (!stageEl) return;
	if (state === "stable") {
		stageEl.removeAttribute("data-load-state");
		stageEl.style.removeProperty("--fill-pct");
	} else {
		stageEl.setAttribute("data-load-state", state);
	}
}

function wireViewListeners(ctx: GameViewContext): void {
	ctx.promptInput.addEventListener("input", () => refreshComposerState(ctx));
	ctx.promptInput.addEventListener("scroll", () => syncOverlayScroll(ctx));
	ctx.form.addEventListener("submit", (evt) => {
		void submitRound(ctx, evt);
	});
	for (const panel of ctx.doc.querySelectorAll<HTMLElement>(".ai-panel")) {
		panel.addEventListener("click", () => addressPanel(ctx, panel));
	}
}

function syncOverlayScroll(ctx: GameViewContext): void {
	if (ctx.mentionOverlay) {
		ctx.mentionOverlay.scrollLeft = ctx.promptInput.scrollLeft;
	}
}

function deriveComposerStateFor(
	ctx: GameViewContext,
	lookups: PersonaLookups,
): ComposerState {
	return deriveComposerState({
		text: ctx.promptInput.value,
		lockouts: ctx.lockouts,
		...lookups,
	});
}

function refreshComposerState(ctx: GameViewContext): void {
	const lookups = ctx.personaLookups;
	if (!lookups) return;
	const state = deriveComposerStateFor(ctx, lookups);
	ctx.sendBtn.disabled = !state.sendEnabled || ctx.roundInFlight;
	setPanelColor(ctx.promptInput, state.borderColor);
	paintPanelAddressingAndLockouts(ctx.doc, lookups.personaColors.keys(), state);
	setOutput(
		ctx.doc.querySelector<HTMLOutputElement>("#lockout-error"),
		state.lockoutError,
	);
	rebuildMentionOverlay(
		ctx.mentionOverlay,
		ctx.promptInput.value,
		state.mentionHighlight,
	);
	syncOverlayScroll(ctx);
	refreshPromptTarget(ctx.promptTargetEl, state.addressee);
}

function setPanelColor(el: HTMLElement, color: string | null): void {
	if (color != null) {
		el.style.setProperty("--panel-color", color);
	} else {
		el.style.removeProperty("--panel-color");
	}
}

function paintPanelAddressingAndLockouts(
	doc: Document,
	aiIds: Iterable<AiId>,
	state: ComposerState,
): void {
	for (const aiId of aiIds) {
		const panel = findPanel(doc, aiId);
		if (!panel) continue;
		const isAddressed = state.panelHighlight === aiId;
		panel.classList.toggle("panel--addressed", isAddressed);
		const isLocked = state.lockedPanels.has(aiId);
		panel.classList.toggle("panel--locked", isLocked);
		panel.setAttribute("aria-disabled", isLocked ? "true" : "false");
	}
}

function setOutput(el: HTMLOutputElement | null, text: string | null): void {
	if (!el) return;
	el.textContent = text ?? "";
	el.hidden = text === null;
}

function rebuildMentionOverlay(
	overlay: HTMLElement | null,
	text: string,
	highlight: ComposerState["mentionHighlight"],
): void {
	if (!overlay) return;
	const doc = overlay.ownerDocument;
	while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
	if (!highlight) {
		overlay.appendChild(doc.createTextNode(text));
		return;
	}
	const { start, end, color } = highlight;
	if (start > 0) {
		overlay.appendChild(doc.createTextNode(text.slice(0, start)));
	}
	const span = doc.createElement("span");
	span.className = "mention-highlight";
	span.style.setProperty("--panel-color", color);
	span.style.color = color;
	span.appendChild(doc.createTextNode(text.slice(start, end)));
	overlay.appendChild(span);
	if (end < text.length) {
		overlay.appendChild(doc.createTextNode(text.slice(end)));
	}
}

function refreshPromptTarget(
	promptTargetEl: HTMLElement | null,
	addressee: AiId | null,
): void {
	if (!promptTargetEl) return;
	if (addressee == null) {
		promptTargetEl.textContent = UNSET_PROMPT_TARGET;
		promptTargetEl.classList.remove("is-set");
		promptTargetEl.style.removeProperty("--target-color");
		return;
	}
	const persona = currentPersonas()[addressee];
	promptTargetEl.textContent = `/*${persona?.name ?? addressee}`;
	promptTargetEl.classList.add("is-set");
	if (persona?.color) {
		promptTargetEl.style.setProperty("--target-color", persona.color);
	} else {
		promptTargetEl.style.removeProperty("--target-color");
	}
}

function addressPanel(ctx: GameViewContext, panel: HTMLElement): void {
	const targetAi = panel.dataset.ai as AiId | undefined;
	if (!targetAi) return;
	if (ctx.lockouts.get(targetAi) === true) return;
	const lookups = ctx.personaLookups;
	if (!lookups) return;
	const result = applyAddresseeChange({
		text: ctx.promptInput.value,
		selectionStart: ctx.promptInput.selectionStart,
		targetPersona: targetAi,
		personaNamesToId: lookups.personaNamesToId,
		personas: currentPersonas(),
	});
	ctx.promptInput.value = result.text;
	trySetCaret(ctx.promptInput, result.selectionStart);
	refreshComposerState(ctx);
}

function scrollTranscriptToBottom(transcriptEl: HTMLElement | null): void {
	const scrollContainer = transcriptEl?.parentElement;
	if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
}

function getTranscriptEl(doc: Document, aiId: AiId): HTMLElement | null {
	return doc.querySelector<HTMLElement>(`[data-transcript="${aiId}"]`);
}

function openMsgLine(transcript: HTMLElement): HTMLElement {
	const div = transcript.ownerDocument.createElement("div");
	div.className = "msg-line";
	transcript.appendChild(div);
	return div;
}

function appendTranscriptLine(
	doc: Document,
	aiId: AiId,
	text: string,
	nonMentionClass?: string,
): void {
	const el = getTranscriptEl(doc, aiId);
	if (!el) return;
	const line = openMsgLine(el);
	appendMentionAwareText(line, text, currentPersonas(), nonMentionClass);
	scrollTranscriptToBottom(el);
}

function updateBudget(doc: Document, aiId: AiId, remaining: number): void {
	const panel = findPanel(doc, aiId);
	if (panel) paintPanelBudget(panel, remaining);
}

function setChatLockout(
	ctx: GameViewContext,
	aiId: AiId,
	locked: boolean,
): void {
	ctx.lockouts.set(aiId, locked);
	refreshComposerState(ctx);
	refreshTopInfo(ctx);
}

async function submitRound(ctx: GameViewContext, evt: Event): Promise<void> {
	evt.preventDefault();
	if (ctx.roundInFlight) return;
	const activeSession = session;
	if (!activeSession || !ctx.personaLookups) return;

	const draft = readSendableDraft(ctx, ctx.personaLookups);
	if (!draft) return;

	const owner: RoundOwner = {
		session: activeSession,
		sessionId: hydratedSessionId,
	};
	beginRound(ctx, activeSession, draft);

	const aiIds = Object.keys(activeSession.getState().personas);
	const spinners = startRoundSpinners(ctx.doc, aiIds);
	const initiativeOrder = fisherYatesShuffledCopy(aiIds);
	const outcome: RoundOutcome = { gameEnded: false };

	try {
		await playRound(ctx, owner, draft, initiativeOrder, {
			spinners,
			outcome,
		});
	} catch (err) {
		if (!playerLeftRoundSession(owner)) reportRoundFailure(ctx, err);
	} finally {
		spinners.stripAll();
		ctx.roundInFlight = false;
		setRoundInFlightMarker(ctx.doc, false);
		if (!outcome.gameEnded) {
			refreshComposerState(ctx);
			refreshTopInfo(ctx);
		}
	}
}

function readSendableDraft(
	ctx: GameViewContext,
	lookups: PersonaLookups,
): RoundDraft | null {
	const { sendEnabled, addressee } = deriveComposerStateFor(ctx, lookups);
	if (!sendEnabled || !addressee) return null;
	const rawMessage = ctx.promptInput.value.trim();
	if (!rawMessage) return null;
	const message = stripLeadingMention(rawMessage, lookups.personaNamesToId);
	if (!message) return null;
	return { addressee, message };
}

function stripLeadingMention(
	rawMessage: string,
	personaNamesToId: PersonaLookups["personaNamesToId"],
): string {
	const leadingMention = findFirstMention(rawMessage, personaNamesToId);
	return leadingMention !== null && leadingMention.start === 0
		? rawMessage.slice(leadingMention.end).trimStart()
		: rawMessage;
}

function beginRound(
	ctx: GameViewContext,
	activeSession: GameSession,
	draft: RoundDraft,
): void {
	const { doc, promptInput } = ctx;
	ctx.roundInFlight = true;
	ctx.sendBtn.disabled = true;
	setRoundInFlightMarker(doc, true);

	setOutput(roundErrorEl(doc), null);
	ctx.connectionUnstable = false;

	const addressedNameNow =
		activeSession.getState().personas[draft.addressee]?.name ?? draft.addressee;
	const addresseePrefix = `*${addressedNameNow} `;
	promptInput.value = addresseePrefix;
	promptInput.setSelectionRange(addresseePrefix.length, addresseePrefix.length);
	promptInput.focus();
	refreshComposerState(ctx);

	appendTranscriptLine(doc, draft.addressee, `> ${draft.message}\n`, "msg-you");
}

function setRoundInFlightMarker(doc: Document, inFlight: boolean): void {
	const stageEl = doc.querySelector<HTMLElement>("#stage");
	if (inFlight) stageEl?.setAttribute("data-round-in-flight", "true");
	else stageEl?.removeAttribute("data-round-in-flight");
}

function roundErrorEl(doc: Document): HTMLOutputElement | null {
	return doc.querySelector<HTMLOutputElement>("#round-error");
}

function roundErrorText(err: unknown): string {
	const upstreamMessage = upstreamMessageOf(err);
	return upstreamMessage === null
		? "the daemons stuttered — try again"
		: `the daemons stuttered (${upstreamMessage}) — try again`;
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

function animateSpinners(
	spinnerEls: () => Iterable<HTMLElement>,
): ReturnType<typeof setInterval> {
	let frame = 0;
	return setInterval(() => {
		frame = (frame + 1) % BRAILLE_SPINNER_FRAMES.length;
		const text = brailleFrameText(frame);
		for (const spinnerEl of spinnerEls()) spinnerEl.textContent = text;
	}, SPINNER_INTERVAL_MS);
}

function startRoundSpinners(
	doc: Document,
	aiIds: readonly AiId[],
): RoundSpinners {
	const spinners = new Map<
		AiId,
		{ els: HTMLElement[]; intervalId: ReturnType<typeof setInterval> }
	>();
	for (const aiId of aiIds) {
		const panel = findPanel(doc, aiId);
		if (!panel) continue;
		const els = appendPanelSpinners(panel);
		if (els.length === 0) continue;
		spinners.set(aiId, { els, intervalId: animateSpinners(() => els) });
	}
	const strip = (aiId: AiId): void => {
		const s = spinners.get(aiId);
		if (!s) return;
		clearInterval(s.intervalId);
		for (const el of s.els) {
			if (el.parentNode) el.remove();
		}
		spinners.delete(aiId);
	};
	return {
		strip,
		stripAll: () => {
			for (const aiId of [...spinners.keys()]) strip(aiId);
		},
	};
}

function playerLeftRoundSession(owner: RoundOwner): boolean {
	return session !== owner.session || getActiveSessionId() !== owner.sessionId;
}

async function playRound(
	ctx: GameViewContext,
	owner: RoundOwner,
	draft: RoundDraft,
	initiativeOrder: AiId[],
	{ spinners, outcome }: { spinners: RoundSpinners; outcome: RoundOutcome },
): Promise<void> {
	const rawProvider = new BrowserLLMProvider({
		disableReasoning: !ctx.enableReasoning,
	});
	const provider = ctx.dev.recordingProvider(rawProvider, owner.session);
	const { result, nextState } = await owner.session.submitMessage(
		draft.addressee,
		draft.message,
		provider,
		initiativeOrder,
		undefined,
		(aiId) => spinners.strip(aiId),
		ctx.dev.lifecycleListener,
	);

	if (playerLeftRoundSession(owner)) {
		saveRoundLeftBehind(ctx, owner.sessionId, nextState);
		return;
	}

	for (const event of encodeRoundResult(
		result,
		nextState,
		nextState.personas,
	)) {
		applyRoundEvent(ctx, event, nextState, outcome);
	}

	if (session) {
		ctx.dev.refreshAfterRound(
			ctx.doc,
			session,
			Object.keys(nextState.personas),
		);
	}

	const saveResult = saveActiveSession(nextState, {
		sessionId: owner.sessionId,
	});
	if (!saveResult.ok) {
		showPersistenceWarning(ctx.persistenceWarningEl, saveResult.reason);
	}

	if (outcome.gameEnded) {
		refreshTopInfo(ctx);
		enterEndgame(ctx, nextState, owner.sessionId);
	}
}

function saveRoundLeftBehind(
	ctx: GameViewContext,
	roundSessionId: string | null,
	nextState: GameState,
): void {
	const roundSessionStillExists =
		roundSessionId !== null && listSessions().includes(roundSessionId);
	if (roundSessionStillExists) {
		saveActiveSession(nextState, { sessionId: roundSessionId });
	}
	const cachedSessionIsRoundSession = hydratedSessionId === roundSessionId;
	if (!cachedSessionIsRoundSession) return;
	releaseSession();
	const roundSessionIsOnScreen =
		roundSessionStillExists &&
		getActiveSessionId() === roundSessionId &&
		ctx.root.dataset.view === "game";
	if (roundSessionIsOnScreen) void renderGame(ctx.root, ctx.opts);
}

function applyRoundEvent(
	ctx: GameViewContext,
	event: SseEvent,
	nextState: GameState,
	outcome: RoundOutcome,
): void {
	switch (event.type) {
		case "ai_start":
		case "ai_end":
		case "action_log":
			break;
		case "message":
			paintDaemonMessage(ctx.doc, event, nextState);
			break;
		case "budget":
			updateBudget(ctx.doc, event.aiId, event.remaining);
			break;
		case "lockout":
			appendTranscriptLine(ctx.doc, event.aiId, `[${event.content}]\n`);
			break;
		case "chat_lockout":
			setChatLockout(ctx, event.aiId, true);
			break;
		case "chat_lockout_resolved":
			setChatLockout(ctx, event.aiId, false);
			break;
		case "game_ended":
			if (gameEndHandled) break;
			gameEndHandled = true;
			outcome.gameEnded = true;
			break;
	}
}

function paintDaemonMessage(
	doc: Document,
	event: MessageEvent,
	nextState: GameState,
): void {
	const playerLineAlreadyPaintedAtSubmit = event.from === PLAYER_ID;
	if (playerLineAlreadyPaintedAtSubmit) return;
	const isDaemonToPlayer = event.to === PLAYER_ID;
	if (!isDaemonToPlayer) return;
	const daemonId = event.from as AiId;
	const transcript = getTranscriptEl(doc, daemonId);
	if (!transcript) return;
	transcript.appendChild(
		transcriptMessageLine(doc, event, daemonId, nextState.personas),
	);
	scrollTranscriptToBottom(transcript);
}

function reportRoundFailure(ctx: GameViewContext, err: unknown): void {
	if (err instanceof CapHitError && ctx.capHitEl) {
		ctx.capHitEl.removeAttribute("hidden");
		return;
	}
	ctx.connectionUnstable = true;
	setOutput(roundErrorEl(ctx.doc), roundErrorText(err));
}

function enterEndgame(
	ctx: GameViewContext,
	endedState: GameState,
	endedSessionId: string | null,
): void {
	ctx.sendBtn.disabled = true;
	ctx.promptInput.disabled = true;

	releaseSession();

	showEndgame(ctx.root, endedState, endedSessionId, releaseEndedGame);
}

function releaseEndedGame(): void {
	releaseSession();
	gameEndHandled = false;
}

class BootstrapTimeoutError extends Error {
	constructor() {
		super("bootstrap loading timed out");
		this.name = "BootstrapTimeoutError";
	}
}

function withBootstrapTimeout<T>(
	work: Promise<T>,
	onTimeout: (err: BootstrapTimeoutError) => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			const err = new BootstrapTimeoutError();
			onTimeout(err);
			reject(err);
		}, BOOTSTRAP_LOADING_TIMEOUT_MS);
	});
	return Promise.race([work, timeout]).finally(() => {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId);
		}
	});
}

function runningLoadingFlowFor(pending: PendingBootstrap): LoadingFlow | null {
	const running =
		loadingFlow !== null &&
		loadingFlow.pending === pending &&
		loadingFlow.sessionId === getActiveSessionId();
	return running ? loadingFlow : null;
}

function revealRunningLoadingFlow(
	ctx: GameViewContext,
	flow: LoadingFlow,
): void {
	const { doc } = ctx;
	revealGameRouteChrome(doc);
	paintBannerOnce(doc);
	if (flow.blockedBy === null) return;
	setGameSurfaceHidden(doc, true);
	if (flow.blockedBy === "cap-hit") ctx.capHitEl?.removeAttribute("hidden");
	else doc.querySelector("#bootstrap-recovery")?.removeAttribute("hidden");
}

function loadingFlowAbandoned(flow: LoadingFlow): boolean {
	return getActiveSessionId() !== flow.sessionId;
}

function forgetLoadingFlow(flow: LoadingFlow): void {
	if (loadingFlow === flow) loadingFlow = null;
}

function renderBootstrapLoadingFlow(
	ctx: GameViewContext,
	pending: PendingBootstrap,
): Promise<void> {
	const { doc } = ctx;
	hydratedEpoch = 1;
	revealGameRouteChrome(doc);
	paintBannerOnce(doc);
	resetPanelsToEmptyShells(doc.querySelectorAll<HTMLElement>(".ai-panel"));

	showComposerAsLoading(ctx.promptInput);
	ctx.sendBtn.disabled = true;

	setStageLoadState(doc, "loading-daemons");
	renderLoadingTopInfo(doc, "loading-daemons");
	ctx.dev.showPendingBootstrap(ctx.root, pending);

	const flow: LoadingFlow = {
		sessionId: getActiveSessionId(),
		pending,
		timers: { spinnerInterval: undefined, wipeRaf: undefined },
		blockedBy: null,
	};
	loadingFlow = flow;
	return runBootstrapChain(ctx, flow).catch((err: unknown) =>
		handleBootstrapFailure(ctx, flow, err),
	);
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

function showComposerAsLoading(input: HTMLInputElement): void {
	input.disabled = true;
	input.placeholder = LOADING_PLACEHOLDER;
}

function runBootstrapChain(
	ctx: GameViewContext,
	flow: LoadingFlow,
): Promise<void> {
	const { pending } = flow;
	const bootstrapPromise = pending.personasPromise
		.then((personas) => {
			enterGeneratingRoom(ctx, flow, personas);
			return pending.contentPacksPromise.then(
				({ packsA, packsB, objectiveTypes }) => ({
					personas,
					contentPacksA: packsA,
					contentPacksB: packsB,
					objectiveTypes,
				}),
			);
		})
		.then((assets) => handOverBootstrappedSession(ctx, flow, assets));

	return withBootstrapTimeout(bootstrapPromise, (err) =>
		failPendingBootstrap(pending, err),
	);
}

function enterGeneratingRoom(
	ctx: GameViewContext,
	flow: LoadingFlow,
	personas: Record<AiId, AiPersona>,
): void {
	if (loadingFlowAbandoned(flow)) return;
	const { doc } = ctx;
	paintLoadingPersonaPanels(doc, personas);
	setStageLoadState(doc, "generating-room");
	renderLoadingTopInfo(doc, "generating-room");
	ctx.dev.showPendingBootstrap(ctx.root, flow.pending);
	startLoadingSpinners(doc, flow.timers);
	startBrightnessWipe(doc, flow.timers);
}

function paintLoadingPersonaPanels(
	doc: Document,
	personas: Record<AiId, AiPersona>,
): void {
	paintPersonaPanels(doc, personas, (panel) => {
		appendPanelSpinners(panel);
	});
}

function startLoadingSpinners(doc: Document, timers: LoadingTimers): void {
	timers.spinnerInterval = animateSpinners(() =>
		doc.querySelectorAll<HTMLElement>(PANEL_SPINNER_SELECTOR),
	);
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function startBrightnessWipe(doc: Document, timers: LoadingTimers): void {
	const stageEl = doc.querySelector<HTMLElement>("#stage");
	if (!stageEl) return;
	const startTs = nowMs();
	const tick = (): void => {
		const elapsed = nowMs() - startTs;
		const eased = 1 - Math.exp(-elapsed / BRIGHTNESS_WIPE_TAU_MS);
		const pct = Math.min(BRIGHTNESS_WIPE_MAX_PCT, Math.max(0, eased * 100));
		stageEl.style.setProperty("--fill-pct", `${pct.toFixed(2)}%`);
		timers.wipeRaf = requestAnimationFrame(tick);
	};
	timers.wipeRaf = requestAnimationFrame(tick);
}

function cleanupLoadingTimers(timers: LoadingTimers): void {
	if (timers.spinnerInterval) {
		clearInterval(timers.spinnerInterval);
		timers.spinnerInterval = undefined;
	}
	if (timers.wipeRaf !== undefined) {
		cancelAnimationFrame(timers.wipeRaf);
		timers.wipeRaf = undefined;
	}
}

function removeAllPanelSpinners(doc: Document): void {
	for (const spinnerEl of doc.querySelectorAll<HTMLElement>(
		PANEL_SPINNER_SELECTOR,
	)) {
		spinnerEl.remove();
	}
}

function handOverBootstrappedSession(
	ctx: GameViewContext,
	flow: LoadingFlow,
	assets: NewGameAssets,
): Promise<void> | undefined {
	const { doc } = ctx;
	cleanupLoadingTimers(flow.timers);
	forgetLoadingFlow(flow);
	if (loadingFlowAbandoned(flow)) return;
	const gameSessionRng = getSpikeRng("gameSession");
	const built = applyTestAffordances(
		buildSessionFromAssets(
			assets,
			gameSessionRng ? { rng: gameSessionRng } : undefined,
		),
		ctx.searchParams,
	);

	const bootstrapInvalidatedMidFlight = loadActiveSession().kind !== "none";
	if (bootstrapInvalidatedMidFlight) {
		clearPendingBootstrap();
		renderApp(ctx.root);
		return;
	}

	const saveResult = saveActiveSession(built.getState());
	clearPendingBootstrap();

	removeAllPanelSpinners(doc);
	dismissStaleBootstrapRecovery(doc);
	setStageLoadState(doc, "stable");

	ctx.promptInput.disabled = false;
	ctx.promptInput.placeholder = "";

	session = built;
	hydratedSessionId = flow.sessionId;
	hydratedEpoch = 1;
	const rendered = renderGame(ctx.root, ctx.opts);
	if (!saveResult.ok) {
		showPersistenceWarning(ctx.persistenceWarningEl, saveResult.reason);
	}
	return rendered;
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

function failedFlowAbandoned(flow: LoadingFlow): boolean {
	cleanupLoadingTimers(flow.timers);
	if (!loadingFlowAbandoned(flow)) return false;
	forgetLoadingFlow(flow);
	return true;
}

function blockFlowOnCapHit(
	ctx: GameViewContext,
	flow: LoadingFlow,
	err: unknown,
): boolean {
	if (!(err instanceof CapHitError) || !ctx.capHitEl) return false;
	flow.blockedBy = "cap-hit";
	ctx.capHitEl.removeAttribute("hidden");
	setGameSurfaceHidden(ctx.doc, true);
	return true;
}

function blockFlowOnRecovery(
	ctx: GameViewContext,
	flow: LoadingFlow,
	recoveryEl: HTMLElement,
): void {
	flow.blockedBy = "recovery";
	recoveryEl.removeAttribute("hidden");
	setGameSurfaceHidden(ctx.doc, true);
	setStageLoadState(ctx.doc, "unstable");
}

function handleBootstrapFailure(
	ctx: GameViewContext,
	flow: LoadingFlow,
	err: unknown,
): void {
	if (failedFlowAbandoned(flow)) return;
	ctx.dev.showPendingBootstrap(ctx.root, flow.pending);
	if (blockFlowOnCapHit(ctx, flow, err)) return;
	showBootstrapRecovery(ctx, flow, err);
}

function showBootstrapRecovery(
	ctx: GameViewContext,
	flow: LoadingFlow,
	err: unknown,
): void {
	const { doc, root } = ctx;
	const recoveryEl = doc.querySelector<HTMLElement>("#bootstrap-recovery");
	const recoveryUiMissing = !recoveryEl || !paintRecoveryCopy(doc, err);
	if (recoveryUiMissing) {
		abandonBootstrap(root);
		return;
	}

	blockFlowOnRecovery(ctx, flow, recoveryEl);
	wireRegenerateButton(ctx, flow, recoveryEl);
	wireAbandonLink(root);
}

function paintRecoveryCopy(doc: Document, err: unknown): boolean {
	const titleEl = doc.querySelector<HTMLElement>("#bootstrap-recovery-title");
	const bodyEl = doc.querySelector<HTMLElement>("#bootstrap-recovery-body");
	if (!titleEl || !bodyEl) return false;
	const nextSteps =
		"try regenerating with the same daemons, or abandon and reconnect.";
	const upstreamMessage = upstreamMessageOf(err);
	if (err instanceof BootstrapTimeoutError) {
		titleEl.textContent = "the room is taking too long";
		bodyEl.textContent = `the world generation timed out. ${nextSteps}`;
	} else if (upstreamMessage !== null) {
		titleEl.textContent = "the room collapsed";
		bodyEl.textContent = `the model answered with an error (${upstreamMessage}). ${nextSteps}`;
	} else {
		titleEl.textContent = "the room collapsed";
		bodyEl.textContent = `the world we tried to build was malformed. ${nextSteps}`;
	}
	return true;
}

function abandonBootstrap(root: HTMLElement): void {
	loadingFlow = null;
	clearActiveSession();
	clearPendingBootstrap();
	renderApp(root, { reason: "broken" });
}

function wireRegenerateButton(
	ctx: GameViewContext,
	flow: LoadingFlow,
	recoveryEl: HTMLElement,
): void {
	const staleRegenBtn = ctx.doc.querySelector<HTMLButtonElement>(
		"#bootstrap-recovery-regen",
	);
	if (!staleRegenBtn) return;
	staleRegenBtn.disabled = false;
	const regenBtn = dropListenersByCloning(staleRegenBtn);
	regenBtn.addEventListener("click", (e) => {
		e.preventDefault();
		void runRegenerate(ctx, flow, recoveryEl, regenBtn);
	});
}

async function runRegenerate(
	ctx: GameViewContext,
	flow: LoadingFlow,
	recoveryEl: HTMLElement,
	regenBtn: HTMLButtonElement,
): Promise<void> {
	const { doc } = ctx;
	flow.blockedBy = null;
	recoveryEl.setAttribute("hidden", "");
	hidePersistenceWarning(ctx.persistenceWarningEl);
	setGameSurfaceHidden(doc, false);
	showComposerAsLoading(ctx.promptInput);

	regenBtn.disabled = true;

	flow.pending = restartContentPacks();

	try {
		await runBootstrapChain(ctx, flow);
	} catch (regenErr: unknown) {
		if (failedFlowAbandoned(flow)) return;
		showRegenerateFailure(ctx, flow, recoveryEl, regenBtn, regenErr);
	}
}

function showRegenerateFailure(
	ctx: GameViewContext,
	flow: LoadingFlow,
	recoveryEl: HTMLElement,
	regenBtn: HTMLButtonElement,
	regenErr: unknown,
): void {
	if (blockFlowOnCapHit(ctx, flow, regenErr)) {
		recoveryEl.setAttribute("hidden", "");
		return;
	}
	paintRecoveryCopy(ctx.doc, regenErr);
	blockFlowOnRecovery(ctx, flow, recoveryEl);
	regenBtn.disabled = false;
}

function wireAbandonLink(root: HTMLElement): void {
	const staleAbandonLink = root.ownerDocument.querySelector<HTMLAnchorElement>(
		"#bootstrap-recovery-abandon",
	);
	if (!staleAbandonLink) return;
	const abandonLink = dropListenersByCloning(staleAbandonLink);
	abandonLink.addEventListener("click", (e) => {
		e.preventDefault();
		abandonBootstrap(root);
	});
}
