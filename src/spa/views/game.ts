import { topInfoStatus } from "../bbs-chrome.js";
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
	getPendingBootstrap,
	type PendingBootstrap,
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
import type {
	AiId,
	AiPersona,
	ConversationEntry,
	GameState,
} from "../game/types";
import { CapHitError, upstreamMessageOf } from "../llm-client.js";
import {
	type ActiveSessionToken,
	captureActiveSession,
	clearActiveSession,
	deactivateActiveSession,
	getActiveSessionId,
	isSessionSaveInProgress,
	isSessionStorageKey,
	type LoadResult,
	listSessions,
	loadActiveSession,
	readSessionLastSavedAt,
	type SaveResult,
	saveActiveSession,
} from "../persistence/session-storage.js";
import { type RenderOpts, renderApp } from "../render-app.js";
import { trySetCaret } from "./dom.js";
import {
	enterBootstrapLoading,
	NEW_GAME_EPOCH,
} from "./game-bootstrap-flow.js";
import {
	animateSpinners,
	appendPanelSpinners,
	hidePersistenceWarning,
	paintBannerOnce,
	paintPersonaPanels,
	paintTopInfo,
	revealGameRouteChrome,
	showPersistenceWarning,
	UNKNOWN_SESSION_ID,
} from "./game-chrome.js";
import { showEndgame } from "./game-endgame.js";
import {
	appendMentionAwareText,
	type MessageEntry,
	PLAYER_ID,
	transcriptMessageLine,
} from "./transcript-lines.js";

const UNSET_PROMPT_TARGET = "/?????";

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

interface RoundSpinners {
	strip(aiId: AiId): void;
	stripAll(): void;
}

interface RoundDraft {
	addressee: AiId;
	message: string;
}

interface SubmittedDraft {
	promptPrefix: string;
	playerLine: HTMLElement | null;
}

interface RoundOutcome {
	gameEnded: boolean;
}

interface CachedSession {
	session: GameSession;
	token: ActiveSessionToken;
	epoch: number;
	lastSavedAt: string | null;
}

let cached: CachedSession | null = null;

let crossTabListenerWired = false;

let viewCtx: GameViewContext | null = null;

