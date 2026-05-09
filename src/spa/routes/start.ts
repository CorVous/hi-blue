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
 *   - Kick off generateNewGameAssets() on mount; CONNECT starts disabled.
 *   - On generation success → enable CONNECT and hold assets in module scope.
 *   - On failure (CapHitError or any error) → show #cap-hit, hide #start-screen.
 *   - CONNECT click → password === "password" gate. On match: buildSessionFromAssets,
 *     applyTestAffordances, saveActiveSession, then location.hash = "#/game".
 *     On mismatch: show inline error, keep CONNECT enabled. Idempotent against
 *     double-click while a successful connect is mid-flight.
 *
 * Issue #173 (parent #155).
 */

import {
	buildSessionFromAssets,
	type ContentPackProvider,
	generateNewGameAssets,
	type NewGameAssets,
	type SynthesisProvider,
} from "../game/bootstrap.js";
import { saveActiveSession } from "../persistence/session-storage.js";
import { applyTestAffordances } from "./game.js";

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

/** Module-level pending assets holder. Cleared on each render call. */
let _pendingAssets: NewGameAssets | undefined;
let _beginClickPending = false;
/** The resize listener installed on the most recent render — removed on next call. */
let _activeResizeHandler: (() => void) | undefined;

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

	// Reset module-level state on each render call
	_pendingAssets = undefined;
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
		if (!_pendingAssets) return;
		_beginClickPending = true;
		beginBtn.disabled = true;
		if (pwEl) pwEl.disabled = true;
		clearError();

		const assets = _pendingAssets;
		let session = buildSessionFromAssets(assets);
		session = applyTestAffordances(session, effectiveParams);

		const saveResult = saveActiveSession(session.getState());
		if (!saveResult.ok) {
			const persistenceWarningEl = doc.querySelector<HTMLElement>(
				"#persistence-warning",
			);
			if (persistenceWarningEl) {
				persistenceWarningEl.textContent =
					"Game progress cannot be saved: storage is full or disabled.";
				persistenceWarningEl.removeAttribute("hidden");
			}
		}

		// Navigate to game regardless of save result (game.ts will handle missing session)
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

	// Kick off generation
	const generationPromise = (async () => {
		try {
			const assets = await generateNewGameAssets(_testOverrides);
			_pendingAssets = assets;
			beginBtn.disabled = false;
		} catch (err) {
			// Funnel failure to #cap-hit (same UX as game-route CapHitError)
			const capHitEl = doc.querySelector<HTMLElement>("#cap-hit");
			if (capHitEl) capHitEl.removeAttribute("hidden");
			if (startScreenEl) startScreenEl.setAttribute("hidden", "");
			// Re-throw so callers can observe the failure
			throw err;
		} finally {
			// Clear test overrides after each render cycle
			_testOverrides = undefined;
		}
	})();

	return generationPromise;
}
