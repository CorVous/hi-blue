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
import type { AiId, ConversationEntry } from "../game/types";

/**
 * Side-channel storage for per-AI turn results (tokens, cost).
 * RoundTurnResult is not stored in GameState, so we maintain this
 * map separately. The provider wrapper populates it; updateDaemonFooterSummary
 * reads from it.
 */
export const daemonTurnResults: Record<
	string,
	{
		promptTokens?: number;
		completionTokens?: number;
		cachedPromptTokens?: number;
		costUsd?: number;
	}
> = {};

/**
 * Record a turn result for an AI (called by the provider wrapper in routes/game.ts).
 * Stores token/cost data for later rendering in the footer summary.
 */
export function recordDaemonTurnResult(
	aiId: AiId,
	result: {
		promptTokens?: number;
		completionTokens?: number;
		cachedPromptTokens?: number;
		costUsd?: number;
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
}

/**
 * Build the four field spans inside the footer summary line.
 * Returns an array of span elements ready to append to a container.
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

	return spans;
}

/**
 * Initialize the footer DOM for a Daemon. Builds the summary line with
 * four field spans. Removes the hidden attribute.
 */
export function renderDaemonFooter(
	panelEl: HTMLElement,
	_aiId: AiId,
	_session: GameSession,
): void {
	const footerEl = panelEl.querySelector<HTMLElement>(".dev-daemon-footer");
	if (!footerEl) return;

	// Clear and build the summary line
	footerEl.replaceChildren();
	const summaryDiv = panelEl.ownerDocument.createElement("div");
	summaryDiv.className = "dev-footer-summary";
	summaryDiv.setAttribute("data-line", "summary");

	const fields = buildFooterFields();
	for (const field of fields) {
		summaryDiv.appendChild(field);
	}

	footerEl.appendChild(summaryDiv);

	// Remove hidden attribute
	footerEl.removeAttribute("hidden");
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
