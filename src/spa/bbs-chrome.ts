import type { AiPersona } from "./game/types";

const BANNER_LINES = [
	"   ██╗  ██╗██╗      ██████╗ ██╗     ██╗   ██╗███████╗",
	"   ██║  ██║██║      ██╔══██╗██║     ██║   ██║██╔════╝",
	"   ███████║██║█████╗██████╔╝██║     ██║   ██║█████╗  ",
	"   ██╔══██║██║╚════╝██╔══██╗██║     ██║   ██║██╔══╝  ",
	"   ██║  ██║██║      ██████╔╝███████╗╚██████╔╝███████╗   bbs terminal · v0.3 · amber ",
	"   ╚═╝  ╚═╝╚═╝      ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝",
] as const;

export const BANNER: string = (() => {
	const w = Math.max(...BANNER_LINES.map((l) => [...l].length));
	const pad = (s: string): string => s + " ".repeat(w - [...s].length);
	const top = ` ╔${"═".repeat(w + 2)}╗`;
	const bot = ` ╚${"═".repeat(w + 2)}╝`;
	const body = BANNER_LINES.map((l) => ` ║ ${pad(l)} ║`);
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
	const handle = `*${persona.name}`;
	const label = `${handle} :: @${persona.name}`;

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

/** Prefix portion of the topinfo right cell — the "● connection stable"
 * trailer is appended at the call site as a span so it can carry its own
 * green color. Kept here so the daemons-online wording stays in one place. */
export function formatTopInfoRight(i: TopInfoInputs): string {
	const word = i.daemonsOnline === 1 ? "daemon" : "daemons";
	return `[${i.daemonsOnline} ${word} online] · `;
}

export const TOPINFO_RIGHT_OK_TEXT = "● connection stable";

const SESSION_ID_KEY = "hi-blue:session-id";

/** Get-or-mint a stable 4-hex session id. Persisted in localStorage so
 * reloads keep the same SESSION value in the topinfo row. Falls back to a
 * random in-memory value when storage is unavailable. */
export function getOrMintSessionId(): string {
	let store: Storage | null = null;
	try {
		store = typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		store = null;
	}
	if (store) {
		try {
			const existing = store.getItem(SESSION_ID_KEY);
			if (existing) return existing;
			const minted = mintSessionId();
			store.setItem(SESSION_ID_KEY, minted);
			return minted;
		} catch {
			/* fall through */
		}
	}
	return mintSessionId();
}

function mintSessionId(): string {
	const r = Math.floor(Math.random() * 0xffff);
	return `0x${r.toString(16).toUpperCase().padStart(4, "0")}`;
}
