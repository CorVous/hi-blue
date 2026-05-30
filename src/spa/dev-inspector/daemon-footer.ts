/**
 * daemon-footer.ts
 *
 * Renders per-Daemon footer summary lines in the dev inspector showing:
 * - Pip (lifecycle indicator: ○ idle, ● in-flight, ✕ errored)
 * - Last-round tool calls and messages
 * - LLM metrics (tokens, cache %, cost)
 * - Active complications affecting this Daemon
 */

import type { GameSession } from "../game/game-session";
import type { AiId, AiPersona, ConversationEntry } from "../game/types";
import { getMapFocus, setMapFocus } from "./world-map.js";

/**
 * Side-channel storage for per-AI turn results (tokens, cost, completion, tool calls).
 * RoundTurnResult is not stored in GameState, so we maintain this
 * map separately. The provider wrapper populates it; updateDaemonFooterSummary
 * reads from it.
 */
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

/**
 * Side-channel storage for per-AI system prompts.
 */
const daemonSystemPrompts: Record<string, string> = {};

/**
 * Side-channel storage for per-AI errors with optional status codes.
 */
const daemonErrors: Record<string, { text: string; statusCode?: number }> = {};

/**
 * Side-channel storage for per-AI round numbers.
 */
const daemonRounds: Record<string, number> = {};

/**
 * Record a turn result for an AI (called by the provider wrapper in views/game.ts).
 * Stores token/cost data for later rendering in the footer summary.
 */
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

/**
 * Clear all recorded turn results (used by tests).
 */
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

/**
 * Record a system prompt for an AI (called by the provider wrapper in views/game.ts).
 */
export function recordDaemonSystemPrompt(
	aiId: AiId,
	systemPrompt: string,
): void {
	daemonSystemPrompts[aiId] = systemPrompt;
}

/**
 * Record an error for an AI (called by the provider wrapper in views/game.ts).
 * Extracts the error message and status code (if present).
 */
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

/**
 * Record the current round number for an AI (called by the provider wrapper in views/game.ts).
 */
export function recordDaemonRound(aiId: AiId, round: number): void {
	daemonRounds[aiId] = round;
}

/**
 * Build the footer fields (pip, tools, llm, chips, focus button).
 * Returns an array of elements ready to append to a container.
 */
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
	focusBtn.className = "dev-footer-focus-cone";
	focusBtn.setAttribute("data-field", "focus-cone");
	focusBtn.setAttribute("type", "button");
	focusBtn.textContent = "[ focus cone ]";
	focusBtn.setAttribute("data-focus-active", "false");
	spans.push(focusBtn);

	return spans;
}

/**
 * Initialize the footer DOM for a Daemon. Builds the summary line with
 * four field spans, then five <details> disclosure blocks. Removes the hidden attribute.
 */
export function renderDaemonFooter(
	panelEl: HTMLElement,
	aiId: AiId,
	session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const doc = panelEl.ownerDocument;

	// Clear and build the summary line
	footerEl.replaceChildren();
	const summaryDiv = doc.createElement("div");
	summaryDiv.className = "dev-footer-summary";
	summaryDiv.setAttribute("data-line", "summary");

	const fields = buildFooterFields();
	for (const field of fields) {
		summaryDiv.appendChild(field);
	}

	footerEl.appendChild(summaryDiv);

	// Build the five <details> blocks
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
			// Persona card has a special div structure
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

			// Populate persona card content immediately (static within session)
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
			// Non-persona blocks have a <pre> with data-content
			const pre = doc.createElement("pre");
			pre.setAttribute("data-content", block.disclosure);
			pre.textContent = "";
			details.appendChild(pre);
		}

		footerEl.appendChild(details);
	}

	// Remove hidden attribute
	footerEl.removeAttribute("hidden");

	// Attach click handler to focus-cone button
	const focusBtnEl = panelEl.querySelector<HTMLButtonElement>(
		'[data-field="focus-cone"]',
	);
	if (focusBtnEl) {
		focusBtnEl.addEventListener("click", () => {
			const current = getMapFocus();
			setMapFocus(current === aiId ? null : aiId);
		});
	}
}

/**
 * Change the pip state (lifecycle indicator).
 * Finds [data-field="pip"] within panelEl's .dev-daemon-footer and updates
 * both textContent and dataset.state.
 */
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

