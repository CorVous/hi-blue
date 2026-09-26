import type { AiPersona } from "./game/types";

const RELEASE_VERSION: string | null =
	typeof __RELEASE_VERSION__ !== "undefined" ? __RELEASE_VERSION__ : null;
const LATEST_RELEASE_VERSION: string | null =
	typeof __LATEST_RELEASE_VERSION__ !== "undefined"
		? __LATEST_RELEASE_VERSION__
		: null;
const PKG_VERSION: string =
	typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0";
const COMMIT_SHA: string =
	typeof __COMMIT_SHA__ !== "undefined" ? __COMMIT_SHA__ : "unknown";

const VERSION_SUFFIX: string = RELEASE_VERSION
	? `   bbs terminal · v${RELEASE_VERSION} `
	: `   bbs terminal · v${LATEST_RELEASE_VERSION ?? PKG_VERSION} · 0x${COMMIT_SHA} `;

type BannerRow = readonly [
	amberPrefix: string,
	blueLetters: string,
	amberSuffix: string,
];

const BANNER_ROWS: ReadonlyArray<BannerRow> = [
	["   ██╗  ██╗██╗      ", "██████╗ ██╗     ██╗   ██╗███████╗", ""],
	["   ██║  ██║██║      ", "██╔══██╗██║     ██║   ██║██╔════╝", ""],
	["   ███████║██║█████╗", "██████╔╝██║     ██║   ██║█████╗  ", ""],
	["   ██╔══██║██║╚════╝", "██╔══██╗██║     ██║   ██║██╔══╝  ", ""],
	["   ██║  ██║██║      ", "██████╔╝███████╗╚██████╔╝███████╗", VERSION_SUFFIX],
	["   ╚═╝  ╚═╝╚═╝      ", "╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝", ""],
] as const;

export const BANNER: string = (() => {
	const len = (s: string): number => [...s].length;
	const lineLen = (row: BannerRow): number =>
		len(row[0]) + len(row[1]) + len(row[2]);
	const w = Math.max(...BANNER_ROWS.map(lineLen));
	const top = ` ╔${"═".repeat(w + 2)}╗`;
	const bot = ` ╚${"═".repeat(w + 2)}╝`;
	const side = `<span class="banner-side">║</span>`;
	const body = BANNER_ROWS.map((row) => {
		const [amberPrefix, blueLetters, amberSuffix] = row;
		const pad = " ".repeat(w - lineLen(row));
		return ` ${side} ${amberPrefix}<span class="banner-blue">${blueLetters}</span>${amberSuffix}${pad} ${side}`;
	});
	return [top, ...body, bot].join("\n");
})();

const FILL_THIN = "─".repeat(400);
const FILL_HEAVY = "═".repeat(400);
const SIDE_THIN = `${"│\n".repeat(200)}`;
const SIDE_HEAVY = `${"║\n".repeat(200)}`;

export function initPanelChrome(panel: HTMLElement, persona: AiPersona): void {
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

	const transcript = panel.querySelector<HTMLElement>(".transcript");
	if (transcript) transcript.dataset.transcript = persona.id;
}

export interface TopInfoInputs {
	sessionId: string;
	epoch: number;
	turn: number;
}

function formatTopInfoLeft(i: TopInfoInputs): string {
	const epoch = `${String(i.epoch).padStart(2, "0")}`;
	const turn = String(i.turn).padStart(1, "0");
	return `SESSION ${i.sessionId} · EPOCH ${epoch} · TURN ${turn}`;
}

export function renderTopInfoLeft(el: HTMLElement, i: TopInfoInputs): void {
	el.textContent = formatTopInfoLeft(i);
}

export function formatTopInfoMobile(i: TopInfoInputs): string {
	const epoch = `${String(i.epoch).padStart(2, "0")}`;
	return `${i.sessionId} · EPC ${epoch} · TRN ${i.turn}`;
}

const TOPINFO_RIGHT_OK_TEXT = "● connection stable";
const TOPINFO_RIGHT_LOADING_TEXT = "● loading daemons";
const TOPINFO_RIGHT_GENERATING_TEXT = "● generating room";
const TOPINFO_RIGHT_UNSTABLE_TEXT = "● connection unstable";

const TOPINFO_MOBILE_OK_TEXT = "● stable";
const TOPINFO_MOBILE_LOADING_TEXT = "● loading";
const TOPINFO_MOBILE_GENERATING_TEXT = "● generating";
const TOPINFO_MOBILE_UNSTABLE_TEXT = "● unstable";

export type LoadState =
	| "loading-daemons"
	| "generating-room"
	| "stable"
	| "unstable";

export interface LoadStateStatus {
	desktop: string;
	mobile: string;
	cls: "err" | "warn" | "ok";
}

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
		case "unstable":
			return {
				desktop: TOPINFO_RIGHT_UNSTABLE_TEXT,
				mobile: TOPINFO_MOBILE_UNSTABLE_TEXT,
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

export function paintBanner(doc: Document): void {
	const el = doc.querySelector<HTMLElement>("#banner");
	if (el && !el.innerHTML) el.innerHTML = BANNER;
}

export function paintTopInfo(doc: Document, inputs: TopInfoInputs): void {
	const left = doc.querySelector<HTMLElement>("#topinfo-left");
	const right = doc.querySelector<HTMLElement>("#topinfo-right");
	const mobile = doc.querySelector<HTMLElement>("#topinfo-mobile");
	if (left) left.textContent = formatTopInfoLeft(inputs);
	if (right) {
		right.textContent = "";
		const okSpan = doc.createElement("span");
		okSpan.className = "ok";
		okSpan.textContent = TOPINFO_RIGHT_OK_TEXT;
		right.appendChild(okSpan);
	}
	if (mobile) mobile.textContent = formatTopInfoMobile(inputs);
}
