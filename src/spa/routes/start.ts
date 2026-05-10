/**
 * start.ts
 *
 * Route renderer for #/start.
 *
 * Responsibilities:
 *   - Show #start-screen (CRT dial-up login), hide #panels and #composer.
 *   - Hide global header/topinfo/banner so the login screen takes over.
 *   - Show a persistence-warning banner when ?reason=broken|version-mismatch|
 *     legacy-save-discarded is present.
 *   - Type out the dial-up handshake into #dial, then reveal the login form.
 *     Skip the animation under prefers-reduced-motion or ?skipDialup=1.
 *   - Kick off persona + content-pack generation on mount via the shared
 *     pending-bootstrap module. CONNECT becomes available as soon as the
 *     login form is revealed — generation continues in the background and
 *     the game route observes it for progressive loading.
 *   - On generation failure (CapHitError or any error) → show #cap-hit and
 *     hide #start-screen.
 *   - CONNECT click → password === "password" gate. On match, navigate to
 *     #/game; the game route handles the loading UI and only persists the
 *     session once content packs resolve. On mismatch: show inline error.
 */

import type {
	ContentPackProvider,
	SynthesisProvider,
} from "../game/bootstrap.js";
import {
	getPendingBootstrap,
	startBootstrap,
} from "../game/pending-bootstrap.js";
import { getSpikeRng, setSpikeSeed } from "../game/spike-seed.js";

/** Warning reason strings shown in the persistence warning banner. */
export const PERSISTENCE_WARNING_MESSAGES: Record<string, string> = {
	broken:
		"Saved game data was unreadable and has been discarded. Starting a new game.",
	"version-mismatch":
		"Saved game data is from an older version and has been discarded. Starting a new game.",
	"legacy-save-discarded":
		"Saved game data from an older format has been discarded. Starting a new game.",
};

/** The password that gates entry. */
const ACCEPTED_PASSWORD = "password";

/** Dial-up handshake transcript — typed line-by-line into #dial. */
const DIAL_LINES: ReadonlyArray<{ t: string; s: string }> = [
	{
		t: "> initializing modem ........................... ",
		s: '<span class="ok">ok</span>',
	},
	{ t: "> ATZ\n  OK\n", s: "" },
	{
		t: "> ATDT 1-5555-HI-BLUE .......................... ",
		s: '<span class="hot">dialing</span>',
	},
	{ t: "  ringing... ringing... ringing...\n", s: "" },
	{ t: "  CONNECT 56000/ARQ/V90/LAPM/V42BIS\n", s: "" },
	{
		t: "> negotiating telnet IAC ....................... ",
		s: '<span class="ok">ok</span>',
	},
	{
		t: "> requesting ANSI/BBS terminal ................. ",
		s: '<span class="ok">ok</span>',
	},
	{
		t: "> hi-blue.bbs · node 01/01 ..................... ",
		s: '<span class="ok">connected</span>\n\n',
	},
];

/** Render the full handshake transcript synchronously (used when animation is skipped). */
function renderDialFinalText(): string {
	let out = "";
	for (const ln of DIAL_LINES) {
		out += ln.t;
		if (ln.s) out += ln.s;
		if (!ln.t.endsWith("\n") && !ln.s.includes("\n")) out += "\n";
	}
	return out;
}

/** Detect when motion should be suppressed. */
function shouldSkipAnimation(params: URLSearchParams): boolean {
	if (params.get("skipDialup") === "1") return true;
	if (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function"
	) {
		try {
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				return true;
			}
		} catch {
			// matchMedia may throw in some test envs — treat as no preference
		}
	}
	return false;
}

/** Type the dial-up handshake into `dialEl`, calling `onDone` when finished. */
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
		const full = line.t;
		let charIdx = 0;
		let prefix = buffer;
		const tick = () => {
			if (charIdx < full.length) {
				prefix += full.charAt(charIdx);
				charIdx++;
				dialEl.innerHTML = `${prefix}<span class="blinkonly">▍</span>`;
				setTimeout(tick, full.startsWith("  ") ? 8 : 18);
			} else {
				buffer = prefix + (line.s || "");
				if (!full.endsWith("\n") && !(line.s || "").includes("\n")) {
					buffer += "\n";
				}
				dialEl.innerHTML = `${buffer}<span class="blinkonly">▍</span>`;
				const pause = full.includes("ringing") ? 360 : 140;
				setTimeout(next, pause);
			}
		};
		tick();
	};
	setTimeout(next, 280);
}

