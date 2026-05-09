import type { AiPersona } from "./game/types";

// Each line is split into amber prefix (HI-), blue middle (BLUE block
// letters), and optional amber suffix (the meta line on row 5). The blue
// segment is 33 chars wide on every row, so column alignment is preserved.
const BANNER_SEGMENTS: ReadonlyArray<readonly [string, string, string]> = [
	["   ██╗  ██╗██╗      ", "██████╗ ██╗     ██╗   ██╗███████╗", ""],
	["   ██║  ██║██║      ", "██╔══██╗██║     ██║   ██║██╔════╝", ""],
	["   ███████║██║█████╗", "██████╔╝██║     ██║   ██║█████╗  ", ""],
	["   ██╔══██║██║╚════╝", "██╔══██╗██║     ██║   ██║██╔══╝  ", ""],
	[
		"   ██║  ██║██║      ",
		"██████╔╝███████╗╚██████╔╝███████╗",
		"   bbs terminal · v0.3 · amber ",
	],
	["   ╚═╝  ╚═╝╚═╝      ", "╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝", ""],
] as const;

/** Banner as HTML — the BLUE block letters are wrapped in `.banner-blue`.
 *  Each body-row `║` is wrapped in `.banner-side` so CSS can hide the
 *  beaded glyph and paint a continuous double-line via a per-cell
 *  `::before` that extends slightly past the line-box (overlapping the
 *  next row's overlay so the strip is seamless). */
export const BANNER: string = (() => {
	const len = (s: string): number => [...s].length;
	const lineLen = (seg: readonly [string, string, string]): number =>
		len(seg[0]) + len(seg[1]) + len(seg[2]);
	const w = Math.max(...BANNER_SEGMENTS.map(lineLen));
	const top = ` ╔${"═".repeat(w + 2)}╗`;
	const bot = ` ╚${"═".repeat(w + 2)}╝`;
	const side = `<span class="banner-side">║</span>`;
	const body = BANNER_SEGMENTS.map(([a, b, c]) => {
		const pad = " ".repeat(w - lineLen([a, b, c]));
		return ` ${side} ${a}<span class="banner-blue">${b}</span>${c}${pad} ${side}`;
	});
	return [top, ...body, bot].join("\n");
})();

const FILL_THIN = "─".repeat(400);
const FILL_HEAVY = "═".repeat(400);
const SIDE_THIN = `${"│\n".repeat(200)}`;
const SIDE_HEAVY = `${"║\n".repeat(200)}`;

/** Populate the static border glyph text on a panel — call once per panel
 * after `data-ai` and `--panel-color` are set. The thin/heavy swap on
 * selection is purely CSS-driven via `.panel--addressed`. */
export function initPanelChrome(panel: HTMLElement, persona: AiPersona): void {
	const doc = panel.ownerDocument;
	const label = `*${persona.name}`;

	for (const el of panel.querySelectorAll<HTMLElement>(".panel-name")) {
		el.textContent = label;
	}
	for (const el of panel.querySelectorAll<HTMLElement>(".brow-fill-thin")) {
		el.textContent = FILL_THIN;
	}
	for (const el of panel.querySelectorAll<HTMLElement>(".brow-fill-heavy")) {
		el.textContent = FILL_HEAVY;
	}
	for (const el of panel.querySelectorAll<HTMLElement>(".side-thin")) {
		el.textContent = SIDE_THIN;
	}
	for (const el of panel.querySelectorAll<HTMLElement>(".side-heavy")) {
		el.textContent = SIDE_HEAVY;
	}

	// Ensure the transcript element's data-transcript attribute matches the
	// runtime aiId (the HTML scaffold leaves it empty so AiIds remain dynamic).
	const transcript = panel.querySelector<HTMLElement>(".transcript");
	if (transcript) transcript.dataset.transcript = persona.id;

	// jsdom's CSS engine doesn't honour ::before/::after content; mirror them
	// as inline data so tests can verify the heavy-border state if desired.
	for (const corner of panel.querySelectorAll<HTMLElement>(".corner")) {
		void corner; // pseudo elements own the visual; nothing to populate.
	}

	// Avoid lint complaint about unused `doc`.
	void doc;
}

export interface TopInfoInputs {
	sessionId: string;
	phaseNumber: number;
	totalPhases: number;
	turn: number;
	daemonsOnline: number;
}

