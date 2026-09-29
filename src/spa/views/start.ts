import type { BootstrapOpts } from "../game/bootstrap.js";
import {
	getPendingBootstrap,
	type PendingBootstrap,
	startBootstrap,
} from "../game/pending-bootstrap.js";
import { getSpikeRng, setSpikeSeed } from "../game/spike-seed.js";
import { CapHitError, upstreamMessageOf } from "../llm-client.js";
import { type RenderOpts, renderApp } from "../render-app.js";
import {
	renderReasonBanner,
	VERSION_MISMATCH_MESSAGE,
} from "./archived-build-link.js";
import { tryFocus, trySetCaret } from "./dom.js";

const PERSISTENCE_WARNING_MESSAGES: Record<string, string> = {
	broken:
		"Saved game data was unreadable and has been discarded. Starting a new game.",
	"version-mismatch": VERSION_MISMATCH_MESSAGE,
	"legacy-save-discarded":
		"Saved game data from an older format has been discarded. Starting a new game.",
	stuck:
		"Game initialization took too long and was cancelled. Starting a new game.",
};

const ACCEPTED_PASSWORD = "password";
const ENGAGEMENT_CLAUSES_ON = "1";
const ACTION_PROFILES_OFF = "0";

const DIAL_START_DELAY_MS = 280;
const DIAL_CHAR_MS_INDENTED_LINE = 8;
const DIAL_CHAR_MS = 18;
const DIAL_PAUSE_AFTER_RINGING_MS = 360;
const DIAL_PAUSE_AFTER_LINE_MS = 140;
const REVEAL_LOGIN_AFTER_DIAL_MS = 220;
const UPTIME_REFRESH_MS = 60_000;

const CHAR_WIDTH_PROBE_LENGTH = 200;
const FALLBACK_CHAR_WIDTH_PX = 8;
const MIN_LANDSCAPE_COLS = 40;

const DIAL_LINES: ReadonlyArray<{ typed: string; statusHtml: string }> = [
	{
		typed: "> initializing modem ........................... ",
		statusHtml: '<span class="ok">ok</span>',
	},
	{ typed: "> ATZ\n  OK\n", statusHtml: "" },
	{
		typed: "> ATDT 1-5555-HI-BLUE .......................... ",
		statusHtml: '<span class="hot">dialing</span>',
	},
	{ typed: "  ringing... ringing... ringing...\n", statusHtml: "" },
	{ typed: "  CONNECT 56000/ARQ/V90/LAPM/V42BIS\n", statusHtml: "" },
	{
		typed: "> negotiating telnet IAC ....................... ",
		statusHtml: '<span class="ok">ok</span>',
	},
	{
		typed: "> requesting ANSI/BBS terminal ................. ",
		statusHtml: '<span class="ok">ok</span>',
	},
	{
		typed: "> hi-blue.bbs · node 01/01 ..................... ",
		statusHtml: '<span class="ok">connected</span>\n\n',
	},
];

function dialLineHtml(line: { typed: string; statusHtml: string }): string {
	const endsLine = line.typed.endsWith("\n") || line.statusHtml.includes("\n");
	return `${line.typed}${line.statusHtml}${endsLine ? "" : "\n"}`;
}

function renderDialTranscriptHtml(): string {
	return DIAL_LINES.map(dialLineHtml).join("");
}