/** Mountain variants for the ASCII landscape — each row is 18 chars wide. */
const LANDSCAPE_VARIANTS: ReadonlyArray<readonly [string, string, string]> = [
	["       ╱╲         ", "      ╱  ╲   ╱╲   ", "─────╱    ╲─╱  ╲──"],
	["                  ", "   ╱╲      ╱╲     ", "──╱  ╲────╱  ╲────"],
	["        ╱╲        ", "   ╱╲  ╱  ╲       ", "──╱  ╲╱    ╲──────"],
	["     ╱╲           ", "    ╱  ╲  ╱╲   ╱╲ ", "───╱    ╲╱  ╲─╱  ╲"],
	["                  ", "    ╱╲    ╱╲  ╱╲  ", "───╱  ╲──╱  ╲╱  ╲─"],
	["        ╱╲        ", "       ╱  ╲       ", "──────╱    ╲──────"],
];
const LANDSCAPE_ORDER = [0, 3, 1, 5, 2, 4, 0, 2, 5, 1, 3, 4];

/** Paint the ASCII landscape into #login-keyart, sized to the current viewport. */
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
	probe.textContent = "─".repeat(200);
	doc.body.appendChild(probe);
	const charW = probe.getBoundingClientRect().width / 200 || 8;
	doc.body.removeChild(probe);
	const cols = Math.max(40, Math.floor(keyart.clientWidth / charW) - 1);

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

/** Wire password masking: store real value in dataset.real, render asterisks. */
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
		try {
			if (caret !== null) pwEl.setSelectionRange(caret, caret);
		} catch {
			// some inputs/jsdom configurations don't support setSelectionRange
		}
	});
}

/**
 * Injection points for testing (not used in production).
 * Callers can provide alternative providers via the params sentinel trick:
 * we expose a module-level override hook used by tests.
 */
export interface StartTestOverrides {
	synthesis?: SynthesisProvider;
	packProvider?: ContentPackProvider;
	rng?: () => number;
}

/** Module-level test overrides — set by tests, cleared after each render. */
let _testOverrides: StartTestOverrides | undefined;

export function _setTestOverrides(
	overrides: StartTestOverrides | undefined,
): void {
	_testOverrides = overrides;
}

/** Set once a successful CONNECT submit is mid-flight, to debounce double-clicks. */
let _beginClickPending = false;
/** The resize listener installed on the most recent render — removed on next call. */
let _activeResizeHandler: (() => void) | undefined;
/** The uptime ticker installed on the most recent render — cleared on next call. */
let _activeUptimeInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Format the elapsed time since the build's commit as `Dd HHh MMm`. Mirrors
 * the look of the placeholder text the design system uses for the BBS uptime
 * line (e.g. `11d 04h 22m`). Negative or zero spans render as `0d 00h 00m`.
 */
