import type { GameSession } from "../game/game-session";
import type { AiId, AiPersona, ConversationEntry } from "../game/types";
import { getMapFocus, setMapFocus } from "./world-map.js";

interface DaemonTurnResult {
	promptTokens?: number;
	completionTokens?: number;
	cachedPromptTokens?: number;
	costUsd?: number;
	lastRawCompletion?: string;
	lastToolCalls?: Array<{ name: string; argumentsJson: string }>;
}

const daemonTurnResults = new Map<AiId, DaemonTurnResult>();

const daemonSystemPrompts = new Map<AiId, string>();

const daemonErrors = new Map<AiId, { text: string; statusCode?: number }>();

const daemonRounds = new Map<AiId, number>();

export function recordDaemonTurnResult(
	aiId: AiId,
	result: DaemonTurnResult,
): void {
	daemonTurnResults.set(aiId, result);
}

export function clearDaemonTurnResults(): void {
	daemonTurnResults.clear();
	daemonSystemPrompts.clear();
	daemonErrors.clear();
	daemonRounds.clear();
}

export function recordDaemonSystemPrompt(
	aiId: AiId,
	systemPrompt: string,
): void {
	daemonSystemPrompts.set(aiId, systemPrompt);
}

export function recordDaemonError(aiId: AiId, error: unknown): void {
	const text = error instanceof Error ? error.message : String(error);
	const statusCode =
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof error.status === "number"
			? error.status
			: undefined;
	daemonErrors.set(aiId, {
		text,
		...(statusCode !== undefined && { statusCode }),
	});
}

export function recordDaemonRound(aiId: AiId, round: number): void {
	daemonRounds.set(aiId, round);
}

type DaemonFooterPipState = "in-flight" | "idle" | "errored";

const PIP_GLYPHS: Readonly<Record<DaemonFooterPipState, string>> = {
	idle: "○",
	"in-flight": "●",
	errored: "✕",
};

const FOOTER_FIELDS: readonly {
	tag: "span" | "button";
	className: string;
	field: string;
	text: string;
	attributes?: Readonly<Record<string, string>>;
}[] = [
	{
		tag: "span",
		className: "dev-footer-pip",
		field: "pip",
		text: PIP_GLYPHS.idle,
		attributes: { "data-state": "idle" },
	},
	{ tag: "span", className: "dev-footer-tools", field: "last-tools", text: "" },
	{ tag: "span", className: "dev-footer-llm", field: "llm-line", text: "" },
	{
		tag: "span",
		className: "dev-footer-chips",
		field: "complication-chips",
		text: "",
	},
	{
		tag: "button",
		className: "dev-footer-focus-vista",
		field: "focus-vista",
		text: "[ focus vista ]",
		attributes: { type: "button", "data-focus-active": "false" },
	},
];

function buildFooterFields(doc: Document): HTMLElement[] {
	return FOOTER_FIELDS.map(({ tag, className, field, text, attributes }) => {
		const el = doc.createElement(tag);
		el.className = className;
		el.setAttribute("data-field", field);
		for (const [name, value] of Object.entries(attributes ?? {})) {
			el.setAttribute(name, value);
		}
		el.textContent = text;
		return el;
	});
}

const PERSONA_FIELDS = [
	"handle",
	"color",
	"temperaments",
	"persona-goal",
	"blurb",
] as const;

function fillPersonaField(
	fieldDiv: HTMLElement,
	field: (typeof PERSONA_FIELDS)[number],
	persona: AiPersona,
): void {
	switch (field) {
		case "handle":
			fieldDiv.textContent = `*${persona.name}`;
			return;
		case "color": {
			const doc = fieldDiv.ownerDocument;
			const swatch = doc.createElement("span");
			swatch.className = "dev-footer-color-swatch";
			swatch.style.backgroundColor = persona.color;
			fieldDiv.appendChild(swatch);
			fieldDiv.appendChild(doc.createTextNode(persona.color));
			return;
		}
		case "temperaments":
			fieldDiv.textContent = `${persona.temperaments[0]} / ${persona.temperaments[1]}`;
			return;
		case "persona-goal":
			fieldDiv.textContent = persona.personaGoal;
			return;
		case "blurb":
			fieldDiv.textContent = persona.blurb;
			return;
	}
}

