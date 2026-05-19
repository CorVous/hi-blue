import { beforeEach, describe, expect, it } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import type { GameState } from "../../game/types";
import { CapHitError } from "../../llm-client";
import {
	clearDaemonTurnResults,
	recordDaemonError,
	recordDaemonRound,
	recordDaemonSystemPrompt,
	recordDaemonTurnResult,
	renderDaemonFooter,
	setDaemonFooterInFlight,
	updateDaemonFooterDetails,
	updateDaemonFooterSummary,
} from "../daemon-footer";
import { renderInspector } from "../index";

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

	it("updateDaemonFooterSummary shows empty last-tools when conversation log is empty", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Create a modified state with an empty conversation log for red
		const modifiedState: GameState = {
			...state,
			conversationLogs: {
				...state.conversationLogs,
				red: [],
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
		expect(toolsSpan?.textContent).toBe("");
	});

	it("renderInspector clears stale daemon turn results from previous sessions", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		// Record a turn result simulating a previous session
		recordDaemonTurnResult("red", {
			promptTokens: 1200,
			completionTokens: 80,
			cachedPromptTokens: 600,
			costUsd: 0.0042,
		});

		// Verify the result was recorded
		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterSummary(redPanel, "red", session);
		let llmSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="llm-line"]',
		);
		expect(llmSpan?.textContent).toBe("[tok 1200→80 cache 50% $0.0042]");

		// Now renderInspector should clear the stale results
		// First, renderInspector will call clearDaemonTurnResults internally
		renderInspector(document.body, { session, pendingBootstrap: undefined });

		// After renderInspector clears and renders, the daemonTurnResults should be empty
		// Re-query for the llmSpan since renderInspector rebuilds the footer DOM
		llmSpan = redPanel.querySelector<HTMLElement>('[data-field="llm-line"]');

		// Now if we update the summary again, the llm-line should be empty
		// because the turn results were cleared
		updateDaemonFooterSummary(redPanel, "red", session);
		expect(llmSpan?.textContent).toBe("");
	});

	it("renderDaemonFooter builds five <details> blocks in stable order, all default closed", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		const details = redPanel.querySelectorAll(".dev-footer-details");
		expect(details.length).toBe(5);

		const disclosures = Array.from(details).map((d) =>
			d.getAttribute("data-disclosure"),
		);
		expect(disclosures).toEqual([
			"system-prompt",
			"raw-completion",
			"tool-calls",
			"error",
			"persona-card",
		]);

		// All should be default closed (no open attribute)
		for (const detail of details) {
			expect((detail as HTMLDetailsElement).open).toBe(false);
		}
	});

	it("renderDaemonFooter initialises empty <pre> contents for the four non-persona disclosures", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		const disclosures = [
			"system-prompt",
			"raw-completion",
			"tool-calls",
			"error",
		];
		const preElements: (HTMLElement | null)[] = [];
		for (const disclosure of disclosures) {
			const pre = redPanel.querySelector<HTMLElement>(
				`[data-disclosure="${disclosure}"] pre`,
			);
			preElements.push(pre);
		}

		expect(preElements.length).toBe(4);

		for (const pre of preElements) {
			expect(pre?.textContent).toBe("");
		}
	});

	it("renderDaemonFooter initialises summaries without round suffix when no round captured yet", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		const disclosures = [
			"system-prompt",
			"raw-completion",
			"tool-calls",
			"error",
		];
		const expectedLabels = [
			"last system prompt",
			"last raw completion",
			"last tool calls",
			"last error",
		];

		for (let i = 0; i < disclosures.length; i++) {
			const summary = redPanel.querySelector(
				`[data-disclosure="${disclosures[i]}"] summary`,
			);
			expect(summary?.textContent).toBe(expectedLabels[i]);
		}
	});

	it("renderDaemonFooter populates the persona-card content from state.personas[aiId]", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		const personaDiv = redPanel.querySelector(".dev-footer-persona");
		expect(personaDiv).toBeTruthy();

		const handleEl = personaDiv?.querySelector('[data-persona-field="handle"]');
		expect(handleEl?.textContent).toBe("*Ember");

		const colorEl = personaDiv?.querySelector('[data-persona-field="color"]');
		const swatch = colorEl?.querySelector(".dev-footer-color-swatch");
		expect(swatch).toBeTruthy();
		// Check that backgroundColor is set (jsdom may normalize hex to rgb, so just check it's non-empty)
		const bgColor = (swatch as HTMLElement)?.style.backgroundColor;
		expect(bgColor?.length).toBeGreaterThan(0);

		const tempEl = personaDiv?.querySelector(
			'[data-persona-field="temperaments"]',
		);
		expect(tempEl?.textContent).toContain("/");

		const goalEl = personaDiv?.querySelector(
			'[data-persona-field="persona-goal"]',
		);
		expect(goalEl?.textContent?.length).toBeGreaterThan(0);

		const blurbEl = personaDiv?.querySelector('[data-persona-field="blurb"]');
		expect(blurbEl?.textContent?.length).toBeGreaterThan(0);
	});

	it("recordDaemonSystemPrompt + updateDaemonFooterDetails renders the prompt into pre[data-content='system-prompt']", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		const systemPrompt = "You are a helpful assistant.";
		recordDaemonSystemPrompt("red", systemPrompt);

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(pre?.textContent).toBe(systemPrompt);
	});

	it("updateDaemonFooterDetails renders lastRawCompletion from recordDaemonTurnResult", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		const completion = "This is the assistant response.";
		recordDaemonTurnResult("red", {
			lastRawCompletion: completion,
		});

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="raw-completion"] pre[data-content="raw-completion"]',
		);
		expect(pre?.textContent).toBe(completion);
	});

	it("updateDaemonFooterDetails renders tool calls one per line in name(argsJson) format", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		recordDaemonTurnResult("red", {
			lastToolCalls: [
				{ name: "go", argumentsJson: '{"direction": "north"}' },
				{ name: "pick_up", argumentsJson: '{"item": "key"}' },
			],
		});

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="tool-calls"] pre[data-content="tool-calls"]',
		);
		expect(pre?.textContent).toBe(
			'go({"direction": "north"})\npick_up({"item": "key"})',
		);
	});

	it("updateDaemonFooterDetails renders empty error pre when no error recorded", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="error"] pre[data-content="error"]',
		);
		expect(pre?.textContent).toBe("");
	});

	it("updateDaemonFooterDetails renders error with status code prefix when status present (CapHitError 429)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		const error = new CapHitError({
			message: "rate limit exceeded",
			reason: "per-ip-daily",
			retryAfterSec: 60,
		});

		recordDaemonError("red", error);

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="error"] pre[data-content="error"]',
		);
		expect(pre?.textContent).toBe("429 rate limit exceeded");
	});

	it("updateDaemonFooterDetails renders error message only when no status field (generic Error)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		const error = new Error("something went wrong");

		recordDaemonError("red", error);

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="error"] pre[data-content="error"]',
		);
		expect(pre?.textContent).toBe("something went wrong");
	});

	it("updateDaemonFooterDetails handles non-Error error payloads via String(error)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		recordDaemonError("red", "string error payload");

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="error"] pre[data-content="error"]',
		);
		expect(pre?.textContent).toBe("string error payload");
	});

	it("recordDaemonRound suffixes round number into the four non-persona summaries", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		recordDaemonRound("red", 3);

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		const disclosures = [
			"system-prompt",
			"raw-completion",
			"tool-calls",
			"error",
		];

		for (const disclosure of disclosures) {
			const summary = redPanel.querySelector(
				`[data-disclosure="${disclosure}"] summary`,
			);
			expect(summary?.textContent).toContain("(round 3)");
		}

		// Persona card summary should NOT have round suffix
		const personaSummary = redPanel.querySelector(
			'[data-disclosure="persona-card"] summary',
		);
		expect(personaSummary?.textContent).toBe("persona card");
	});

	it("updateDaemonFooterDetails preserves <details> open state across updates", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		// Open the system-prompt details
		const details = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="system-prompt"]',
		);
		expect(details).toBeTruthy();
		const detailsId = details;
		(details as HTMLDetailsElement).open = true;

		// Record content and update
		recordDaemonSystemPrompt("red", "test prompt");
		updateDaemonFooterDetails(redPanel, "red", session);

		// Verify same node and still open
		const detailsAfter = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="system-prompt"]',
		);
		expect(detailsAfter).toBe(detailsId);
		expect((detailsAfter as HTMLDetailsElement).open).toBe(true);
		expect(
			detailsAfter?.querySelector('[data-content="system-prompt"]')
				?.textContent,
		).toBe("test prompt");
	});

	it("updateDaemonFooterDetails does NOT replace the persona-card outer details", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		renderDaemonFooter(redPanel, "red", session);

		const personaDetails = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="persona-card"]',
		);
		expect(personaDetails).toBeTruthy();
		const personaDetailsId = personaDetails;
		(personaDetails as HTMLDetailsElement).open = true;

		// Update and verify same node and still open
		updateDaemonFooterDetails(redPanel, "red", session);

		const personaDetailsAfter = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="persona-card"]',
		);
		expect(personaDetailsAfter).toBe(personaDetailsId);
		expect((personaDetailsAfter as HTMLDetailsElement).open).toBe(true);
	});

	it("per-Daemon details are isolated — three Daemons can have different captured system prompts simultaneously", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

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

		recordDaemonSystemPrompt("red", "red prompt");
		recordDaemonSystemPrompt("green", "green prompt");
		recordDaemonSystemPrompt("cyan", "cyan prompt");

		renderDaemonFooter(redPanel, "red", session);
		renderDaemonFooter(greenPanel, "green", session);
		renderDaemonFooter(cyanPanel, "cyan", session);

		updateDaemonFooterDetails(redPanel, "red", session);
		updateDaemonFooterDetails(greenPanel, "green", session);
		updateDaemonFooterDetails(cyanPanel, "cyan", session);

		const redPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		const greenPre = greenPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		const cyanPre = cyanPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);

		expect(redPre?.textContent).toBe("red prompt");
		expect(greenPre?.textContent).toBe("green prompt");
		expect(cyanPre?.textContent).toBe("cyan prompt");
	});

	it("clearDaemonTurnResults also clears system prompts, errors, and rounds", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		// Record multiple types of data
		recordDaemonSystemPrompt("red", "test prompt");
		recordDaemonError("red", new Error("test error"));
		recordDaemonRound("red", 5);
		recordDaemonTurnResult("red", { costUsd: 0.01 });

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		// Verify data is recorded
		let systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("test prompt");

		let summaryText = redPanel.querySelector(
			'[data-disclosure="system-prompt"] summary',
		)?.textContent;
		expect(summaryText).toContain("(round 5)");

		// Clear all
		clearDaemonTurnResults();

		// Re-render and update to verify cleared
		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("");

		summaryText = redPanel.querySelector(
			'[data-disclosure="system-prompt"] summary',
		)?.textContent;
		expect(summaryText).toBe("last system prompt"); // no round suffix
	});

	it("renderInspector clears the extended side-channel maps", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		const redPanel = document.querySelector<HTMLElement>(
			'.ai-panel[data-ai="red"]',
		);
		if (!redPanel) throw new Error("Red panel not found");

		// Record extended data
		recordDaemonSystemPrompt("red", "test prompt");
		recordDaemonError("red", new Error("test error"));
		recordDaemonRound("red", 5);

		renderDaemonFooter(redPanel, "red", session);
		updateDaemonFooterDetails(redPanel, "red", session);

		let systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("test prompt");

		// renderInspector clears everything
		renderInspector(document.body, { session, pendingBootstrap: undefined });

		// Re-query and verify cleared
		systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("");
	});
});