export function formatUptime(elapsedMs: number): string {
	const safe = Math.max(0, Math.floor(elapsedMs / 1000));
	const days = Math.floor(safe / 86400);
	const hours = Math.floor((safe % 86400) / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
}

export function renderStart(
	root: HTMLElement,
	params?: URLSearchParams,
): Promise<void> {
	const doc = root.ownerDocument;

	// Hide panels, composer, and sessions screen; show start screen
	const startScreenEl = doc.querySelector<HTMLElement>("#start-screen");
	const panelsEl = doc.querySelector<HTMLElement>("#panels");
	const composerEl = doc.querySelector<HTMLElement>("#composer");
	const sessionsScreenEl = doc.querySelector<HTMLElement>("#sessions-screen");

	if (panelsEl) panelsEl.hidden = true;
	if (composerEl) composerEl.hidden = true;
	if (sessionsScreenEl) sessionsScreenEl.hidden = true;
	if (startScreenEl) startScreenEl.hidden = false;

	// Hide global chrome — the login screen owns the whole viewport.
	const headerEl = doc.querySelector<HTMLElement>("#stage > header");
	const topinfoEl = doc.querySelector<HTMLElement>("#topinfo");
	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (headerEl) headerEl.hidden = true;
	if (topinfoEl) topinfoEl.hidden = true;
	if (bannerEl) bannerEl.hidden = true;

	// Show persistence warning if reason param is present
	const reason = params?.get("reason") ?? null;
	if (reason) {
		const persistenceWarningEl = doc.querySelector<HTMLElement>(
			"#persistence-warning",
		);
		if (persistenceWarningEl) {
			const msg =
				PERSISTENCE_WARNING_MESSAGES[reason] ??
				`Saved game data could not be loaded (${reason}). Starting a new game.`;
			persistenceWarningEl.textContent = msg;
			persistenceWarningEl.removeAttribute("hidden");
		}
	}

	const beginBtn = doc.querySelector<HTMLButtonElement>("#begin");
	if (!beginBtn) return Promise.resolve();

	const dialEl = doc.querySelector<HTMLElement>("#dial");
	const revealEl = doc.querySelector<HTMLElement>("#login-reveal");
	const pwEl = doc.querySelector<HTMLInputElement>("#password");
	const errorEl = doc.querySelector<HTMLElement>("#login-error");
	const formEl = doc.querySelector<HTMLFormElement>("#login-form");
	const keyartEl = doc.querySelector<HTMLElement>("#login-keyart");

	// Reset module-level state on each render call. CONNECT is disabled only
	// while the dial-up animation is still typing out — it's re-enabled in
	// revealLogin() once the login form appears.
	_beginClickPending = false;
	beginBtn.disabled = true;

	if (pwEl) {
		pwEl.value = "";
		pwEl.dataset.real = "";
		pwEl.disabled = false;
	}
	if (errorEl) {
		errorEl.textContent = "";
		errorEl.setAttribute("hidden", "");
	}
	if (dialEl) dialEl.innerHTML = "";
	const postlogEl = doc.querySelector<HTMLElement>("#login-postlog");
	if (postlogEl) postlogEl.innerHTML = "";

	// Drop the previous render's resize listener if it's still attached.
	if (_activeResizeHandler && typeof window !== "undefined") {
		window.removeEventListener("resize", _activeResizeHandler);
		_activeResizeHandler = undefined;
	}

	// Drop the previous render's uptime ticker if it's still running.
	if (_activeUptimeInterval !== undefined) {
		clearInterval(_activeUptimeInterval);
		_activeUptimeInterval = undefined;
	}

	// Merge hash-query-string params with location.search so ?winImmediately=1 etc. work
	const effectiveParams = new URLSearchParams(
		typeof location !== "undefined" ? location.search : "",
	);
	if (params) {
		for (const [k, v] of params) effectiveParams.set(k, v);
	}

	const skipAnimation = shouldSkipAnimation(effectiveParams);

	const revealLogin = () => {
		if (!revealEl) return;
		revealEl.hidden = false;
		// CONNECT is gated only on the dial-up animation completing — not on
		// asset readiness. Generation continues in the background while the
		// player types, and the game route renders progressive loading.
		beginBtn.disabled = false;
		const uptimeEl = doc.querySelector<HTMLElement>("#login-uptime");
		if (uptimeEl && __COMMIT_TIMESTAMP_MS__ > 0) {
			const tick = () => {
				uptimeEl.textContent = formatUptime(
					Date.now() - __COMMIT_TIMESTAMP_MS__,
				);
			};
			tick();
			_activeUptimeInterval = setInterval(tick, 60_000);
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
			try {
				pwEl.focus();
			} catch {
				// focus may fail in jsdom — non-fatal
			}
		}
	};

	if (skipAnimation) {
		if (dialEl) dialEl.textContent = renderDialFinalText();
		revealLogin();
	} else if (dialEl) {
		typeDialUp(dialEl, () => setTimeout(revealLogin, 220));
	} else {
		revealLogin();
	}

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

	const proceedConnect = () => {
		if (_beginClickPending) return;
		_beginClickPending = true;
		beginBtn.disabled = true;
		if (pwEl) pwEl.disabled = true;
		clearError();

		// The game route reads the in-flight bootstrap from pending-bootstrap.ts
		// and progressively renders the loading UI as personas, then content
		// packs, resolve. The session is built and persisted there, not here.
		location.hash = "#/game";
	};

	const handleSubmit = (e?: Event) => {
		if (e) e.preventDefault();
		if (beginBtn.disabled) return;
		if (_beginClickPending) return;
		const real = pwEl?.dataset.real ?? "";
		if (real !== ACCEPTED_PASSWORD) {
			showError("> access denied — invalid credentials");
			if (pwEl) {
				pwEl.value = "";
				pwEl.dataset.real = "";
				try {
					pwEl.focus();
				} catch {
					// ignore
				}
			}
			return;
		}
		proceedConnect();
	};

	if (formEl) formEl.addEventListener("submit", handleSubmit);
	beginBtn.addEventListener("click", handleSubmit);

	// Spike #239: `?seed=N` pins persona archetype, setting noun, and
	// spatial layout via Mulberry32 sub-streams. Production paths leave
	// _spikeSeed null and fall back to Math.random.
	const seedRaw = params?.get("seed");
	const seedNum =
		seedRaw !== null && seedRaw !== undefined ? Number(seedRaw) : Number.NaN;
	if (Number.isFinite(seedNum)) {
		setSpikeSeed(seedNum | 0);
	}

	// Kick off (or reuse) the in-flight bootstrap. If the user backed out to
	// the start screen after a previous render, startBootstrap returns the
	// existing entry rather than starting a fresh generation.
	const existing = getPendingBootstrap();
	const personasRng = getSpikeRng("personas");
	const contentPackRng = getSpikeRng("contentPack");
	const spikeOpts =
		personasRng && contentPackRng ? { personasRng, contentPackRng } : undefined;
	const mergedOpts =
		_testOverrides || spikeOpts
			? { ..._testOverrides, ...spikeOpts }
			: undefined;
	const bootstrap = existing ?? startBootstrap(mergedOpts);
	_testOverrides = undefined;

	// If generation fails while the player is still on this screen, surface
	// the same CapHitError UX we used to show when CONNECT was gated. Once
	// they've navigated to #/game, the start screen is hidden — the game
	// route's loading flow handles the failure there instead.
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
