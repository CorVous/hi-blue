import {
	getPendingBootstrap,
	startBootstrap,
} from "../game/pending-bootstrap.js";
import { getSpikeRng, setSpikeSeed } from "../game/spike-seed.js";
import { type RenderOpts, renderApp } from "../render-app.js";
import {
	renderReasonBanner,
	VERSION_MISMATCH_MESSAGE,
} from "./archived-build-link.js";

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

function tryFocus(el: HTMLElement): void {
	try {
		el.focus();
	} catch {}
}

function trySetCaret(input: HTMLInputElement, position: number): void {
	try {
		input.setSelectionRange(position, position);
	} catch {}
}

function typeDialUp(dialEl: HTMLElement, onDone: () => void): void {
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
				setTimeout(
					tick,
					isIndentedLine ? DIAL_CHAR_MS_INDENTED_LINE : DIAL_CHAR_MS,
				);
			} else {
				buffer += dialLineHtml(line);
				dialEl.innerHTML = `${buffer}<span class="blinkonly">▍</span>`;
				const pause = full.includes("ringing")
					? DIAL_PAUSE_AFTER_RINGING_MS
					: DIAL_PAUSE_AFTER_LINE_MS;
				setTimeout(next, pause);
			}
		};
		tick();
	};
	setTimeout(next, DIAL_START_DELAY_MS);
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

function attachPasswordMask(pwEl: HTMLInputElement): void {
	pwEl.addEventListener("input", () => {
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
	});
}

let _connectSubmitInFlight = false;
let _activeResizeHandler: (() => void) | undefined;
let _activeUptimeInterval: ReturnType<typeof setInterval> | undefined;

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

	if (panelsEl) panelsEl.hidden = true;
	if (composerEl) composerEl.hidden = true;
	if (sessionsScreenEl) sessionsScreenEl.hidden = true;
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
	if (
		persistenceWarningEl &&
		renderReasonBanner(
			doc,
			persistenceWarningEl,
			opts?.reason ?? null,
			opts?.schemaVersion,
			PERSISTENCE_WARNING_MESSAGES,
		)
	) {
		persistenceWarningEl.removeAttribute("hidden");
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

	if (_activeResizeHandler && typeof window !== "undefined") {
		window.removeEventListener("resize", _activeResizeHandler);
		_activeResizeHandler = undefined;
	}

	if (_activeUptimeInterval !== undefined) {
		clearInterval(_activeUptimeInterval);
		_activeUptimeInterval = undefined;
	}

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
			_activeUptimeInterval = setInterval(tick, UPTIME_REFRESH_MS);
		}
		if (keyartEl) {
			paintLandscape(keyartEl);
			const handler = () => paintLandscape(keyartEl);
			_activeResizeHandler = handler;
			if (typeof window !== "undefined") {
				window.addEventListener("resize", handler);
			}
		}
		if (pwEl) {
			attachPasswordMask(pwEl);
			tryFocus(pwEl);
		}
	};

	if (skipAnimation) {
		if (dialEl) dialEl.innerHTML = renderDialTranscriptHtml();
		revealLogin();
	} else if (dialEl) {
		typeDialUp(dialEl, () =>
			setTimeout(revealLogin, REVEAL_LOGIN_AFTER_DIAL_MS),
		);
	} else {
		revealLogin();
	}

	const proceedConnect = () => {
		if (_connectSubmitInFlight) return;
		_connectSubmitInFlight = true;
		beginBtn.disabled = true;
		if (pwEl) pwEl.disabled = true;
		clearError();
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

	if (formEl) formEl.addEventListener("submit", handleSubmit);
	beginBtn.addEventListener("click", handleSubmit);

	const seedRaw = searchParams.get("seed");
	const seedNum = seedRaw !== null ? Number(seedRaw) : Number.NaN;
	if (Number.isFinite(seedNum)) {
		setSpikeSeed(seedNum | 0);
	}

	const engagementClauses =
		searchParams.get("engagementClauses") === ENGAGEMENT_CLAUSES_ON;
	const actionProfilesDisabled =
		searchParams.get("actionProfiles") === ACTION_PROFILES_OFF;

	const existing = getPendingBootstrap();
	const personasRng = getSpikeRng("personas");
	const contentPackRng = getSpikeRng("contentPack");
	const spikeOpts =
		personasRng && contentPackRng ? { personasRng, contentPackRng } : undefined;
	const engagementOpts = engagementClauses
		? { engagementClauses: true }
		: undefined;
	const actionProfileOpts = actionProfilesDisabled
		? { actionProfiles: false }
		: undefined;
	const mergedOpts =
		spikeOpts || engagementOpts || actionProfileOpts
			? { ...spikeOpts, ...engagementOpts, ...actionProfileOpts }
			: undefined;
	const bootstrap = existing ?? startBootstrap(mergedOpts);

	const generationPromise = (async () => {
		try {
			await Promise.all([
				bootstrap.personasPromise,
				bootstrap.contentPacksPromise,
			]);
		} catch (err) {
			const startVisible = startScreenEl ? !startScreenEl.hidden : false;
			if (startVisible) {
				const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
				if (capHitEl) capHitEl.removeAttribute("hidden");
				if (startScreenEl) startScreenEl.setAttribute("hidden", "");
			}
			throw err;
		}
	})();

	return generationPromise;
}
