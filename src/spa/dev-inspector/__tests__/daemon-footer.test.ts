import { beforeEach, describe, expect, it } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import type { GameState } from "../../game/types";
import {
	clearDaemonTurnResults,
	recordDaemonTurnResult,
	renderDaemonFooter,
	setDaemonFooterInFlight,
	updateDaemonFooterSummary,
} from "../daemon-footer";

describe("daemon-footer", () => {
	beforeEach(() => {
		// Create three panels with footers matching the HTML structure
		document.body.innerHTML = `
      <article class="ai-panel" data-ai="red">
        <div class="dev-daemon-footer" hidden></div>
      </article>
      <article class="ai-panel" data-ai="green">
        <div class="dev-daemon-footer" hidden></div>
      </article>
      <article class="ai-panel" data-ai="cyan">
        <div class="dev-daemon-footer" hidden></div>
      </article>
    `;
		// Clear the side-channel storage between tests
		clearDaemonTurnResults();
	});

	it("renderDaemonFooter builds the four field spans in order with pip initialized to idle ○", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		const summary = redPanel.querySelector('[data-line="summary"]');
		expect(summary).toBeTruthy();

		// Check the four spans exist in order
		const pip = summary?.querySelector('[data-field="pip"]');
		expect(pip).toBeTruthy();
		expect(pip?.textContent).toBe("○");
		expect(pip?.getAttribute("data-state")).toBe("idle");

		const tools = summary?.querySelector('[data-field="last-tools"]');
		expect(tools).toBeTruthy();

		const llm = summary?.querySelector('[data-field="llm-line"]');
		expect(llm).toBeTruthy();

		const chips = summary?.querySelector('[data-field="complication-chips"]');
		expect(chips).toBeTruthy();

		// Verify order by checking that pip is first
		const allSpans = Array.from(summary?.querySelectorAll("span") ?? []);
		expect(allSpans[0]).toBe(pip);
	});

	it("renderDaemonFooter removes the hidden attribute from .dev-daemon-footer", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		const footerEl = redPanel.querySelector<HTMLElement>(".dev-daemon-footer");
		expect(footerEl?.hasAttribute("hidden")).toBe(true);

		renderDaemonFooter(redPanel, "red", session);

		expect(footerEl?.hasAttribute("hidden")).toBe(false);
	});

	it("setDaemonFooterInFlight flips pip glyph and data-state across all three values", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		// Start at idle
		const pip = redPanel.querySelector<HTMLElement>('[data-field="pip"]');
		expect(pip?.textContent).toBe("○");
		expect(pip?.getAttribute("data-state")).toBe("idle");

		// Flip to in-flight
		setDaemonFooterInFlight(redPanel, "in-flight");
		expect(pip?.textContent).toBe("●");
		expect(pip?.getAttribute("data-state")).toBe("in-flight");

		// Flip to errored
		setDaemonFooterInFlight(redPanel, "errored");
		expect(pip?.textContent).toBe("✕");
		expect(pip?.getAttribute("data-state")).toBe("errored");

		// Flip back to idle
		setDaemonFooterInFlight(redPanel, "idle");
		expect(pip?.textContent).toBe("○");
		expect(pip?.getAttribute("data-state")).toBe("idle");
	});

	it("updateDaemonFooterSummary lists last-round tool calls from conversationLogs, comma-separated", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Create a modified state with tool calls in the conversation log
		const modifiedState: GameState = {
			...state,
			conversationLogs: {
				...state.conversationLogs,
				red: [
					{
						kind: "tool-call",
						round: 1,
						aiId: "red",
						toolCallId: "tc1",
						toolArgumentsJson: "{}",
						toolName: "go",
						result: "moved",
						success: true,
					},
					{
						kind: "tool-call",
						round: 1,
						aiId: "red",
						toolCallId: "tc2",
						toolArgumentsJson: "{}",
						toolName: "pick_up",
						result: "picked up item",
						success: true,
					},
				],
			},
		};

		const restoredSession = GameSession.restore(modifiedState);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", restoredSession);
		updateDaemonFooterSummary(redPanel, "red", restoredSession);

		const toolsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		);
		expect(toolsSpan?.textContent).toBe("go, pick_up");
	});

	it("updateDaemonFooterSummary includes the message tool when the last round was a successful message-only turn", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Create a modified state with only a message in the last round
		const modifiedState: GameState = {
			...state,
			conversationLogs: {
				...state.conversationLogs,
				red: [
					{
						kind: "message",
						round: 1,
						from: "red",
						to: "blue",
						content: "Hello",
					},
				],
			},
		};

		const restoredSession = GameSession.restore(modifiedState);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", restoredSession);
		updateDaemonFooterSummary(redPanel, "red", restoredSession);

		const toolsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		);
		expect(toolsSpan?.textContent).toBe("message");
	});

	it("updateDaemonFooterSummary renders the LLM line from recordDaemonTurnResult data", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		// Record a turn result with specific token/cost data
		recordDaemonTurnResult("red", {
			promptTokens: 1200,
			completionTokens: 80,
			cachedPromptTokens: 600,
			costUsd: 0.0042,
		});

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterSummary(redPanel, "red", session);

		const llmSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="llm-line"]',
		);
		expect(llmSpan?.textContent).toBe("[tok 1200→80 cache 50% $0.0042]");
	});

	it("updateDaemonFooterSummary renders empty LLM line when no turn result recorded yet", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		// Don't record any turn result for "red"

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterSummary(redPanel, "red", session);

		const llmSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="llm-line"]',
		);
		expect(llmSpan?.textContent).toBe("");
	});

	it("updateDaemonFooterSummary renders complication chips filtered by target=aiId", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Create a modified state with complications targeting different AIs
		const modifiedState: GameState = {
			...state,
			activeComplications: [
				{
					kind: "sysadmin_directive",
					target: "red",
					directive: "do something",
					resolveAtRound: 5,
				},
				{
					kind: "tool_disable",
					target: "red",
					tool: "pick_up",
					resolveAtRound: 3,
				},
				{
					kind: "chat_lockout",
					target: "green",
					resolveAtRound: 2,
				},
			],
		};

		const restoredSession = GameSession.restore(modifiedState);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", restoredSession);
		updateDaemonFooterSummary(redPanel, "red", restoredSession);

		const chipsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="complication-chips"]',
		);
		const chips = chipsSpan?.querySelectorAll(".dev-footer-chip");
		expect(chips?.length).toBe(2);

		// Check the text content of the chips
		const chipTexts = Array.from(chips ?? []).map((c) => c.textContent);
		expect(chipTexts).toContain("[sysadm-dir]");
		expect(chipTexts).toContain("[tool-dis:pick_up]");
	});

	it("updateDaemonFooterSummary does NOT mutate the pip span", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);
		setDaemonFooterInFlight(redPanel, "in-flight");

		const pip = redPanel.querySelector<HTMLElement>('[data-field="pip"]');
		const pipId = pip;

		// Update the summary
		updateDaemonFooterSummary(redPanel, "red", session);

		// Verify pip is still the same DOM node
		const pipAfter = redPanel.querySelector<HTMLElement>('[data-field="pip"]');
		expect(pipAfter).toBe(pipId);

		// Verify it's still in-flight
		expect(pipAfter?.textContent).toBe("●");
		expect(pipAfter?.getAttribute("data-state")).toBe("in-flight");
	});

	it("per-Daemon footers show their own last-round number — three footers can disagree", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Create a modified state with different rounds for different AIs
		const modifiedState: GameState = {
			...state,
			conversationLogs: {
				...state.conversationLogs,
				red: [
					{
						kind: "tool-call",
						round: 3,
						aiId: "red",
						toolCallId: "tc1",
						toolArgumentsJson: "{}",
						toolName: "go",
						result: "moved",
						success: true,
					},
				],
				green: [
					{
						kind: "tool-call",
						round: 2,
						aiId: "green",
						toolCallId: "tc2",
						toolArgumentsJson: "{}",
						toolName: "pick_up",
						result: "picked up",
						success: true,
					},
				],
				cyan: [
					{
						kind: "tool-call",
						round: 1,
						aiId: "cyan",
						toolCallId: "tc3",
						toolArgumentsJson: "{}",
						toolName: "use",
						result: "used",
						success: true,
					},
				],
			},
		};

		const restoredSession = GameSession.restore(modifiedState);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		const greenPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="green"]',
		);
		const cyanPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="cyan"]',
		);

		if (!redPanel || !greenPanel || !cyanPanel)
			throw new Error("Panels not found");

		renderDaemonFooter(redPanel, "red", restoredSession);
		renderDaemonFooter(greenPanel, "green", restoredSession);
		renderDaemonFooter(cyanPanel, "cyan", restoredSession);

		updateDaemonFooterSummary(redPanel, "red", restoredSession);
		updateDaemonFooterSummary(greenPanel, "green", restoredSession);
		updateDaemonFooterSummary(cyanPanel, "cyan", restoredSession);

		const redTools = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		)?.textContent;
		const greenTools = greenPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		)?.textContent;
		const cyanTools = cyanPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		)?.textContent;

		// Each should show only their own last tool
		expect(redTools).toBe("go");
		expect(greenTools).toBe("pick_up");
		expect(cyanTools).toBe("use");
	});
});