function formatDaemonError(aiId: AiId): string {
	const error = daemonErrors.get(aiId);
	if (!error) return "";
	return error.statusCode ? `${error.statusCode} ${error.text}` : error.text;
}

const DETAIL_BLOCKS: readonly {
	disclosure: string;
	summary: string;
	content: (aiId: AiId) => string;
}[] = [
	{
		disclosure: "system-prompt",
		summary: "last system prompt",
		content: (aiId) => daemonSystemPrompts.get(aiId) ?? "",
	},
	{
		disclosure: "raw-completion",
		summary: "last raw completion",
		content: (aiId) => daemonTurnResults.get(aiId)?.lastRawCompletion ?? "",
	},
	{
		disclosure: "tool-calls",
		summary: "last tool calls",
		content: (aiId) =>
			(daemonTurnResults.get(aiId)?.lastToolCalls ?? [])
				.map((tc) => `${tc.name}(${tc.argumentsJson})`)
				.join("\n"),
	},
	{ disclosure: "error", summary: "last error", content: formatDaemonError },
];

function createFooterDetails(
	doc: Document,
	disclosure: string,
	summary: string,
): HTMLElement {
	const details = doc.createElement("details");
	details.className = "dev-footer-details";
	details.setAttribute("data-disclosure", disclosure);
	const summaryEl = doc.createElement("summary");
	summaryEl.textContent = summary;
	details.appendChild(summaryEl);
	return details;
}

export function renderDaemonFooter(
	panelEl: HTMLElement,
	aiId: AiId,
	session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const doc = panelEl.ownerDocument;

	footerEl.replaceChildren();
	const summaryDiv = doc.createElement("div");
	summaryDiv.className = "dev-footer-summary";
	summaryDiv.setAttribute("data-line", "summary");

	for (const field of buildFooterFields(doc)) {
		summaryDiv.appendChild(field);
	}

	footerEl.appendChild(summaryDiv);

	for (const block of DETAIL_BLOCKS) {
		const details = createFooterDetails(doc, block.disclosure, block.summary);
		const pre = doc.createElement("pre");
		pre.setAttribute("data-content", block.disclosure);
		pre.textContent = "";
		details.appendChild(pre);
		footerEl.appendChild(details);
	}

	const personaDetails = createFooterDetails(
		doc,
		"persona-card",
		"persona card",
	);
	const personaDiv = doc.createElement("div");
	personaDiv.className = "dev-footer-persona";
	personaDiv.setAttribute("data-content", "persona-card");
	const persona = session.getState().personas[aiId] as AiPersona | undefined;
	for (const field of PERSONA_FIELDS) {
		const fieldDiv = doc.createElement("div");
		fieldDiv.setAttribute("data-persona-field", field);
		if (persona) fillPersonaField(fieldDiv, field, persona);
		personaDiv.appendChild(fieldDiv);
	}
	personaDetails.appendChild(personaDiv);
	footerEl.appendChild(personaDetails);

	footerEl.removeAttribute("hidden");

	const focusBtnEl = panelEl.querySelector<HTMLButtonElement>(
		'[data-field="focus-vista"]',
	);
	if (focusBtnEl) {
		focusBtnEl.addEventListener("click", () => {
			const current = getMapFocus();
			setMapFocus(current === aiId ? null : aiId);
		});
	}
}

export function setDaemonFooterInFlight(
	panelEl: HTMLElement,
	state: DaemonFooterPipState,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const pipSpan = footerEl.querySelector<HTMLElement>('[data-field="pip"]');
	if (!pipSpan) return;

	pipSpan.textContent = PIP_GLYPHS[state];
	pipSpan.dataset.state = state;
}

