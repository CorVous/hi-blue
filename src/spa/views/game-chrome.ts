import {
	BANNER,
	formatTopInfoMobile,
	initPanelChrome,
	type LoadState,
	type LoadStateStatus,
	renderTopInfoLeft,
	type TopInfoInputs,
} from "../bbs-chrome.js";
import type { AiId, AiPersona } from "../game/types";
import type { SaveResult } from "../persistence/session-storage.js";
import { setHidden } from "./dom.js";

export const UNKNOWN_SESSION_ID = "0x????";

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

type SaveFailureReason = Extract<SaveResult, { ok: false }>["reason"];

const PERSISTENCE_WARNING_MESSAGES: Record<SaveFailureReason, string> = {
	unavailable:
		"Game progress cannot be saved: storage is disabled in your browser. Your session will be lost on refresh.",
	quota: "Game progress could not be saved: browser storage is full.",
	unknown: "Game progress could not be saved due to an unexpected error.",
};

export function hidePersistenceWarning(warningEl: HTMLElement | null): void {
	warningEl?.setAttribute("hidden", "");
}

export function showPersistenceWarning(
	warningEl: HTMLElement | null,
	reason: SaveFailureReason,
): void {
	if (!warningEl) return;
	warningEl.textContent = PERSISTENCE_WARNING_MESSAGES[reason];
	warningEl.removeAttribute("hidden");
}

export function revealGameRouteChrome(doc: Document): void {
	setHidden(doc, ["#start-screen", "#sessions-screen", "#endgame"], true);
	setHidden(
		doc,
		["#panels", "#composer", "#stage > header", "#topinfo", "#banner"],
		false,
	);
}

export function paintBannerOnce(doc: Document): void {
	const bannerEl = doc.querySelector<HTMLElement>("#banner");
	if (bannerEl && !bannerEl.innerHTML) bannerEl.innerHTML = BANNER;
}

export function setGameSurfaceHidden(doc: Document, hidden: boolean): void {
	setHidden(doc, ["#panels", "#composer"], hidden);
}

export function paintPersonaPanels(
	doc: Document,
	personas: Record<AiId, AiPersona>,
	paintPanelExtras: (panel: HTMLElement, aiId: AiId) => void,
): void {
	const aiIds = Object.keys(personas);
	doc.querySelectorAll<HTMLElement>(".ai-panel").forEach((panel, idx) => {
		const aiId = aiIds[idx];
		if (!aiId) return;
		const persona = personas[aiId];
		if (!persona) return;
		panel.dataset.ai = aiId;
		panel.style.setProperty("--panel-color", persona.color);
		initPanelChrome(panel, persona);
		paintPanelExtras(panel, aiId);
	});
}

export function paintTopInfo(
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

export function setStageLoadState(doc: Document, state: LoadState): void {
	const stageEl = doc.querySelector<HTMLElement>("#stage");
	if (!stageEl) return;
	if (state === "stable") {
		stageEl.removeAttribute("data-load-state");
		stageEl.style.removeProperty("--fill-pct");
	} else {
		stageEl.setAttribute("data-load-state", state);
	}
}

function brailleFrameText(frame: number): string {
	return ` ${BRAILLE_SPINNER_FRAMES[frame] ?? ""}`;
}

export function appendPanelSpinners(panel: HTMLElement): HTMLElement[] {
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

export function animateSpinners(
	spinnerEls: () => Iterable<HTMLElement>,
): ReturnType<typeof setInterval> {
	let frame = 0;
	return setInterval(() => {
		frame = (frame + 1) % BRAILLE_SPINNER_FRAMES.length;
		const text = brailleFrameText(frame);
		for (const spinnerEl of spinnerEls()) spinnerEl.textContent = text;
	}, SPINNER_INTERVAL_MS);
}
