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
	refreshDaemonFooter,
	renderDaemonFooter,
	setDaemonFooterInFlight,
} from "../daemon-footer";
import { renderInspector } from "../index";

function panelFor(aiId: string): HTMLElement {
	const panel = document.querySelector<HTMLElement>(
		`.ai-panel[data-ai="${aiId}"]`,
	);
	if (!panel) throw new Error(`${aiId} panel not found`);
	return panel;
}

function renderAndRefresh(
	panel: HTMLElement,
	aiId: string,
	session: GameSession,
): void {
	renderDaemonFooter(panel, aiId, session);
	refreshDaemonFooter(panel, aiId, session);
}

function renderAndRefreshAll(session: GameSession): void {
	for (const aiId of ["red", "green", "cyan"]) {
		renderDaemonFooter(panelFor(aiId), aiId, session);
	}
	for (const aiId of ["red", "green", "cyan"]) {
		refreshDaemonFooter(panelFor(aiId), aiId, session);
	}
}

const NON_PERSONA_DISCLOSURES = [
	"system-prompt",
	"raw-completion",
	"tool-calls",
	"error",
];

describe("daemon-footer", () => {
	let session: GameSession;
	let redPanel: HTMLElement;
	let greenPanel: HTMLElement;
	let cyanPanel: HTMLElement;

	beforeEach(() => {
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
		clearDaemonTurnResults();
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		session = new GameSession(contentPack, STATIC_PERSONAS);
		redPanel = panelFor("red");
		greenPanel = panelFor("green");
		cyanPanel = panelFor("cyan");
	});

	it("renderDaemonFooter builds the four field spans in order with pip initialized to idle ○", () => {
		renderDaemonFooter(redPanel, "red", session);

		const summary = redPanel.querySelector('[data-line="summary"]');
		expect(summary).toBeTruthy();

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

		const allSpans = Array.from(summary?.querySelectorAll("span") ?? []);
		expect(allSpans[0]).toBe(pip);
	});

	it("renderDaemonFooter removes the hidden attribute from .dev-daemon-footer", () => {
		const footerEl = redPanel.querySelector<HTMLElement>(".dev-daemon-footer");
		expect(footerEl?.hasAttribute("hidden")).toBe(true);

		renderDaemonFooter(redPanel, "red", session);

		expect(footerEl?.hasAttribute("hidden")).toBe(false);
	});

	it("setDaemonFooterInFlight flips pip glyph and data-state across all three values", () => {
		renderDaemonFooter(redPanel, "red", session);

		const pip = redPanel.querySelector<HTMLElement>('[data-field="pip"]');
		expect(pip?.textContent).toBe("○");
		expect(pip?.getAttribute("data-state")).toBe("idle");

		setDaemonFooterInFlight(redPanel, "in-flight");
		expect(pip?.textContent).toBe("●");
		expect(pip?.getAttribute("data-state")).toBe("in-flight");

		setDaemonFooterInFlight(redPanel, "errored");
		expect(pip?.textContent).toBe("✕");
		expect(pip?.getAttribute("data-state")).toBe("errored");

		setDaemonFooterInFlight(redPanel, "idle");
		expect(pip?.textContent).toBe("○");
		expect(pip?.getAttribute("data-state")).toBe("idle");
	});

	it("refreshDaemonFooter lists last-round tool calls from conversationLogs, comma-separated", () => {
		const state = session.getState();

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

		renderAndRefresh(redPanel, "red", restoredSession);

		const toolsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		);
		expect(toolsSpan?.textContent).toBe("go, pick_up");
	});

	it("refreshDaemonFooter includes the message tool when the last round was a successful message-only turn", () => {
		const state = session.getState();

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

		renderAndRefresh(redPanel, "red", restoredSession);

		const toolsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		);
		expect(toolsSpan?.textContent).toBe("message");
	});

	it("refreshDaemonFooter renders the LLM line from recordDaemonTurnResult data", () => {
		recordDaemonTurnResult("red", {
			promptTokens: 1200,
			completionTokens: 80,
			cachedPromptTokens: 600,
			costUsd: 0.0042,
		});

		renderAndRefresh(redPanel, "red", session);

		const llmSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="llm-line"]',
		);
		expect(llmSpan?.textContent).toBe("[tok 1200→80 cache 50% $0.0042]");
	});

	it("refreshDaemonFooter renders empty LLM line when no turn result recorded yet", () => {
		renderAndRefresh(redPanel, "red", session);

		const llmSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="llm-line"]',
		);
		expect(llmSpan?.textContent).toBe("");
	});

	it("refreshDaemonFooter renders complication chips filtered by target=aiId", () => {
		const state = session.getState();

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

		renderAndRefresh(redPanel, "red", restoredSession);

		const chipsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="complication-chips"]',
		);
		const chips = chipsSpan?.querySelectorAll(".dev-footer-chip");
		expect(chips?.length).toBe(2);

		const chipTexts = Array.from(chips ?? []).map((c) => c.textContent);
		expect(chipTexts).toContain("[sysadm-dir]");
		expect(chipTexts).toContain("[tool-dis:pick_up]");
	});

	it("renderInspector fills the footer summary and details straight away", () => {
		const restoredSession = GameSession.restore({
			...session.getState(),
			activeComplications: [
				{
					kind: "tool_disable",
					target: "red",
					tool: "pick_up",
					resolveAtRound: 3,
				},
			],
		});

		renderInspector(document.body, { session: restoredSession });

		const chipTexts = Array.from(
			redPanel.querySelectorAll(
				'[data-field="complication-chips"] .dev-footer-chip',
			),
		).map((chip) => chip.textContent);
		expect(chipTexts).toEqual(["[tool-dis:pick_up]"]);
	});

	it("refreshDaemonFooter does NOT mutate the pip span", () => {
		renderDaemonFooter(redPanel, "red", session);
		setDaemonFooterInFlight(redPanel, "in-flight");

		const pip = redPanel.querySelector<HTMLElement>('[data-field="pip"]');
		const pipId = pip;

		refreshDaemonFooter(redPanel, "red", session);

		const pipAfter = redPanel.querySelector<HTMLElement>('[data-field="pip"]');
		expect(pipAfter).toBe(pipId);

		expect(pipAfter?.textContent).toBe("●");
		expect(pipAfter?.getAttribute("data-state")).toBe("in-flight");
	});

	it("per-Daemon footers show their own last-round number — three footers can disagree", () => {
		const state = session.getState();

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

		renderAndRefreshAll(restoredSession);

		const redTools = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		)?.textContent;
		const greenTools = greenPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		)?.textContent;
		const cyanTools = cyanPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		)?.textContent;

		expect(redTools).toBe("go");
		expect(greenTools).toBe("pick_up");
		expect(cyanTools).toBe("use");
	});

	it("refreshDaemonFooter shows empty last-tools when conversation log is empty", () => {
		const state = session.getState();

		const modifiedState: GameState = {
			...state,
			conversationLogs: {
				...state.conversationLogs,
				red: [],
			},
		};

		const restoredSession = GameSession.restore(modifiedState);

		renderAndRefresh(redPanel, "red", restoredSession);

		const toolsSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="last-tools"]',
		);
		expect(toolsSpan?.textContent).toBe("");
	});

	it("renderInspector clears stale daemon turn results from previous sessions", () => {
		recordDaemonTurnResult("red", {
			promptTokens: 1200,
			completionTokens: 80,
			cachedPromptTokens: 600,
			costUsd: 0.0042,
		});

		renderAndRefresh(redPanel, "red", session);
		let llmSpan = redPanel.querySelector<HTMLElement>(
			'[data-field="llm-line"]',
		);
		expect(llmSpan?.textContent).toBe("[tok 1200→80 cache 50% $0.0042]");

		renderInspector(document.body, { session });

		llmSpan = redPanel.querySelector<HTMLElement>('[data-field="llm-line"]');

		refreshDaemonFooter(redPanel, "red", session);
		expect(llmSpan?.textContent).toBe("");
	});

	it("renderDaemonFooter builds five <details> blocks in stable order, all default closed", () => {
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

		for (const detail of details) {
			expect((detail as HTMLDetailsElement).open).toBe(false);
		}
	});

	it("renderDaemonFooter initialises the four non-persona disclosures with empty <pre> and no round suffix", () => {
		renderDaemonFooter(redPanel, "red", session);

		const expectedLabels = [
			"last system prompt",
			"last raw completion",
			"last tool calls",
			"last error",
		];

		for (const [i, disclosure] of NON_PERSONA_DISCLOSURES.entries()) {
			const pre = redPanel.querySelector<HTMLElement>(
				`[data-disclosure="${disclosure}"] pre`,
			);
			expect(pre?.textContent, disclosure).toBe("");
			const summary = redPanel.querySelector(
				`[data-disclosure="${disclosure}"] summary`,
			);
			expect(summary?.textContent).toBe(expectedLabels[i]);
		}
	});

	it("renderDaemonFooter populates the persona-card content from state.personas[aiId]", () => {
		renderDaemonFooter(redPanel, "red", session);

		const personaDiv = redPanel.querySelector(".dev-footer-persona");
		expect(personaDiv).toBeTruthy();

		const handleEl = personaDiv?.querySelector('[data-persona-field="handle"]');
		expect(handleEl?.textContent).toBe("*Ember");

		const colorEl = personaDiv?.querySelector('[data-persona-field="color"]');
		const swatch = colorEl?.querySelector(".dev-footer-color-swatch");
		expect(swatch).toBeTruthy();
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

	it("recordDaemonSystemPrompt + refreshDaemonFooter renders the prompt into pre[data-content='system-prompt']", () => {
		const systemPrompt = "You are a helpful assistant.";
		recordDaemonSystemPrompt("red", systemPrompt);

		renderAndRefresh(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(pre?.textContent).toBe(systemPrompt);
	});

	it("refreshDaemonFooter renders lastRawCompletion from recordDaemonTurnResult", () => {
		const completion = "This is the assistant response.";
		recordDaemonTurnResult("red", {
			lastRawCompletion: completion,
		});

		renderAndRefresh(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="raw-completion"] pre[data-content="raw-completion"]',
		);
		expect(pre?.textContent).toBe(completion);
	});

	it("refreshDaemonFooter renders tool calls one per line in name(argsJson) format", () => {
		recordDaemonTurnResult("red", {
			lastToolCalls: [
				{ name: "go", argumentsJson: '{"direction": "north"}' },
				{ name: "pick_up", argumentsJson: '{"item": "key"}' },
			],
		});

		renderAndRefresh(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="tool-calls"] pre[data-content="tool-calls"]',
		);
		expect(pre?.textContent).toBe(
			'go({"direction": "north"})\npick_up({"item": "key"})',
		);
	});

	it.each<[string, unknown, string]>([
		["nothing recorded", undefined, ""],
		[
			"a CapHitError 429 with its status code prefix",
			new CapHitError({
				message: "rate limit exceeded",
				reason: "per-ip-daily",
				retryAfterSec: 60,
			}),
			"429 rate limit exceeded",
		],
		[
			"a generic Error as its message only",
			new Error("something went wrong"),
			"something went wrong",
		],
		[
			"a non-Error payload via String(error)",
			"string error payload",
			"string error payload",
		],
	])("refreshDaemonFooter renders the error pre for %s", (_label, error, expected) => {
		if (error !== undefined) recordDaemonError("red", error);

		renderAndRefresh(redPanel, "red", session);

		const pre = redPanel.querySelector<HTMLElement>(
			'[data-disclosure="error"] pre[data-content="error"]',
		);
		expect(pre?.textContent).toBe(expected);
	});

	it("recordDaemonRound suffixes round number into the four non-persona summaries", () => {
		recordDaemonRound("red", 3);

		renderAndRefresh(redPanel, "red", session);

		for (const disclosure of NON_PERSONA_DISCLOSURES) {
			const summary = redPanel.querySelector(
				`[data-disclosure="${disclosure}"] summary`,
			);
			expect(summary?.textContent).toContain("(round 3)");
		}

		const personaSummary = redPanel.querySelector(
			'[data-disclosure="persona-card"] summary',
		);
		expect(personaSummary?.textContent).toBe("persona card");
	});

	it("refreshDaemonFooter preserves <details> open state across updates", () => {
		renderDaemonFooter(redPanel, "red", session);

		const details = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="system-prompt"]',
		);
		expect(details).toBeTruthy();
		const detailsId = details;
		(details as HTMLDetailsElement).open = true;

		recordDaemonSystemPrompt("red", "test prompt");
		refreshDaemonFooter(redPanel, "red", session);

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

	it("refreshDaemonFooter does NOT replace the persona-card outer details", () => {
		renderDaemonFooter(redPanel, "red", session);

		const personaDetails = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="persona-card"]',
		);
		expect(personaDetails).toBeTruthy();
		const personaDetailsId = personaDetails;
		(personaDetails as HTMLDetailsElement).open = true;

		refreshDaemonFooter(redPanel, "red", session);

		const personaDetailsAfter = redPanel.querySelector<HTMLDetailsElement>(
			'[data-disclosure="persona-card"]',
		);
		expect(personaDetailsAfter).toBe(personaDetailsId);
		expect((personaDetailsAfter as HTMLDetailsElement).open).toBe(true);
	});

	it("per-Daemon details are isolated — three Daemons can have different captured system prompts simultaneously", () => {
		recordDaemonSystemPrompt("red", "red prompt");
		recordDaemonSystemPrompt("green", "green prompt");
		recordDaemonSystemPrompt("cyan", "cyan prompt");

		renderAndRefreshAll(session);

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
		recordDaemonSystemPrompt("red", "test prompt");
		recordDaemonError("red", new Error("test error"));
		recordDaemonRound("red", 5);
		recordDaemonTurnResult("red", { costUsd: 0.01 });

		renderAndRefresh(redPanel, "red", session);

		let systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("test prompt");

		let summaryText = redPanel.querySelector(
			'[data-disclosure="system-prompt"] summary',
		)?.textContent;
		expect(summaryText).toContain("(round 5)");

		clearDaemonTurnResults();

		renderAndRefresh(redPanel, "red", session);

		systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("");

		summaryText = redPanel.querySelector(
			'[data-disclosure="system-prompt"] summary',
		)?.textContent;
		expect(summaryText).toBe("last system prompt");
	});

	it("renderInspector clears the extended side-channel maps", () => {
		recordDaemonSystemPrompt("red", "test prompt");
		recordDaemonError("red", new Error("test error"));
		recordDaemonRound("red", 5);

		renderAndRefresh(redPanel, "red", session);

		let systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("test prompt");

		renderInspector(document.body, { session });

		systemPromptPre = redPanel.querySelector(
			'[data-disclosure="system-prompt"] pre[data-content="system-prompt"]',
		);
		expect(systemPromptPre?.textContent).toBe("");
	});
});