function computeLastRoundTools(
	conversationLog: ConversationEntry[],
	aiId: AiId,
): string {
	if (conversationLog.length === 0) return "";

	const NO_ROUND_YET = -1;
	let lastActiveRound = NO_ROUND_YET;
	for (const entry of conversationLog) {
		if (entry.kind === "tool-call" && entry.aiId === aiId) {
			lastActiveRound = Math.max(lastActiveRound, entry.round);
		} else if (entry.kind === "message" && entry.from === aiId) {
			lastActiveRound = Math.max(lastActiveRound, entry.round);
		}
	}

	if (lastActiveRound === NO_ROUND_YET) return "";

	const tools: string[] = [];
	let sentMessageInLastActiveRound = false;

	for (const entry of conversationLog) {
		if (entry.round === lastActiveRound) {
			if (entry.kind === "tool-call" && entry.aiId === aiId) {
				tools.push(entry.toolName);
			} else if (entry.kind === "message" && entry.from === aiId) {
				sentMessageInLastActiveRound = true;
			}
		}
	}

	if (sentMessageInLastActiveRound) {
		tools.push("message");
	}

	return tools.join(", ");
}

function computeLlmLine(aiId: AiId): string {
	const result = daemonTurnResults.get(aiId);
	if (!result) return "";

	const N = result.promptTokens ?? "?";
	const M = result.completionTokens ?? "?";

	let cachePercent = 0;
	if (
		result.promptTokens !== undefined &&
		result.promptTokens > 0 &&
		result.cachedPromptTokens !== undefined
	) {
		cachePercent = Math.round(
			(result.cachedPromptTokens / result.promptTokens) * 100,
		);
	}

	const C = result.costUsd !== undefined ? result.costUsd.toFixed(4) : "0.0000";

	return `[tok ${N}→${M} cache ${cachePercent}% $${C}]`;
}

function buildComplicationChips(
	doc: Document,
	aiId: AiId,
	session: GameSession,
): HTMLElement[] {
	const state = session.getState();
	const chips: HTMLElement[] = [];

	for (const comp of state.activeComplications) {
		if (comp.target !== aiId) continue;

		const span = doc.createElement("span");
		span.className = "dev-footer-chip";

		if (comp.kind === "sysadmin_directive") {
			span.textContent = "[sysadm-dir]";
			span.setAttribute("data-chip-kind", "sysadm-dir");
		} else if (comp.kind === "tool_disable") {
			span.textContent = `[tool-dis:${comp.tool}]`;
			span.setAttribute("data-chip-kind", "tool-dis");
		} else if (comp.kind === "chat_lockout") {
			span.textContent = "[chat-lock]";
			span.setAttribute("data-chip-kind", "chat-lock");
		}

		chips.push(span);
	}

	return chips;
}

export function refreshDaemonFooter(
	panelEl: HTMLElement,
	aiId: AiId,
	session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;
	refreshFooterSummary(footerEl, aiId, session);
	refreshFooterDetails(footerEl, aiId);
}

function refreshFooterSummary(
	footerEl: HTMLElement,
	aiId: AiId,
	session: GameSession,
): void {
	const state = session.getState();
	const doc = footerEl.ownerDocument;

	const toolsSpan = footerEl.querySelector<HTMLElement>(
		'[data-field="last-tools"]',
	);
	if (toolsSpan) {
		const conversationLog = state.conversationLogs[aiId] ?? [];
		toolsSpan.textContent = computeLastRoundTools(conversationLog, aiId);
	}

	const llmSpan = footerEl.querySelector<HTMLElement>(
		'[data-field="llm-line"]',
	);
	if (llmSpan) {
		llmSpan.textContent = computeLlmLine(aiId);
	}

	const chipsSpan = footerEl.querySelector<HTMLElement>(
		'[data-field="complication-chips"]',
	);
	if (chipsSpan) {
		const newChips = buildComplicationChips(doc, aiId, session);
		chipsSpan.replaceChildren(...newChips);
	}
}

function refreshFooterDetails(footerEl: HTMLElement, aiId: AiId): void {
	const round = daemonRounds.get(aiId);
	for (const block of DETAIL_BLOCKS) {
		const details = footerEl.querySelector<HTMLElement>(
			`[data-disclosure="${block.disclosure}"]`,
		);
		if (!details) continue;
		const summary = details.querySelector<HTMLElement>("summary");
		if (summary) {
			summary.textContent = `${block.summary}${round ? ` (round ${round})` : ""}`;
		}
		const pre = details.querySelector<HTMLElement>(
			`[data-content="${block.disclosure}"]`,
		);
		if (pre) {
			pre.textContent = block.content(aiId);
		}
	}
}