function prefersReducedMotion(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

function shouldSkipAnimation(searchParams: URLSearchParams): boolean {
	if (searchParams.get("skipDialup") === "1") return true;
	return prefersReducedMotion();
}

function setTimeoutUnlessAborted(
	signal: AbortSignal,
	callback: () => void,
	delayMs: number,
): void {
	setTimeout(() => {
		if (!signal.aborted) callback();
	}, delayMs);
}

function typeDialUp(
	dialEl: HTMLElement,
	signal: AbortSignal,
	onDone: () => void,
): void {
	let buffer = "";
	let i = 0;

	const next = () => {
		if (i >= DIAL_LINES.length) {
			dialEl.innerHTML = buffer;
			onDone();
			return;
		}
		const line = DIAL_LINES[i++];
		if (!line) return;
		const full = line.typed;
		let charIdx = 0;
		let prefix = buffer;
		const tick = () => {
			if (charIdx < full.length) {
				prefix += full.charAt(charIdx);
				charIdx++;
				dialEl.innerHTML = `${prefix}<span class="blinkonly">▍</span>`;
				const isIndentedLine = full.startsWith("  ");
				setTimeoutUnlessAborted(
					signal,
					tick,
					isIndentedLine ? DIAL_CHAR_MS_INDENTED_LINE : DIAL_CHAR_MS,
				);
			} else {
				buffer += dialLineHtml(line);
				dialEl.innerHTML = `${buffer}<span class="blinkonly">▍</span>`;
				const pause = full.includes("ringing")
					? DIAL_PAUSE_AFTER_RINGING_MS
					: DIAL_PAUSE_AFTER_LINE_MS;
				setTimeoutUnlessAborted(signal, next, pause);
			}
		};
		tick();
	};
	setTimeoutUnlessAborted(signal, next, DIAL_START_DELAY_MS);
}

const LANDSCAPE_VARIANTS: ReadonlyArray<readonly [string, string, string]> = [
	["       ╱╲         ", "      ╱  ╲   ╱╲   ", "─────╱    ╲─╱  ╲──"],
	["                  ", "   ╱╲      ╱╲     ", "──╱  ╲────╱  ╲────"],
	["        ╱╲        ", "   ╱╲  ╱  ╲       ", "──╱  ╲╱    ╲──────"],
	["     ╱╲           ", "    ╱  ╲  ╱╲   ╱╲ ", "───╱    ╲╱  ╲─╱  ╲"],
	["                  ", "    ╱╲    ╱╲  ╱╲  ", "───╱  ╲──╱  ╲╱  ╲─"],
	["        ╱╲        ", "       ╱  ╲       ", "──────╱    ╲──────"],
];
const LANDSCAPE_ORDER = [0, 3, 1, 5, 2, 4, 0, 2, 5, 1, 3, 4];

function paintLandscape(keyart: HTMLElement): void {
	if (!keyart || keyart.offsetParent === null) return;
	const doc = keyart.ownerDocument;
	const probe = doc.createElement("span");
	const cs = doc.defaultView?.getComputedStyle(keyart);
	if (cs) {
		probe.style.fontFamily = cs.fontFamily;
		probe.style.fontSize = cs.fontSize;
		probe.style.fontWeight = cs.fontWeight;
	}
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.whiteSpace = "pre";
	probe.textContent = "─".repeat(CHAR_WIDTH_PROBE_LENGTH);
	doc.body.appendChild(probe);
	const charW =
		probe.getBoundingClientRect().width / CHAR_WIDTH_PROBE_LENGTH ||
		FALLBACK_CHAR_WIDTH_PX;
	doc.body.removeChild(probe);
	const cols = Math.max(
		MIN_LANDSCAPE_COLS,
		Math.floor(keyart.clientWidth / charW) - 1,
	);

	const buildLine = (rowIdx: 0 | 1 | 2): string => {
		let s = "";
		for (let i = 0; s.length < cols; i++) {
			const variantIdx = LANDSCAPE_ORDER[i % LANDSCAPE_ORDER.length] ?? 0;
			s += LANDSCAPE_VARIANTS[variantIdx]?.[rowIdx] ?? "";
		}
		return s.slice(0, cols);
	};

	const sky = Array<string>(cols).fill(" ");
	sky[0] = "◯";
	const glyphs = [".", "*", ".", "*", ".", "*", "."];
	for (let i = 0; i < glyphs.length; i++) {
		const pos = Math.floor(((i + 1) * cols) / (glyphs.length + 1));
		const glyph = glyphs[i];
		if (glyph !== undefined && pos > 2 && pos < cols - 1) sky[pos] = glyph;
	}

	keyart.textContent = [
		"─".repeat(cols),
		sky.join(""),
		buildLine(0),
		buildLine(1),
		buildLine(2),
	].join("\n");
}

function attachPasswordMask(pwEl: HTMLInputElement, signal: AbortSignal): void {
	pwEl.addEventListener(
		"input",
		() => {
			const prev = pwEl.dataset.real || "";
			const shown = pwEl.value;
			let real = "";
			for (let i = 0; i < shown.length; i++) {
				real += shown[i] === "*" ? prev[i] || "" : shown[i];
			}
			pwEl.dataset.real = real;
			const caret = pwEl.selectionStart;
			pwEl.value = "*".repeat(real.length);
			if (caret !== null) trySetCaret(pwEl, caret);
		},
		{ signal },
	);
}

let _connectSubmitInFlight = false;
let _previousRender: AbortController | undefined;

function abortPreviousRender(): AbortSignal {
	_previousRender?.abort();
	_previousRender = new AbortController();
	return _previousRender.signal;
}

function bootstrapFailureText(err: unknown): string {
	const upstreamMessage = upstreamMessageOf(err);
	return upstreamMessage === null
		? "> the daemons failed to wake"
		: `> the daemons failed to wake (${upstreamMessage})`;
}

function logBootstrapFailure(err: unknown): void {
	console.error("[start] generation failed", err);
}

function formatUptime(elapsedMs: number): string {
	const safe = Math.max(0, Math.floor(elapsedMs / 1000));
	const days = Math.floor(safe / 86400);
	const hours = Math.floor((safe % 86400) / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
}

export function renderStart(
	root: HTMLElement,
	opts?: RenderOpts,
): Promise<void> {
	const doc = root.ownerDocument;

	const startScreenEl = doc.querySelector<HTMLElement>("#start-screen");
	const panelsEl = doc.querySelector<HTMLElement>("#panels");
	const composerEl = doc.querySelector<HTMLElement>("#composer");
	const sessionsScreenEl = doc.querySelector<HTMLElement>("#sessions-screen");
	const endgameEl = doc.querySelector<HTMLElement>("#endgame");

	if (panelsEl) panelsEl.hidden = true;
	if (composerEl) composerEl.hidden = true;
	if (sessionsScreenEl) sessionsScreenEl.hidden = true;
	if (endgameEl) endgameEl.hidden = true;
	if (startScreenEl) startScreenEl.hidden = false;

	const headerEl = doc.querySelector<HTMLElement>("#stage > header");
	const topinfoEl = doc.querySelector<HTMLElement>("#topinfo");
	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (headerEl) headerEl.hidden = true;
	if (topinfoEl) topinfoEl.hidden = true;
	if (bannerEl) bannerEl.hidden = true;

	const persistenceWarningEl = doc.querySelector<HTMLElement>(
		"#persistence-warning",
	);
	if (persistenceWarningEl) {
		const shown = renderReasonBanner(
			doc,
			persistenceWarningEl,
			opts?.reason ?? null,
			opts?.schemaVersion,
			PERSISTENCE_WARNING_MESSAGES,
		);
		if (!shown) persistenceWarningEl.textContent = "";
		persistenceWarningEl.hidden = !shown;
	}

	const beginBtn = doc.querySelector<HTMLButtonElement>("#begin");
	if (!beginBtn) return Promise.resolve();

	const dialEl = doc.querySelector<HTMLElement>("#dial");
	const revealEl = doc.querySelector<HTMLElement>("#login-reveal");
	const pwEl = doc.querySelector<HTMLInputElement>("#password");
	const errorEl = doc.querySelector<HTMLElement>("#login-error");
	const formEl = doc.querySelector<HTMLFormElement>("#login-form");
	const keyartEl = doc.querySelector<HTMLElement>("#login-keyart");

	const showError = (msg: string) => {
		if (!errorEl) return;
		errorEl.textContent = msg;
		errorEl.removeAttribute("hidden");
	};
	const clearError = () => {
		if (!errorEl) return;
		errorEl.textContent = "";
		errorEl.setAttribute("hidden", "");
	};

	_connectSubmitInFlight = false;
	beginBtn.disabled = true;

	if (pwEl) {
		pwEl.value = "";
		pwEl.dataset.real = "";
		pwEl.disabled = false;
	}
	clearError();
	if (dialEl) dialEl.innerHTML = "";
	const postlogEl = doc.querySelector<HTMLElement>("#login-postlog");
	if (postlogEl) postlogEl.innerHTML = "";

	const signal = abortPreviousRender();

	const searchParams = new URLSearchParams(
		typeof location !== "undefined" ? location.search : "",
	);

	const skipAnimation = shouldSkipAnimation(searchParams);

	const revealLogin = () => {
		if (!revealEl) return;
		revealEl.hidden = false;
		beginBtn.disabled = false;
		const uptimeEl = doc.querySelector<HTMLElement>("#login-uptime");
		if (uptimeEl && __COMMIT_TIMESTAMP_MS__ > 0) {
			const tick = () => {
				uptimeEl.textContent = formatUptime(
					Date.now() - __COMMIT_TIMESTAMP_MS__,
				);
			};
			tick();
			const uptimeInterval = setInterval(tick, UPTIME_REFRESH_MS);
			signal.addEventListener("abort", () => clearInterval(uptimeInterval));
		}
		if (keyartEl) {
			paintLandscape(keyartEl);
			if (typeof window !== "undefined") {
				window.addEventListener("resize", () => paintLandscape(keyartEl), {
					signal,
				});
			}
		}
		if (pwEl) {
			attachPasswordMask(pwEl, signal);
			tryFocus(pwEl);
		}
	};

	if (skipAnimation) {
		if (dialEl) dialEl.innerHTML = renderDialTranscriptHtml();
		revealLogin();
	} else if (dialEl) {
		typeDialUp(dialEl, signal, () =>
			setTimeoutUnlessAborted(signal, revealLogin, REVEAL_LOGIN_AFTER_DIAL_MS),
		);
	} else {
		revealLogin();
	}

	const seedRaw = searchParams.get("seed");
	const seedNum = seedRaw !== null ? Number(seedRaw) : Number.NaN;
	if (Number.isFinite(seedNum)) {
		setSpikeSeed(seedNum | 0);
	}

	const engagementClauses =
		searchParams.get("engagementClauses") === ENGAGEMENT_CLAUSES_ON;
	const actionProfilesDisabled =
		searchParams.get("actionProfiles") === ACTION_PROFILES_OFF;

	const personasRng = getSpikeRng("personas");
	const contentPackRng = getSpikeRng("contentPack");
	const bootstrapOpts: BootstrapOpts = {
		...(personasRng && contentPackRng ? { personasRng, contentPackRng } : {}),
		...(engagementClauses ? { engagementClauses: true } : {}),
		...(actionProfilesDisabled ? { actionProfiles: false } : {}),
	};

	const bootstrapErrorEl = doc.querySelector<HTMLElement>(
		"#start-bootstrap-error",
	);
	const bootstrapErrorTextEl = doc.querySelector<HTMLElement>(
		"#start-bootstrap-error-text",
	);
	const bootstrapRetryBtn = doc.querySelector<HTMLButtonElement>(
		"#start-bootstrap-retry",
	);
	const hideBootstrapError = () => {
		bootstrapErrorEl?.setAttribute("hidden", "");
	};
	const showBootstrapError = (err: unknown) => {
		if (!bootstrapErrorEl) return;
		if (bootstrapErrorTextEl) {
			bootstrapErrorTextEl.textContent = bootstrapFailureText(err);
		}
		bootstrapErrorEl.removeAttribute("hidden");
	};
	hideBootstrapError();

	const reportGenerationFailure = (
		bootstrap: PendingBootstrap,
		err: unknown,
	): void => {
		const superseded = getPendingBootstrap() !== bootstrap;
		const startVisible = startScreenEl ? !startScreenEl.hidden : false;
		if (superseded || !startVisible) return;
		if (err instanceof CapHitError) {
			const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
			if (capHitEl) capHitEl.removeAttribute("hidden");
			if (startScreenEl) startScreenEl.setAttribute("hidden", "");
		} else {
			showBootstrapError(err);
		}
	};

	const watchGeneration = (bootstrap: PendingBootstrap): Promise<void> =>
		Promise.all([
			bootstrap.personasPromise,
			bootstrap.contentPacksPromise,
		]).then(
			() => undefined,
			(err: unknown) => {
				reportGenerationFailure(bootstrap, err);
				throw err;
			},
		);

	const restartFailedGeneration = () => {
		hideBootstrapError();
		watchGeneration(startBootstrap(bootstrapOpts)).catch(logBootstrapFailure);
	};

	if (bootstrapRetryBtn) {
		bootstrapRetryBtn.addEventListener("click", restartFailedGeneration, {
			signal,
		});
	}

	const proceedConnect = () => {
		if (_connectSubmitInFlight) return;
		_connectSubmitInFlight = true;
		beginBtn.disabled = true;
		if (pwEl) pwEl.disabled = true;
		clearError();
		if (getPendingBootstrap()?.status === "failed") restartFailedGeneration();
		renderApp(root);
	};

	const handleSubmit = (e?: Event) => {
		if (e) e.preventDefault();
		if (beginBtn.disabled) return;
		if (_connectSubmitInFlight) return;
		const real = pwEl?.dataset.real ?? "";
		if (real !== ACCEPTED_PASSWORD) {
			showError("> access denied — invalid credentials");
			if (pwEl) {
				pwEl.value = "";
				pwEl.dataset.real = "";
				tryFocus(pwEl);
			}
			return;
		}
		proceedConnect();
	};

	if (formEl) formEl.addEventListener("submit", handleSubmit, { signal });
	beginBtn.addEventListener("click", handleSubmit, { signal });

	const failedBootstrap = getPendingBootstrap();
	if (failedBootstrap?.status === "failed") {
		reportGenerationFailure(failedBootstrap, failedBootstrap.error);
		return Promise.reject(failedBootstrap.error);
	}
	return watchGeneration(startBootstrap(bootstrapOpts));
}
