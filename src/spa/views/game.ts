import { serializeGameSave } from "../../save-serializer.js";
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
	type NewGameAssets,
} from "../game/bootstrap.js";
import { BrowserLLMProvider } from "../game/browser-llm-provider.js";
import { isPlayerChatLockedOut } from "../game/complication-engine.js";
import {
	type ComposerInput,
	type ComposerState,
	deriveComposerState,
} from "../game/composer-reducer.js";
import { appendBroadcast } from "../game/engine.js";
import { GameSession } from "../game/game-session.js";
import {
	applyAddresseeChange,
	buildPersonaColorMap,
	buildPersonaDisplayNameMap,
	buildPersonaNameMap,
	findFirstMention,
	type MentionSegment,
	splitMentionSegments,
} from "../game/mention-parser.js";
import {
	clearPendingBootstrap,
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
import { CapHitError } from "../llm-client.js";
import {
	archiveSession,
	clearActiveSession,
	deactivateActiveSession,
	getActiveSessionId,
	type LoadResult,
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
const NEW_ROOM_BROADCAST = "The sysadmin has created a new room.";

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

type PersonaLookups = Pick<
	ComposerInput,
	"personaNamesToId" | "personaColors" | "personaDisplayNames"
>;

type MessageEntry = Extract<ConversationEntry, { kind: "message" }>;
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

let gameEndHandled = false;

let session: GameSession | null = null;
let hydratedSessionId: string | null = null;
let hydratedEpoch: number = 1;

export function renderGame(
	root: HTMLElement,
	opts?: RenderOpts,
): Promise<void> {
	const ctx = createGameViewContext(root, opts);
	if (!ctx) return Promise.resolve();
	dropSessionIfActivePointerMoved();
	wireComposerInput(ctx);
	if (!session) {
		const detour = enterWithoutCachedSession(ctx);
		if (detour) return detour;
	}
	mountSessionView(ctx);
	return Promise.resolve();
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
		enableReasoning: isDevHost() && searchParams.get("think") === "1",
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

function refreshInspectorAfterRound(
	doc: Document,
	gameSession: GameSession,
	aiIds: readonly AiId[],
): void {
	const stripEl = doc.querySelector<HTMLElement>("#dev-game-strip");
	if (stripEl) updateGameStripSummary(stripEl, gameSession);
	const mapEl = doc.querySelector<HTMLElement>("#dev-world-map");
	if (mapEl) updateWorldMap(mapEl, gameSession);
	for (const aiId of aiIds) {
		const panel = findPanel(doc, aiId);
		if (panel) {
			updateDaemonFooterSummary(panel, aiId, gameSession);
			updateDaemonFooterDetails(panel, aiId, gameSession);
		}
	}
}

function findPanel(doc: Document, aiId: AiId): HTMLElement | null {
	return doc.querySelector<HTMLElement>(`.ai-panel[data-ai="${aiId}"]`);
}

function enterWithoutCachedSession(ctx: GameViewContext): Promise<void> | null {
	const pendingBootstrap = getPendingBootstrap();
	if (pendingBootstrap) {
		const activeSessionIsEmpty = loadActiveSession().kind === "none";
		if (activeSessionIsEmpty) {
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

function showPersistenceWarning(
	warningEl: HTMLElement | null,
	reason: string,
): void {
	if (!warningEl) return;
	const msg =
		PERSISTENCE_WARNING_MESSAGES[reason] ??
		PERSISTENCE_WARNING_MESSAGES.unknown ??
		"Game progress could not be saved.";
	warningEl.textContent = msg;
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
				restoredMessageLine(doc, entry, aiId, restoredPersonas),
			);
		}
	});

	requestAnimationFrame(() => {
		for (const panel of restorePanelEls) {
			scrollTranscriptToBottom(panel.querySelector<HTMLElement>(".transcript"));
		}
	});
}

function restoredMessageLine(
	doc: Document,
	entry: MessageEntry,
	aiId: AiId,
	personas: Record<AiId, AiPersona>,
): HTMLElement {
	const lineEl = doc.createElement("div");
	lineEl.className = "msg-line";
	if (entry.from === PLAYER_ID) {
		appendMentionAwareText(lineEl, `> ${entry.content}\n`, personas, "msg-you");
		return lineEl;
	}
	const persona = personas[aiId];
	lineEl.appendChild(
		daemonPrefixSpan(doc, persona?.name ?? aiId, persona?.color),
	);
	appendMentionAwareText(lineEl, `${entry.content}\n`, personas);
	return lineEl;
}

function mountSessionView(ctx: GameViewContext): void {
	const { doc } = ctx;
	if (session !== null) session = adoptSession(ctx, session);

	revealGameRouteChrome(doc);

	const aiIdList: AiId[] =
		session !== null ? Object.keys(session.getState().personas) : [];
	if (session !== null) {
		paintSessionPanels(doc, session.getState(), aiIdList);
		paintHandlesPlaceholder(ctx.promptInput, session.getState().personas);
	}

	refreshComposerState(ctx);
	paintBannerOnce(doc);
	refreshTopInfo(ctx);
	registerPanelClickHandlers(ctx, aiIdList);

	if (session !== null) ctx.dev.showSession(ctx.root, session);

	ctx.form.addEventListener("submit", (evt) => {
		void submitRound(ctx, evt);
	});
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

function paintBannerOnce(doc: Document): void {
	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;
}

function setGameSurfaceHidden(doc: Document, hidden: boolean): void {
	for (const selector of ["#panels", "#composer"]) {
		const el = doc.querySelector<HTMLElement>(selector);
		if (hidden) el?.setAttribute("hidden", "");
		else el?.removeAttribute("hidden");
	}
}

function paintSessionPanels(
	doc: Document,
	state: GameState,
	aiIds: readonly AiId[],
): void {
	doc.querySelectorAll<HTMLElement>(".ai-panel").forEach((panel, idx) => {
		const aiId = aiIds[idx];
		if (!aiId) return;
		panel.dataset.ai = aiId;
		const persona = state.personas[aiId];
		if (!persona) return;
		panel.style.setProperty("--panel-color", persona.color);
		initPanelChrome(panel, persona);
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

function wireComposerInput(ctx: GameViewContext): void {
	ctx.promptInput.addEventListener("input", () => refreshComposerState(ctx));
	ctx.promptInput.addEventListener("scroll", () => syncOverlayScroll(ctx));
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
	paintLockoutError(ctx.doc, state.lockoutError);
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

function registerPanelClickHandlers(
	ctx: GameViewContext,
	aiIds: readonly AiId[],
): void {
	for (const aiId of aiIds) {
		const panel = findPanel(ctx.doc, aiId);
		if (!panel) continue;
		panel.addEventListener("click", () => addressPanel(ctx, panel));
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

function trySetCaret(input: HTMLInputElement, position: number): void {
	try {
		input.setSelectionRange(position, position);
	} catch {}
}

function appendMentionAwareText(
	parent: HTMLElement,
	text: string,
	personas: Record<string, { name: string; color?: string }>,
	nonMentionClass?: string,
): void {
	const doc = parent.ownerDocument;
	for (const segment of splitMentionSegments(text, personas)) {
		parent.appendChild(mentionSegmentNode(doc, segment, nonMentionClass));
	}
}

function mentionSegmentNode(
	doc: Document,
	segment: MentionSegment,
	nonMentionClass: string | undefined,
): Node {
	if (segment.kind === "text" && !nonMentionClass) {
		return doc.createTextNode(segment.text);
	}
	const span = doc.createElement("span");
	span.textContent = segment.text;
	if (segment.kind === "text") {
		span.className = nonMentionClass ?? "";
		return span;
	}
	span.className = "msg-mention";
	if (segment.color) span.style.setProperty("--mention-color", segment.color);
	return span;
}

function transcriptName(name: string): string {
	return name.toLowerCase();
}

function daemonPrefixSpan(
	doc: Document,
	personaName: string,
	color: string | undefined,
): HTMLElement {
	const span = doc.createElement("span");
	span.className = "msg-prefix";
	if (color) span.style.setProperty("--prefix-color", color);
	span.textContent = `> *${transcriptName(personaName)} `;
	return span;
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

function appendAiTokensToCurrentMsgLine(
	doc: Document,
	aiId: AiId,
	text: string,
): void {
	const el = getTranscriptEl(doc, aiId);
	if (!el) return;
	const last = el.lastElementChild as HTMLElement | null;
	const line = last?.classList.contains("msg-line") ? last : openMsgLine(el);
	line.dataset.body = (line.dataset.body ?? "") + text;
	const prefix = line.querySelector<HTMLElement>(":scope > .msg-prefix");
	while (line.lastChild && line.lastChild !== prefix) {
		line.removeChild(line.lastChild);
	}
	appendMentionAwareText(line, line.dataset.body, currentPersonas());
	scrollTranscriptToBottom(el);
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

function appendAiPrefix(doc: Document, aiId: AiId, personaName: string): void {
	const el = getTranscriptEl(doc, aiId);
	if (!el) return;
	const line = openMsgLine(el);
	const color = currentPersonas()[aiId]?.color;
	line.appendChild(daemonPrefixSpan(doc, personaName, color));
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
	const activeSession = session;
	if (!activeSession || !ctx.personaLookups) return;

	const draft = readSendableDraft(ctx, ctx.personaLookups);
	if (!draft) return;

	beginRound(ctx, activeSession, draft);

	const aiIds = Object.keys(activeSession.getState().personas);
	const spinners = startRoundSpinners(ctx.doc, aiIds);
	const initiativeOrder = fisherYatesShuffledCopy(aiIds);
	const outcome: RoundOutcome = { gameEnded: false };

	try {
		await playRound(ctx, activeSession, draft, initiativeOrder, {
			spinners,
			outcome,
		});
	} catch (err) {
		spinners.stripAll();
		reportRoundFailure(ctx, err);
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

	hideRoundError(doc);
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
		let frame = 0;
		const intervalId = setInterval(() => {
			frame = (frame + 1) % BRAILLE_SPINNER_FRAMES.length;
			const text = brailleFrameText(frame);
			for (const spinnerEl of els) spinnerEl.textContent = text;
		}, SPINNER_INTERVAL_MS);
		spinners.set(aiId, { els, intervalId });
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

async function playRound(
	ctx: GameViewContext,
	activeSession: GameSession,
	draft: RoundDraft,
	initiativeOrder: AiId[],
	{ spinners, outcome }: { spinners: RoundSpinners; outcome: RoundOutcome },
): Promise<void> {
	const rawProvider = new BrowserLLMProvider({
		disableReasoning: !ctx.enableReasoning,
	});
	const provider = ctx.dev.recordingProvider(rawProvider, activeSession);
	const { result, nextState } = await activeSession.submitMessage(
		draft.addressee,
		draft.message,
		provider,
		initiativeOrder,
		undefined,
		(aiId) => spinners.strip(aiId),
		ctx.dev.lifecycleListener,
	);

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

	if (!outcome.gameEnded) {
		const saveResult = saveActiveSession(nextState);
		if (!saveResult.ok) {
			showPersistenceWarning(ctx.persistenceWarningEl, saveResult.reason);
		}
	}
}

function applyRoundEvent(
	ctx: GameViewContext,
	event: SseEvent,
	nextState: GameState,
	outcome: RoundOutcome,
): void {
	switch (event.type) {
		case "ai_start":
		case "token":
		case "ai_end":
		case "system_broadcast":
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
			enterEndgame(ctx);
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
	const daemonName = nextState.personas[daemonId]?.name ?? daemonId;
	appendAiPrefix(doc, daemonId, daemonName);
	appendAiTokensToCurrentMsgLine(doc, daemonId, `${event.content}\n`);
}

function reportRoundFailure(ctx: GameViewContext, err: unknown): void {
	if (err instanceof CapHitError && ctx.capHitEl) {
		ctx.capHitEl.removeAttribute("hidden");
		return;
	}
	ctx.connectionUnstable = true;
	showRoundError(ctx.doc);
}

function enterEndgame(ctx: GameViewContext): void {
	const { doc } = ctx;
	ctx.sendBtn.disabled = true;
	ctx.promptInput.disabled = true;

	const endedSessionId = getActiveSessionId();
	const endedState = session?.getState();
	releaseSession();

	showEndgameScreen(doc);
	wireEndgameChoices(ctx.root, endedSessionId, endedState);
	wireSaveDownload(doc, endedState);
	wireDiagnosticsSubmit(doc);
}

function showEndgameScreen(doc: Document): void {
	for (const selector of ["#panels", "#composer", "#cap-hit"]) {
		const el = doc.querySelector<HTMLElement>(selector);
		if (el) el.hidden = true;
	}
	doc.querySelector<HTMLElement>("#endgame")?.removeAttribute("hidden");
}

function wireEndgameChoices(
	root: HTMLElement,
	endedSessionId: string | null,
	endedState: GameState | undefined,
): void {
	const doc = root.ownerDocument;
	const newDaemonsBtn = doc.querySelector<HTMLButtonElement>(
		"#endgame-new-daemons-btn",
	);
	const sameDaemonsBtn = doc.querySelector<HTMLButtonElement>(
		"#endgame-same-daemons-btn",
	);
	const continueBtn = doc.querySelector<HTMLButtonElement>(
		"#endgame-continue-btn",
	);
	const choiceStatus = doc.querySelector<HTMLElement>("#endgame-choice-status");

	const hasOpenRouterKey = localStorage.getItem("openrouter_key") !== null;
	if (continueBtn && hasOpenRouterKey) {
		continueBtn.removeAttribute("hidden");
	}

	const disableChoiceButtons = (): void => {
		for (const btn of [newDaemonsBtn, sameDaemonsBtn, continueBtn]) {
			if (btn) btn.disabled = true;
		}
	};
	const setStatus = (text: string): void => {
		if (choiceStatus) choiceStatus.textContent = text;
	};

	newDaemonsBtn?.addEventListener("click", () => {
		disableChoiceButtons();
		startWithNewDaemons(root, endedSessionId, setStatus);
	});
	sameDaemonsBtn?.addEventListener("click", () => {
		disableChoiceButtons();
		restartWithSameDaemons(root, endedSessionId, endedState, setStatus);
	});
	continueBtn?.addEventListener("click", () => {
		disableChoiceButtons();
		continueInNewRoom(root, endedState, setStatus);
	});
}

function archiveIfKnown(sessionId: string | null): Promise<void> {
	return sessionId ? archiveSession(sessionId) : Promise.resolve();
}

function startWithNewDaemons(
	root: HTMLElement,
	endedSessionId: string | null,
	setStatus: (text: string) => void,
): void {
	setStatus("archiving…");
	const restart = (): void => {
		clearActiveSession();
		releaseSession();
		renderApp(root);
	};
	archiveIfKnown(endedSessionId).then(restart).catch(restart);
}

function restartWithSameDaemons(
	root: HTMLElement,
	endedSessionId: string | null,
	endedState: GameState | undefined,
	setStatus: (text: string) => void,
): void {
	if (!endedState) {
		renderApp(root);
		return;
	}
	setStatus("archiving…");
	archiveIfKnown(endedSessionId)
		.then(() => {
			setStatus("spinning up a new room…");
			return buildSameDaemonsSession(endedState.personas);
		})
		.then((newSess) => {
			clearActiveSession();
			mintAndActivateNewSession();
			saveActiveSession(newSess.getState());
			releaseSession();
			gameEndHandled = false;
			renderApp(root);
		})
		.catch(() => {
			clearActiveSession();
			releaseSession();
			renderApp(root);
		});
}

function continueInNewRoom(
	root: HTMLElement,
	endedState: GameState | undefined,
	setStatus: (text: string) => void,
): void {
	if (!endedState) {
		renderApp(root);
		return;
	}
	setStatus("spinning up a new room…");
	buildSameDaemonsSession(endedState.personas)
		.then((newSess) => {
			saveActiveSession(
				appendBroadcast(newSess.getState(), NEW_ROOM_BROADCAST),
			);
			releaseSession();
			gameEndHandled = false;
			renderApp(root);
		})
		.catch(() => {
			releaseSession();
			renderApp(root);
		});
}

function wireSaveDownload(
	doc: Document,
	endedState: GameState | undefined,
): void {
	const downloadBtn = doc.querySelector<HTMLButtonElement>("#download-ais-btn");
	const downloadStatusEl = doc.querySelector<HTMLElement>("#download-status");
	if (!downloadBtn || !endedState) return;
	downloadBtn.dataset.savePayload = JSON.stringify(
		serializeGameSave(endedState),
	);
	downloadBtn.addEventListener("click", () => {
		downloadSavePayload(doc, downloadBtn.dataset.savePayload ?? "{}");
		downloadBtn.disabled = true;
		if (downloadStatusEl) downloadStatusEl.textContent = "Saved.";
	});
}

function downloadSavePayload(doc: Document, payload: string): void {
	const blob = new Blob([payload], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = doc.createElement("a");
	a.href = url;
	a.download = "hi-blue-save.json";
	doc.body.appendChild(a);
	a.click();
	doc.body.removeChild(a);
	URL.revokeObjectURL(url);
}

function wireDiagnosticsSubmit(doc: Document): void {
	const submitBtn = doc.querySelector<HTMLButtonElement>(
		"#submit-diagnostics-btn",
	);
	const summaryInput = doc.querySelector<HTMLInputElement>(
		"#diagnostics-summary",
	);
	const statusEl = doc.querySelector<HTMLElement>("#diagnostics-status");
	if (!submitBtn || !summaryInput || !statusEl) return;
	submitBtn.addEventListener("click", () => {
		const summary = summaryInput.value.trim();
		if (!summary) {
			statusEl.textContent = "Please enter a one-word summary first.";
			return;
		}
		const downloaded =
			doc.querySelector<HTMLButtonElement>("#download-ais-btn")?.disabled ??
			false;
		const markSubmitted = (): void => {
			statusEl.textContent = "Diagnostics submitted.";
		};
		fetch(`${__WORKER_BASE_URL__}/diagnostics`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ downloaded, summary }),
			mode: "no-cors",
		})
			.then(markSubmitted)
			.catch(markSubmitted);
	});
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

function renderBootstrapLoadingFlow(
	ctx: GameViewContext,
	pending: PendingBootstrap,
): Promise<void> {
	const { doc } = ctx;
	revealGameRouteChrome(doc);
	paintBannerOnce(doc);
	resetPanelsToEmptyShells(doc.querySelectorAll<HTMLElement>(".ai-panel"));

	showComposerAsLoading(ctx.promptInput);
	ctx.sendBtn.disabled = true;

	setStageLoadState(doc, "loading-daemons");
	renderLoadingTopInfo(doc, "loading-daemons");
	ctx.dev.showPendingBootstrap(ctx.root, pending);

	const timers: LoadingTimers = {
		spinnerInterval: undefined,
		wipeRaf: undefined,
	};
	return runBootstrapChain(ctx, pending, timers).catch((err: unknown) =>
		handleBootstrapFailure(ctx, pending, timers, err),
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
	pending: PendingBootstrap,
	timers: LoadingTimers,
): Promise<void> {
	const bootstrapPromise = pending.personasPromise
		.then((personas) => {
			enterGeneratingRoom(ctx, pending, timers, personas);
			return pending.contentPacksPromise.then(
				({ packsA, packsB, objectiveTypes }) => ({
					personas,
					contentPacksA: packsA,
					contentPacksB: packsB,
					objectiveTypes,
				}),
			);
		})
		.then((assets) => handOverBootstrappedSession(ctx, timers, assets));

	return withBootstrapTimeout(bootstrapPromise);
}

function enterGeneratingRoom(
	ctx: GameViewContext,
	pending: PendingBootstrap,
	timers: LoadingTimers,
	personas: Record<AiId, AiPersona>,
): void {
	const { doc } = ctx;
	paintLoadingPersonaPanels(doc, personas);
	setStageLoadState(doc, "generating-room");
	renderLoadingTopInfo(doc, "generating-room");
	ctx.dev.showPendingBootstrap(ctx.root, pending);
	startLoadingSpinners(doc, timers);
	startBrightnessWipe(doc, timers);
}

function paintLoadingPersonaPanels(
	doc: Document,
	personas: Record<AiId, AiPersona>,
): void {
	const ids = Object.keys(personas);
	doc.querySelectorAll<HTMLElement>(".ai-panel").forEach((panel, idx) => {
		const aiId = ids[idx];
		if (!aiId) return;
		const persona = personas[aiId];
		if (!persona) return;
		panel.dataset.ai = aiId;
		panel.style.setProperty("--panel-color", persona.color);
		initPanelChrome(panel, persona);
		appendPanelSpinners(panel);
	});
}

function startLoadingSpinners(doc: Document, timers: LoadingTimers): void {
	let frame = 0;
	timers.spinnerInterval = setInterval(() => {
		frame = (frame + 1) % BRAILLE_SPINNER_FRAMES.length;
		const text = brailleFrameText(frame);
		for (const spinnerEl of doc.querySelectorAll<HTMLElement>(
			".panel-name .panel-spinner",
		)) {
			spinnerEl.textContent = text;
		}
	}, SPINNER_INTERVAL_MS);
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
		".panel-name .panel-spinner",
	)) {
		spinnerEl.remove();
	}
}

function handOverBootstrappedSession(
	ctx: GameViewContext,
	timers: LoadingTimers,
	assets: NewGameAssets,
): Promise<void> | undefined {
	const { doc } = ctx;
	cleanupLoadingTimers(timers);
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
	if (!saveResult.ok) {
		showPersistenceWarning(ctx.persistenceWarningEl, saveResult.reason);
	}
	clearPendingBootstrap();

	removeAllPanelSpinners(doc);
	dismissStaleBootstrapRecovery(doc);
	setStageLoadState(doc, "stable");

	ctx.promptInput.disabled = false;
	ctx.promptInput.placeholder = "";

	session = built;
	hydratedSessionId = getActiveSessionId();
	return renderGame(ctx.root, ctx.opts);
}

function dropListenersByCloning<T extends Element>(el: T): T {
	const clone = el.cloneNode(true) as T;
	el.replaceWith(clone);
	return clone;
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

function handleBootstrapFailure(
	ctx: GameViewContext,
	pending: PendingBootstrap,
	timers: LoadingTimers,
	err: unknown,
): void {
	cleanupLoadingTimers(timers);
	ctx.dev.showPendingBootstrap(ctx.root, pending);

	if (err instanceof CapHitError && ctx.capHitEl) {
		ctx.capHitEl.removeAttribute("hidden");
		setGameSurfaceHidden(ctx.doc, true);
		return;
	}

	showBootstrapRecovery(ctx, timers, err instanceof BootstrapTimeoutError);
}

function showBootstrapRecovery(
	ctx: GameViewContext,
	timers: LoadingTimers,
	timedOut: boolean,
): void {
	const { doc, root } = ctx;
	const recoveryEl = doc.querySelector<HTMLElement>("#bootstrap-recovery");
	const recoveryTitleEl = doc.querySelector<HTMLElement>(
		"#bootstrap-recovery-title",
	);
	const recoveryBodyEl = doc.querySelector<HTMLElement>(
		"#bootstrap-recovery-body",
	);

	const recoveryUiMissing = !recoveryEl || !recoveryTitleEl || !recoveryBodyEl;
	if (recoveryUiMissing) {
		abandonBootstrap(root);
		return;
	}

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
	setGameSurfaceHidden(doc, true);
	setStageLoadState(doc, "unstable");

	wireRegenerateButton(ctx, timers, recoveryEl);
	wireAbandonLink(root);
}

function abandonBootstrap(root: HTMLElement): void {
	clearActiveSession();
	clearPendingBootstrap();
	renderApp(root, { reason: "broken" });
}

function wireRegenerateButton(
	ctx: GameViewContext,
	timers: LoadingTimers,
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
		void runRegenerate(ctx, timers, recoveryEl, staleRegenBtn);
	});
}

async function runRegenerate(
	ctx: GameViewContext,
	timers: LoadingTimers,
	recoveryEl: HTMLElement,
	regenBtn: HTMLButtonElement,
): Promise<void> {
	const { doc } = ctx;
	recoveryEl.setAttribute("hidden", "");
	doc
		.querySelector<HTMLElement>("#persistence-warning")
		?.setAttribute("hidden", "");
	setGameSurfaceHidden(doc, false);
	showComposerAsLoading(ctx.promptInput);

	regenBtn.disabled = true;

	const pendingWithCachedPersonas = restartContentPacks();

	try {
		await runBootstrapChain(ctx, pendingWithCachedPersonas, timers);
	} catch (regenErr: unknown) {
		cleanupLoadingTimers(timers);
		showRegenerateFailure(ctx, recoveryEl, regenErr);
	} finally {
		regenBtn.disabled = false;
	}
}

function showRegenerateFailure(
	ctx: GameViewContext,
	recoveryEl: HTMLElement,
	regenErr: unknown,
): void {
	if (regenErr instanceof CapHitError && ctx.capHitEl) {
		ctx.capHitEl.removeAttribute("hidden");
		recoveryEl.setAttribute("hidden", "");
		setGameSurfaceHidden(ctx.doc, true);
		return;
	}
	recoveryEl.removeAttribute("hidden");
	setGameSurfaceHidden(ctx.doc, true);
	setStageLoadState(ctx.doc, "unstable");
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
