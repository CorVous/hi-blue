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

/** Banner as HTML — the BLUE block letters are wrapped in `.banner-blue`. */
export const BANNER: string = (() => {
	const len = (s: string): number => [...s].length;
	const lineLen = (seg: readonly [string, string, string]): number =>
		len(seg[0]) + len(seg[1]) + len(seg[2]);
	const w = Math.max(...BANNER_SEGMENTS.map(lineLen));
	const top = ` ╔${"═".repeat(w + 2)}╗`;
	const bot = ` ╚${"═".repeat(w + 2)}╝`;
	const body = BANNER_SEGMENTS.map(([a, b, c]) => {
		const pad = " ".repeat(w - lineLen([a, b, c]));
		return ` ║ ${a}<span class="banner-blue">${b}</span>${c}${pad} ║`;
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
 * Render the left topinfo cell as DOM children:
 *   <a class="session-link" href="#/sessions">SESSION 0xXXXX</a> · PHASE NN/NN · TURN N
 *
 * Clears `el` before populating.
 */
export function renderTopInfoLeft(el: HTMLElement, i: TopInfoInputs): void {
	// Clear existing children
	while (el.firstChild) el.removeChild(el.firstChild);
	const doc = el.ownerDocument;
	const phase = `${String(i.phaseNumber).padStart(2, "0")}/${String(i.totalPhases).padStart(2, "0")}`;
	const turn = String(i.turn).padStart(1, "0");

	const link = doc.createElement("a");
	link.className = "session-link";
	link.href = "#/sessions";
	link.textContent = `SESSION ${i.sessionId}`;
	el.appendChild(link);
	el.appendChild(doc.createTextNode(` · PHASE ${phase} · TURN ${turn}`));
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

// Session ID minting has moved to src/spa/persistence/session-storage.ts (mintSessionId).
// getOrMintSessionId has been retired: the active session pointer is now managed by
// session-storage.ts and surfaced in game.ts via getActiveSessionId().
