import { type LoadState, topInfoStatus } from "../bbs-chrome.js";
import {
	buildSessionFromAssets,
	type NewGameAssets,
	newGameAssets,
} from "../game/bootstrap.js";
import type { GameSession } from "../game/game-session.js";
import {
	clearPendingBootstrap,
	failPendingBootstrap,
	type PendingBootstrap,
	restartContentPacks,
} from "../game/pending-bootstrap.js";
import { getSpikeRng } from "../game/spike-seed.js";
import type { AiId, AiPersona } from "../game/types";
import { CapHitError, upstreamMessageOf } from "../llm-client.js";
import {
	clearActiveSession,
	getActiveSessionId,
	loadActiveSession,
	saveActiveSession,
} from "../persistence/session-storage.js";
import { renderApp } from "../render-app.js";
import { dropListenersByCloning } from "./dom.js";
import {
	animateSpinners,
	appendPanelSpinners,
	hidePersistenceWarning,
	paintBannerOnce,
	paintPersonaPanels,
	paintTopInfo,
	revealGameRouteChrome,
	setGameSurfaceHidden,
	setStageLoadState,
	showPersistenceWarning,
	UNKNOWN_SESSION_ID,
} from "./game-chrome.js";

export const BOOTSTRAP_LOADING_TIMEOUT_MS = 300_000;

const LOADING_PLACEHOLDER = "loading…";
const PANEL_SPINNER_SELECTOR = ".panel-name .panel-spinner";
const BRIGHTNESS_WIPE_TAU_MS = 60_000;
const BRIGHTNESS_WIPE_MAX_PCT = 99;
const NEW_GAME_EPOCH = 1;

interface LoadingTimers {
	spinnerInterval: ReturnType<typeof setInterval> | undefined;
	wipeRaf: ReturnType<typeof requestAnimationFrame> | undefined;
}

interface LoadingFlow {
	sessionId: string | null;
	pending: PendingBootstrap;
	timers: LoadingTimers;
	blockedBy: "cap-hit" | "recovery" | null;
	adopt: AdoptBootstrappedSession;
}

export interface BootstrapFlowView {
	root: HTMLElement;
	doc: Document;
	promptInput: HTMLInputElement;
	sendBtn: HTMLButtonElement;
	capHitEl: HTMLElement | null;
	persistenceWarningEl: HTMLElement | null;
	dev: {
		showPendingBootstrap(root: HTMLElement, pending: PendingBootstrap): void;
	};
}

export type AdoptBootstrappedSession = (
	built: GameSession,
	sessionId: string | null,
) => Promise<void>;

let loadingFlow: LoadingFlow | null = null;

function renderLoadingTopInfo(doc: Document, state: LoadState): void {
	paintTopInfo(
		doc,
		{
			sessionId: getActiveSessionId() ?? UNKNOWN_SESSION_ID,
			epoch: NEW_GAME_EPOCH,
			turn: 0,
		},
		topInfoStatus(state),
	);
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

export function enterBootstrapLoading(
	ctx: BootstrapFlowView,
	pending: PendingBootstrap,
	adopt: AdoptBootstrappedSession,
): Promise<void> {
	const runningFlow = runningLoadingFlowFor(pending);
	if (!runningFlow) return renderBootstrapLoadingFlow(ctx, pending, adopt);
	revealRunningLoadingFlow(ctx, runningFlow);
	return Promise.resolve();
}

function runningLoadingFlowFor(pending: PendingBootstrap): LoadingFlow | null {
	const running =
		loadingFlow !== null &&
		loadingFlow.pending === pending &&
		loadingFlow.sessionId === getActiveSessionId();
	return running ? loadingFlow : null;
}

function revealRunningLoadingFlow(
	ctx: BootstrapFlowView,
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
	ctx: BootstrapFlowView,
	pending: PendingBootstrap,
	adopt: AdoptBootstrappedSession,
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

	const flow: LoadingFlow = {
		sessionId: getActiveSessionId(),
		pending,
		timers: { spinnerInterval: undefined, wipeRaf: undefined },
		blockedBy: null,
		adopt,
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
	ctx: BootstrapFlowView,
	flow: LoadingFlow,
): Promise<void> {
	const { pending } = flow;
	const bootstrapPromise = pending.personasPromise
		.then((personas) => {
			enterGeneratingRoom(ctx, flow, personas);
			return pending.contentPacksPromise.then((packs) =>
				newGameAssets(personas, packs),
			);
		})
		.then((assets) => handOverBootstrappedSession(ctx, flow, assets));

	return withBootstrapTimeout(bootstrapPromise, (err) =>
		failPendingBootstrap(pending, err),
	);
}

function enterGeneratingRoom(
	ctx: BootstrapFlowView,
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
	ctx: BootstrapFlowView,
	flow: LoadingFlow,
	assets: NewGameAssets,
): Promise<void> | undefined {
	const { doc } = ctx;
	cleanupLoadingTimers(flow.timers);
	forgetLoadingFlow(flow);
	if (loadingFlowAbandoned(flow)) return;
	const gameSessionRng = getSpikeRng("gameSession");
	const built = buildSessionFromAssets(
		assets,
		gameSessionRng ? { rng: gameSessionRng } : undefined,
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

	const rendered = flow.adopt(built, flow.sessionId);
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
	ctx: BootstrapFlowView,
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
	ctx: BootstrapFlowView,
	flow: LoadingFlow,
	recoveryEl: HTMLElement,
): void {
	flow.blockedBy = "recovery";
	recoveryEl.removeAttribute("hidden");
	setGameSurfaceHidden(ctx.doc, true);
	setStageLoadState(ctx.doc, "unstable");
}

function handleBootstrapFailure(
	ctx: BootstrapFlowView,
	flow: LoadingFlow,
	err: unknown,
): void {
	if (failedFlowAbandoned(flow)) return;
	ctx.dev.showPendingBootstrap(ctx.root, flow.pending);
	if (blockFlowOnCapHit(ctx, flow, err)) return;
	showBootstrapRecovery(ctx, flow, err);
}

function showBootstrapRecovery(
	ctx: BootstrapFlowView,
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
	ctx: BootstrapFlowView,
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
	ctx: BootstrapFlowView,
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
	ctx: BootstrapFlowView,
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