/**
 * Compute the last-round tool calls for an AI from conversationLogs.
 * Returns a comma-separated list of tool names and "message" for the last round,
 * or empty string if no entries exist.
 */
function computeLastRoundTools(
	conversationLog: ConversationEntry[],
	aiId: AiId,
): string {
	if (conversationLog.length === 0) return "";

	// Find the max round number from entries where kind == "tool-call" && aiId == aiId
	// or kind == "message" && from == aiId
	let maxRound = -1;
	for (const entry of conversationLog) {
		if (entry.kind === "tool-call" && entry.aiId === aiId) {
			maxRound = Math.max(maxRound, entry.round);
		} else if (entry.kind === "message" && entry.from === aiId) {
			maxRound = Math.max(maxRound, entry.round);
		}
	}

	if (maxRound === -1) return "";

	// Collect all tools/messages from that round
	const tools: string[] = [];
	let seenMessage = false;

	for (const entry of conversationLog) {
		if (entry.round === maxRound) {
			if (entry.kind === "tool-call" && entry.aiId === aiId) {
				tools.push(entry.toolName);
			} else if (entry.kind === "message" && entry.from === aiId) {
				seenMessage = true;
			}
		}
	}

	// Add "message" if this AI sent a message in the last round
	if (seenMessage) {
		tools.push("message");
	}

	return tools.join(", ");
}

/**
 * Compute the LLM line from the side-channel turn result data.
 * Format: [tok N→M cache P% $C]
 * Returns empty string if no result recorded.
 */
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

/**
 * Build complication chip spans for an AI.
 * Filters state.activeComplications by target===aiId and renders
 * appropriate text + data-chip-kind attributes.
 */
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

/**
 * Update the footer summary line (all fields except pip, which is managed separately).
 * MUST NOT modify [data-field="pip"] — only updates the three non-pip fields:
 * - last-tools, llm-line, complication-chips
 */
export function updateDaemonFooterSummary(
	panelEl: HTMLElement,
	aiId: AiId,
	session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const state = session.getState();
	const doc = panelEl.ownerDocument;

	// Update last-tools
	const toolsSpan = footerEl.querySelector<HTMLElement>(
		'[data-field="last-tools"]',
	);
	if (toolsSpan) {
		const conversationLog = state.conversationLogs[aiId] ?? [];
		toolsSpan.textContent = computeLastRoundTools(conversationLog, aiId);
	}

	// Update llm-line
	const llmSpan = footerEl.querySelector<HTMLElement>(
		'[data-field="llm-line"]',
	);
	if (llmSpan) {
		llmSpan.textContent = computeLlmLine(aiId);
	}

	// Update complication-chips
	const chipsSpan = footerEl.querySelector<HTMLElement>(
		'[data-field="complication-chips"]',
	);
	if (chipsSpan) {
		const newChips = buildComplicationChips(doc, aiId, session);
		chipsSpan.replaceChildren(...newChips);
	}
}

/**
 * Update the five <details> disclosure blocks with current daemon state.
 * MUST NOT modify the <details> element itself or its open attribute.
 * Persona card is already populated in renderDaemonFooter and is not re-touched.
 */
export function updateDaemonFooterDetails(
	panelEl: HTMLElement,
	aiId: AiId,
	_session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	const round = daemonRounds[aiId];

	// Helper to update a disclosure block's summary with optional round suffix
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

	// Helper to update pre content
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

	// Update system-prompt
	updateSummary("system-prompt", "last system prompt");
	updatePreContent("system-prompt", daemonSystemPrompts[aiId] ?? "");

	// Update raw-completion
	updateSummary("raw-completion", "last raw completion");
	updatePreContent(
		"raw-completion",
		daemonTurnResults[aiId]?.lastRawCompletion ?? "",
	);

	// Update tool-calls
	updateSummary("tool-calls", "last tool calls");
	const toolCalls = daemonTurnResults[aiId]?.lastToolCalls ?? [];
	const toolCallsText = toolCalls
		.map((tc) => `${tc.name}(${tc.argumentsJson})`)
		.join("\n");
	updatePreContent("tool-calls", toolCallsText);

	// Update error
	updateSummary("error", "last error");
	const error = daemonErrors[aiId];
	let errorText = "";
	if (error) {
		errorText = error.statusCode
			? `${error.statusCode} ${error.text}`
			: error.text;
	}
	updatePreContent("error", errorText);

	// Note: persona-card is NOT updated here — it's already populated in renderDaemonFooter
}
