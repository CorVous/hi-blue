import type { GameSession } from "../game/game-session";
import type { AiId, AiPersona, ConversationEntry } from "../game/types";
import { getMapFocus, setMapFocus } from "./world-map.js";

const daemonTurnResults: Record<
	string,
	{
		promptTokens?: number;
		completionTokens?: number;
		cachedPromptTokens?: number;
		costUsd?: number;
		lastRawCompletion?: string;
		lastToolCalls?: Array<{ name: string; argumentsJson: string }>;
	}
> = {};

const daemonSystemPrompts: Record<string, string> = {};

const daemonErrors: Record<string, { text: string; statusCode?: number }> = {};

const daemonRounds: Record<string, number> = {};

export function recordDaemonTurnResult(
	aiId: AiId,
	result: {
		promptTokens?: number;
		completionTokens?: number;
		cachedPromptTokens?: number;
		costUsd?: number;
		lastRawCompletion?: string;
		lastToolCalls?: Array<{ name: string; argumentsJson: string }>;
	},
): void {
	daemonTurnResults[aiId] = result;
}

export function clearDaemonTurnResults(): void {
	for (const key of Object.keys(daemonTurnResults)) {
		delete daemonTurnResults[key];
	}
	for (const key of Object.keys(daemonSystemPrompts)) {
		delete daemonSystemPrompts[key];
	}
	for (const key of Object.keys(daemonErrors)) {
		delete daemonErrors[key];
	}
	for (const key of Object.keys(daemonRounds)) {
		delete daemonRounds[key];
	}
}

export function recordDaemonSystemPrompt(
	aiId: AiId,
	systemPrompt: string,
): void {
	daemonSystemPrompts[aiId] = systemPrompt;
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
	daemonErrors[aiId] = {
		text,
		...(statusCode !== undefined && { statusCode }),
	};
}

export function recordDaemonRound(aiId: AiId, round: number): void {
	daemonRounds[aiId] = round;
}