export function formatTopInfoLeft(i: TopInfoInputs): string {
	const phase = `${String(i.phaseNumber).padStart(2, "0")}/${String(i.totalPhases).padStart(2, "0")}`;
	const turn = String(i.turn).padStart(1, "0");
	return `SESSION ${i.sessionId} · PHASE ${phase} · TURN ${turn}`;
}

/**
 * Render the left topinfo cell. Sessions picker is reached via the
 * [ ls ] button in the header chrome rather than the topinfo text.
 */
export function renderTopInfoLeft(el: HTMLElement, i: TopInfoInputs): void {
	el.textContent = formatTopInfoLeft(i);
}

/** Compact form rendered into `#topinfo-mobile` for the <=720px bento
 * layout — drops the labels and the daemons-online/connection trailer. */
export function formatTopInfoMobile(i: TopInfoInputs): string {
	const phase = `${String(i.phaseNumber).padStart(2, "0")}/${String(i.totalPhases).padStart(2, "0")}`;
	return `${i.sessionId} · ${phase} · TRN ${i.turn}`;
}

/** Prefix portion of the topinfo right cell — the "● connection stable"
 * trailer is appended at the call site as a span so it can carry its own
 * green color. Kept here so the daemons-online wording stays in one place. */
export function formatTopInfoRight(i: TopInfoInputs): string {
	const word = i.daemonsOnline === 1 ? "daemon" : "daemons";
	return `[${i.daemonsOnline} ${word} online] · `;
}

export const TOPINFO_RIGHT_OK_TEXT = "● connection stable";
export const TOPINFO_RIGHT_LOADING_TEXT = "● loading daemons";
export const TOPINFO_RIGHT_GENERATING_TEXT = "● generating room";

export const TOPINFO_MOBILE_OK_TEXT = "● stable";
export const TOPINFO_MOBILE_LOADING_TEXT = "● loading";
export const TOPINFO_MOBILE_GENERATING_TEXT = "● generating";

/** Three-phase load state used by the start → game progressive loading flow. */
export type LoadState = "loading-daemons" | "generating-room" | "stable";

export interface LoadStateStatus {
	desktop: string;
	mobile: string;
	cls: "err" | "warn" | "ok";
}

/** Map a `LoadState` to the right-cell text + the CSS class that colors it. */
export function topInfoStatus(state: LoadState): LoadStateStatus {
	switch (state) {
		case "loading-daemons":
			return {
				desktop: TOPINFO_RIGHT_LOADING_TEXT,
				mobile: TOPINFO_MOBILE_LOADING_TEXT,
				cls: "err",
			};
		case "generating-room":
			return {
				desktop: TOPINFO_RIGHT_GENERATING_TEXT,
				mobile: TOPINFO_MOBILE_GENERATING_TEXT,
				cls: "warn",
			};
		case "stable":
			return {
				desktop: TOPINFO_RIGHT_OK_TEXT,
				mobile: TOPINFO_MOBILE_OK_TEXT,
				cls: "ok",
			};
	}
}

/** Idempotent: inject the ASCII banner into `#banner` if not already there. */
export function paintBanner(doc: Document): void {
	const el = doc.querySelector<HTMLElement>("#banner");
	if (el && !el.innerHTML) el.innerHTML = BANNER;
}

/** Populate the three topinfo cells (left / right / mobile) from inputs. */
export function paintTopInfo(doc: Document, inputs: TopInfoInputs): void {
	const left = doc.querySelector<HTMLElement>("#topinfo-left");
	const right = doc.querySelector<HTMLElement>("#topinfo-right");
	const mobile = doc.querySelector<HTMLElement>("#topinfo-mobile");
	if (left) left.textContent = formatTopInfoLeft(inputs);
	if (right) {
		right.textContent = formatTopInfoRight(inputs);
		const okSpan = doc.createElement("span");
		okSpan.className = "ok";
		okSpan.textContent = TOPINFO_RIGHT_OK_TEXT;
		right.appendChild(okSpan);
	}
	if (mobile) mobile.textContent = formatTopInfoMobile(inputs);
}

// Session ID minting has moved to src/spa/persistence/session-storage.ts (mintSessionId).
// getOrMintSessionId has been retired: the active session pointer is now managed by
// session-storage.ts and surfaced in game.ts via getActiveSessionId().