export function renderGame(
	root: HTMLElement,
	opts?: RenderOpts,
): Promise<void> {
	const ctx = enterGameViewContext(root, opts);
	if (!ctx) return Promise.resolve();
	hidePersistenceWarning(ctx.persistenceWarningEl);
	dropSessionIfActivePointerMoved();
	if (!cached) {
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
	const activePointerMoved = cached !== null && !cached.token.stillActive();
	if (!activePointerMoved) return;
	releaseSession();
}

function releaseSession(): void {
	cached = null;
}

function currentPersonas(): Record<AiId, AiPersona> {
	return cached?.session.getState().personas ?? {};
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
			return enterBootstrapLoading(ctx, pendingBootstrap, (built, sessionId) =>
				adoptBootstrappedSession(ctx, built, sessionId),
			);
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

function adoptBootstrappedSession(
	ctx: GameViewContext,
	built: GameSession,
	sessionId: string | null,
): Promise<void> {
	cached = {
		session: built,
		token: captureActiveSession(sessionId),
		epoch: NEW_GAME_EPOCH,
		lastSavedAt: sessionId === null ? null : readSessionLastSavedAt(sessionId),
	};
	return renderGame(ctx.root, ctx.opts);
}

function restoreActiveSession(ctx: GameViewContext): Promise<void> | null {
	const loadResult = loadActiveSession();
	if (loadResult.kind !== "ok") {
		redirectUnloadableSession(ctx.root, loadResult);
		return Promise.resolve();
	}
	cached = {
		session: GameSession.restore(loadResult.state),
		token: captureActiveSession(loadResult.sessionId),
		epoch: loadResult.epoch,
		lastSavedAt: loadResult.lastSavedAt,
	};
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
	if (cached !== null) cached.session = adoptSession(ctx, cached.session);

	revealGameRouteChrome(doc);
	ctx.promptInput.disabled = false;

	if (cached !== null) {
		const state = cached.session.getState();
		paintSessionPanels(doc, state);
		paintHandlesPlaceholder(ctx.promptInput, state.personas);
	}

	refreshComposerState(ctx);
	paintBannerOnce(doc);
	refreshTopInfo(ctx);

	if (cached === null) return;
	ctx.dev.showSession(ctx.root, cached.session);

	const restoredState = cached.session.getState();
	if (restoredState.isComplete) {
		enterEndgame(ctx, restoredState, cached.token.id);
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
	return adopted;
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
	if (!cached) return;
	const { doc } = ctx;
	const hasDesktopTopInfo =
		doc.querySelector("#topinfo-left") && doc.querySelector("#topinfo-right");
	if (!hasDesktopTopInfo) return;
	paintTopInfo(
		doc,
		{
			sessionId: ctx.sessionLabel,
			epoch: cached.epoch,
			turn: cached.session.getState().round,
		},
		topInfoStatus(ctx.connectionUnstable ? "unstable" : "stable"),
	);
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
	wireCrossTabReload(ctx.doc.defaultView);
}

function wireCrossTabReload(win: Window | null): void {
	if (crossTabListenerWired || !win) return;
	crossTabListenerWired = true;
	win.addEventListener("storage", (event) => {
		const ctx = viewCtx;
		if (!ctx || ctx.roundInFlight) return;
		const cachedSessionId = cached?.token.id ?? null;
		if (cachedSessionId === null) return;
		const touchesCachedSession =
			event.key === null || isSessionStorageKey(event.key, cachedSessionId);
		if (!touchesCachedSession) return;
		if (!cachedSessionChangedElsewhere(ctx)) return;
		reloadChangedSession(ctx, { warn: false });
	});
}

function cachedSessionChangedElsewhere(ctx: GameViewContext): boolean {
	if (cached === null) return false;
	const { id } = cached.token;
	const { lastSavedAt } = cached;
	if (id === null || lastSavedAt === null) return false;
	if (ctx.root.dataset.view !== "game") return false;
	if (isSessionSaveInProgress(id)) return false;
	return readSessionLastSavedAt(id) !== lastSavedAt;
}

function reloadChangedSession(
	ctx: GameViewContext,
	{ warn }: { warn: boolean },
): void {
	releaseSession();
	void renderGame(ctx.root, ctx.opts);
	if (warn) showPersistenceWarning(ctx.persistenceWarningEl, "stale");
}

function saveExpectation(lastSavedAt: string | null): {
	expectedLastSavedAt?: string;
} {
	return lastSavedAt === null ? {} : { expectedLastSavedAt: lastSavedAt };
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
): HTMLElement | null {
	const el = getTranscriptEl(doc, aiId);
	if (!el) return null;
	const line = openMsgLine(el);
	appendMentionAwareText(line, text, currentPersonas(), nonMentionClass);
	scrollTranscriptToBottom(el);
	return line;
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
	const owner = cached === null ? null : { ...cached };
	if (!owner || !ctx.personaLookups) return;

	const draft = readSendableDraft(ctx, ctx.personaLookups);
	if (!draft) return;

	const submitted = beginRound(ctx, owner.session, draft);

	const aiIds = Object.keys(owner.session.getState().personas);
	const spinners = startRoundSpinners(ctx.doc, aiIds);
	const initiativeOrder = fisherYatesShuffledCopy(aiIds);
	const outcome: RoundOutcome = { gameEnded: false };

	try {
		await playRound(ctx, owner, draft, initiativeOrder, {
			spinners,
			outcome,
		});
	} catch (err) {
		if (!playerLeftRoundSession(owner)) {
			reportRoundFailure(ctx, err);
			restoreFailedDraft(ctx, draft, submitted);
		}
	} finally {
		spinners.stripAll();
		ctx.roundInFlight = false;
		setRoundInFlightMarker(ctx.doc, false);
		if (!outcome.gameEnded) {
			refreshComposerState(ctx);
			refreshTopInfo(ctx);
		}
		if (!outcome.gameEnded && cachedSessionChangedElsewhere(ctx)) {
			reloadChangedSession(ctx, { warn: true });
		}
	}
}

function restoreFailedDraft(
	ctx: GameViewContext,
	draft: RoundDraft,
	submitted: SubmittedDraft,
): void {
	submitted.playerLine?.remove();
	const promptStillHoldsResetPrefix =
		ctx.promptInput.value === submitted.promptPrefix;
	if (!promptStillHoldsResetPrefix) return;
	ctx.promptInput.value = `${submitted.promptPrefix}${draft.message}`;
	refreshComposerState(ctx);
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
): SubmittedDraft {
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

	const playerLine = appendTranscriptLine(
		doc,
		draft.addressee,
		`> ${draft.message}\n`,
		"msg-you",
	);
	return { promptPrefix: addresseePrefix, playerLine };
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

function playerLeftRoundSession(owner: CachedSession): boolean {
	return cached?.session !== owner.session || !owner.token.stillActive();
}

async function playRound(
	ctx: GameViewContext,
	owner: CachedSession,
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
		saveRoundLeftBehind(ctx, owner, nextState);
		return;
	}

	const saveResult = saveActiveSession(nextState, {
		sessionId: owner.token.id,
		...saveExpectation(owner.lastSavedAt),
	});
	if (!saveResult.ok && saveResult.reason === "stale") {
		reloadChangedSession(ctx, { warn: true });
		return;
	}
	if (saveResult.lastSavedAt !== undefined && cached) {
		cached.lastSavedAt = saveResult.lastSavedAt;
	}

	for (const event of encodeRoundResult(
		result,
		nextState,
		nextState.personas,
	)) {
		applyRoundEvent(ctx, event, nextState, outcome);
	}

	if (cached) {
		ctx.dev.refreshAfterRound(
			ctx.doc,
			cached.session,
			Object.keys(nextState.personas),
		);
	}

	warnIfSaveFailed(ctx, saveResult);

	if (outcome.gameEnded) {
		refreshTopInfo(ctx);
		enterEndgame(ctx, nextState, owner.token.id);
	}
}

function warnIfSaveFailed(ctx: GameViewContext, saveResult: SaveResult): void {
	if (!saveResult.ok) {
		showPersistenceWarning(ctx.persistenceWarningEl, saveResult.reason);
	}
}

function saveRoundLeftBehind(
	ctx: GameViewContext,
	owner: CachedSession,
	nextState: GameState,
): void {
	const roundSessionId = owner.token.id;
	const roundSessionStillExists =
		roundSessionId !== null && listSessions().includes(roundSessionId);
	if (roundSessionStillExists) {
		saveActiveSession(nextState, {
			sessionId: roundSessionId,
			...saveExpectation(owner.lastSavedAt),
		});
	}
	const cachedSessionIsRoundSession = cached?.token.id === roundSessionId;
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

	showEndgame(ctx.root, endedState, endedSessionId, releaseSession);
}