function buildFooterFields(): HTMLElement[] {
	const spans: HTMLElement[] = [];

	const pipSpan = document.createElement("span");
	pipSpan.className = "dev-footer-pip";
	pipSpan.setAttribute("data-field", "pip");
	pipSpan.setAttribute("data-state", "idle");
	pipSpan.textContent = "○";
	spans.push(pipSpan);

	const toolsSpan = document.createElement("span");
	toolsSpan.className = "dev-footer-tools";
	toolsSpan.setAttribute("data-field", "last-tools");
	toolsSpan.textContent = "";
	spans.push(toolsSpan);

	const llmSpan = document.createElement("span");
	llmSpan.className = "dev-footer-llm";
	llmSpan.setAttribute("data-field", "llm-line");
	llmSpan.textContent = "";
	spans.push(llmSpan);

	const chipsSpan = document.createElement("span");
	chipsSpan.className = "dev-footer-chips";
	chipsSpan.setAttribute("data-field", "complication-chips");
	chipsSpan.textContent = "";
	spans.push(chipsSpan);

	const focusBtn = document.createElement("button");
	focusBtn.className = "dev-footer-focus-vista";
	focusBtn.setAttribute("data-field", "focus-vista");
	focusBtn.setAttribute("type", "button");
	focusBtn.textContent = "[ focus vista ]";
	focusBtn.setAttribute("data-focus-active", "false");
	spans.push(focusBtn);

	return spans;
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

	const fields = buildFooterFields();
	for (const field of fields) {
		summaryDiv.appendChild(field);
	}

	footerEl.appendChild(summaryDiv);

	const detailsBlocks = [
		{
			disclosure: "system-prompt",
			summary: "last system prompt",
		},
		{
			disclosure: "raw-completion",
			summary: "last raw completion",
		},
		{
			disclosure: "tool-calls",
			summary: "last tool calls",
		},
		{
			disclosure: "error",
			summary: "last error",
		},
		{
			disclosure: "persona-card",
			summary: "persona card",
		},
	];

	for (const block of detailsBlocks) {
		const details = doc.createElement("details");
		details.className = "dev-footer-details";
		details.setAttribute("data-disclosure", block.disclosure);

		const summaryEl = doc.createElement("summary");
		summaryEl.textContent = block.summary;
		details.appendChild(summaryEl);

		if (block.disclosure === "persona-card") {
			const personaDiv = doc.createElement("div");
			personaDiv.className = "dev-footer-persona";
			personaDiv.setAttribute("data-content", "persona-card");

			const personaFields = [
				"handle",
				"color",
				"temperaments",
				"persona-goal",
				"blurb",
			];
			for (const field of personaFields) {
				const fieldDiv = doc.createElement("div");
				fieldDiv.setAttribute("data-persona-field", field);
				personaDiv.appendChild(fieldDiv);
			}

			details.appendChild(personaDiv);

			const state = session.getState();
			const persona = state.personas[aiId] as AiPersona | undefined;
			if (persona) {
				const handleEl = personaDiv.querySelector<HTMLElement>(
					'[data-persona-field="handle"]',
				);
				if (handleEl) {
					handleEl.textContent = `*${persona.name}`;
				}

				const colorEl = personaDiv.querySelector<HTMLElement>(
					'[data-persona-field="color"]',
				);
				if (colorEl) {
					const swatch = doc.createElement("span");
					swatch.className = "dev-footer-color-swatch";
					swatch.style.backgroundColor = persona.color;
					colorEl.appendChild(swatch);
					colorEl.appendChild(doc.createTextNode(persona.color));
				}

				const tempEl = personaDiv.querySelector<HTMLElement>(
					'[data-persona-field="temperaments"]',
				);
				if (tempEl) {
					tempEl.textContent = `${persona.temperaments[0]} / ${persona.temperaments[1]}`;
				}

				const goalEl = personaDiv.querySelector<HTMLElement>(
					'[data-persona-field="persona-goal"]',
				);
				if (goalEl) {
					goalEl.textContent = persona.personaGoal;
				}

				const blurbEl = personaDiv.querySelector<HTMLElement>(
					'[data-persona-field="blurb"]',
				);
				if (blurbEl) {
					blurbEl.textContent = persona.blurb;
				}
			}
		} else {
			const pre = doc.createElement("pre");
			pre.setAttribute("data-content", block.disclosure);
			pre.textContent = "";
			details.appendChild(pre);
		}

		footerEl.appendChild(details);
	}

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
	state: "in-flight" | "idle" | "errored",
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const pipSpan = footerEl.querySelector<HTMLElement>('[data-field="pip"]');
	if (!pipSpan) return;

	switch (state) {
		case "idle":
			pipSpan.textContent = "○";
			pipSpan.dataset.state = "idle";
			break;
		case "in-flight":
			pipSpan.textContent = "●";
			pipSpan.dataset.state = "in-flight";
			break;
		case "errored":
			pipSpan.textContent = "✕";
			pipSpan.dataset.state = "errored";
			break;
	}
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
	const result = daemonTurnResults[aiId];
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

export function updateDaemonFooterSummary(
	panelEl: HTMLElement,
	aiId: AiId,
	session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const state = session.getState();
	const doc = panelEl.ownerDocument;

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

export function updateDaemonFooterDetails(
	panelEl: HTMLElement,
	aiId: AiId,
	_session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const round = daemonRounds[aiId];

	const updateSummary = (disclosure: string, baseLabel: string): void => {
		const details = footerEl.querySelector<HTMLElement>(
			`[data-disclosure="${disclosure}"]`,
		);
		if (!details) return;
		const summary = details.querySelector<HTMLElement>("summary");
		if (summary) {
			summary.textContent = `${baseLabel}${round ? ` (round ${round})` : ""}`;
		}
	};

	const updatePreContent = (disclosure: string, content: string): void => {
		const details = footerEl.querySelector<HTMLElement>(
			`[data-disclosure="${disclosure}"]`,
		);
		if (!details) return;
		const pre = details.querySelector<HTMLElement>(
			`[data-content="${disclosure}"]`,
		);
		if (pre) {
			pre.textContent = content;
		}
	};

	updateSummary("system-prompt", "last system prompt");
	updatePreContent("system-prompt", daemonSystemPrompts[aiId] ?? "");

	updateSummary("raw-completion", "last raw completion");
	updatePreContent(
		"raw-completion",
		daemonTurnResults[aiId]?.lastRawCompletion ?? "",
	);

	updateSummary("tool-calls", "last tool calls");
	const toolCalls = daemonTurnResults[aiId]?.lastToolCalls ?? [];
	const toolCallsText = toolCalls
		.map((tc) => `${tc.name}(${tc.argumentsJson})`)
		.join("\n");
	updatePreContent("tool-calls", toolCallsText);

	updateSummary("error", "last error");
	const error = daemonErrors[aiId];
	let errorText = "";
	if (error) {
		errorText = error.statusCode
			? `${error.statusCode} ${error.text}`
			: error.text;
	}
	updatePreContent("error", errorText);
}
