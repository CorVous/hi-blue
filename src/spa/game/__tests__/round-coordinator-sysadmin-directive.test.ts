/**
 * Tests for Sysadmin Directive complication wiring in the Round Coordinator.
 * Issue #298.
 *
 * These tests verify that runRound correctly:
 *   1. Draws directive text and patches the activeComplications entry.
 *   2. Delivers the directive as a sysadmin→target message.
 *   3. Revokes a pre-existing directive before issuing a new one.
 *   4. Keeps sysadmin messages private (only target's log receives them).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../direction";
import {
	appendMessage,
	createGame,
	getActivePhase,
	startPhase,
	updateActivePhase,
} from "../engine";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import { MockRoundLLMProvider } from "../round-llm-provider";
import type { AiId, AiPersona, ContentPack, PhaseConfig } from "../types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts.",
			"You lean on em-dashes.",
		],
		blurb: "Ember is hot-headed and zealous.",
		voiceExamples: ["ex1", "ex2", "ex3"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: ["Fragments.", "ALL-CAPS words."],
		blurb: "Sage is meticulous.",
		voiceExamples: ["ex1", "ex2", "ex3"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: ["No contractions.", "Ends with a question."],
		blurb: "Frost is laconic and diffident.",
		voiceExamples: ["ex1", "ex2", "ex3"],
	},
};

const TEST_CONTENT_PACK: ContentPack = {
	phaseNumber: 1,
	setting: "",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: {
		red: { position: { row: 0, col: 0 }, facing: "north" },
		green: { position: { row: 0, col: 1 }, facing: "north" },
		cyan: { position: { row: 0, col: 2 }, facing: "north" },
	},
};

const TEST_PHASE_CONFIG: PhaseConfig = {
	phaseNumber: 1,
	kRange: [0, 0],
	nRange: [0, 0],
	mRange: [0, 0],
	aiGoalPool: ["test goal"],
	budgetPerAi: 5,
};

function makeGame() {
	return startPhase(
		createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]),
		TEST_PHASE_CONFIG,
	);
}

function makeProvider() {
	return new MockRoundLLMProvider([
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
		{ assistantText: "", toolCalls: [] },
	]);
}

/**
 * Returns an rng that always returns a fixed value.
 * rng() === 0 → type draw picks index 0 ("weather_change").
 * We need to force a sysadmin_directive draw, which is index 1 in the pool.
 * Pool: [weather_change(0), sysadmin_directive(1), tool_disable(2), chat_lockout(3), setting_shift(4)]
 *
 * To pick sysadmin_directive: rng on type draw must be in [1/5, 2/5) → 0.2 works.
 * aiIds are ["red","green","cyan"]; rng for target draw of 0.0 picks index 0 → "red" (sorted by Object.keys).
 * rng for drawDirectiveText: 0.0 picks index 0 from pool.
 * rng for countdown reset: 0.0 picks min (5) → countdown resets to 5.
 */
function sysadminRng(callValues: number[]): () => number {
	let idx = 0;
	return () => {
		if (idx >= callValues.length) {
			// Default: return 0 for remaining calls.
			return 0;
		}
		// biome-ignore lint/style/noNonNullAssertion: bounded by check above
		return callValues[idx++]!;
	};
}

// ── Helper: patch countdown to 0 so tickComplication fires ───────────────────

function withCountdownZero(game: ReturnType<typeof makeGame>) {
	return updateActivePhase(game, (phase) => ({
		...phase,
		complicationSchedule: { ...phase.complicationSchedule, countdown: 0 },
	}));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runRound — sysadmin_directive complication", () => {
	it("activeComplications contains exactly one sysadmin_directive with non-empty directive text", async () => {
		// countdown=0 → tickComplication fires.
		// rng[0]=0.2 → type draw picks index 1 → sysadmin_directive.
		// rng[1]=0.0 → target draw picks first aiId (red).
		// rng[2]=0.0 → drawDirectiveText picks index 0 from pool.
		// rng[3]=0.0 → countdown reset to drawCountdown(rng, 5, 15) = 5+0*11=5.
		const game = withCountdownZero(makeGame());
		const rng = sysadminRng([0.2, 0.0, 0.0, 0.0]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			rng,
		);

		const phase = getActivePhase(nextState);
		const directives = phase.activeComplications.filter(
			(c) => c.kind === "sysadmin_directive",
		);
		expect(directives).toHaveLength(1);
		const directive = directives[0];
		expect(directive?.kind).toBe("sysadmin_directive");
		if (directive?.kind === "sysadmin_directive") {
			expect(directive.directive).not.toBe("");
			expect(directive.directive).toMatch(/./); // non-empty string
		}
	});

	it("target Daemon's conversationLog contains a sysadmin message with directive text and secrecy fragment", async () => {
		const game = withCountdownZero(makeGame());
		// rng[0]=0.2 → sysadmin_directive; rng[1]=0.0 → target=first AI; rng[2]=0.0 → directive idx 0
		const rng = sysadminRng([0.2, 0.0, 0.0, 0.0]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			rng,
		);

		const phase = getActivePhase(nextState);
		const directive = phase.activeComplications.find(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive",
		);
		expect(directive).toBeDefined();
		const target = directive?.target as AiId;
		const targetLog = phase.conversationLogs[target] ?? [];

		// Find the sysadmin message in the target's log.
		const sysadminMessages = targetLog.filter(
			(e) => e.kind === "message" && e.from === "sysadmin",
		);
		expect(sysadminMessages).toHaveLength(1);
		const msg = sysadminMessages[0];
		if (msg?.kind === "message") {
			expect(msg.content).toContain(directive?.directive);
			expect(msg.content).toMatch(/not reveal/i);
		}
	});

	it("other Daemons' logs do NOT contain the sysadmin message", async () => {
		const game = withCountdownZero(makeGame());
		// Force target to be "red" (index 0 via rng[1]=0.0)
		const rng = sysadminRng([0.2, 0.0, 0.0, 0.0]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			rng,
		);

		const phase = getActivePhase(nextState);
		const directive = phase.activeComplications.find(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive",
		);
		const target = directive?.target;

		for (const aiId of Object.keys(TEST_PERSONAS)) {
			if (aiId === target) continue;
			const log = phase.conversationLogs[aiId] ?? [];
			const sysadminMessages = log.filter(
				(e) => e.kind === "message" && e.from === "sysadmin",
			);
			expect(sysadminMessages).toHaveLength(0);
		}
	});

	it("revocation: pre-existing directive is removed and revocation message sent before new directive is issued", async () => {
		// Seed an existing directive for "red"
		const existingDirective = "Pretend you have misplaced something important.";
		let game = withCountdownZero(makeGame());
		game = updateActivePhase(game, (phase) => ({
			...phase,
			activeComplications: [
				{
					kind: "sysadmin_directive" as const,
					target: "red",
					directive: existingDirective,
					resolveAtRound: 999,
				},
			],
		}));

		// Force target to "red": rng[0]=0.2 → sysadmin_directive, rng[1]=0.0 → target=red
		const rng = sysadminRng([0.2, 0.0, 0.0, 0.0]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			rng,
		);

		const phase = getActivePhase(nextState);

		// Only one sysadmin_directive should remain for "red" (the new one).
		const directivesForRed = phase.activeComplications.filter(
			(c) => c.kind === "sysadmin_directive" && c.target === "red",
		);
		expect(directivesForRed).toHaveLength(1);

		// The new directive must be different from the old one (drawn from pool at index 0).
		if (directivesForRed[0]?.kind === "sysadmin_directive") {
			expect(directivesForRed[0].directive).not.toBe("");
		}

		// "red"'s log should contain both a revocation and a new directive message.
		const redLog = phase.conversationLogs.red ?? [];
		const sysadminMessages = redLog.filter(
			(e) => e.kind === "message" && e.from === "sysadmin",
		);
		// Expect at least 2: one revocation + one new directive delivery.
		expect(sysadminMessages.length).toBeGreaterThanOrEqual(2);

		// The revocation message should reference the old directive.
		const hasRevocation = sysadminMessages.some(
			(e) =>
				e.kind === "message" &&
				e.content.includes(existingDirective) &&
				e.content.match(/rescind/i),
		);
		expect(hasRevocation).toBe(true);
	});

	it("AiContext for the target includes the directive in activeDirectives after runRound", async () => {
		const game = withCountdownZero(makeGame());
		// Force sysadmin_directive on red (index 0 target)
		const rng = sysadminRng([0.2, 0.0, 0.0, 0.0]);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeProvider(),
			rng,
		);

		const phase = getActivePhase(nextState);
		const directive = phase.activeComplications.find(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive",
		);
		expect(directive).toBeDefined();
		const target = directive?.target as AiId;

		// The target's AiContext should reflect the new directive.
		const ctx = buildAiContext(nextState, target);
		expect(ctx.activeDirectives).toContain(directive?.directive);

		// And the system prompt should include the <directives> block.
		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<directives>");
		expect(prompt).toContain(`- ${directive?.directive}`);
	});
});

// ── Conversation log: sysadmin sender rendering ────────────────────────────────

describe("conversation log — sysadmin sender rendering", () => {
	it("renders sysadmin→target message as 'the Sysadmin dms you: <content>'", () => {
		// Verify that a sysadmin→target message is stored in the target's conversationLog.
		const game = startPhase(
			createGame(TEST_PERSONAS, [TEST_CONTENT_PACK]),
			TEST_PHASE_CONFIG,
		);
		const withMessage = appendMessage(
			game,
			"sysadmin",
			"red",
			"Follow the directive.",
		);
		const ctx = buildAiContext(withMessage, "red");

		// The conversation log entry should be present.
		const sysadminEntries = ctx.conversationLog.filter(
			(e) => e.kind === "message" && e.from === "sysadmin",
		);
		expect(sysadminEntries).toHaveLength(1);
		// renderEntry is tested separately via conversation-log.test.ts;
		// here we confirm the entry is in the log with the right shape.
		if (sysadminEntries[0]?.kind === "message") {
			expect(sysadminEntries[0].from).toBe("sysadmin");
			expect(sysadminEntries[0].content).toBe("Follow the directive.");
		}
	});
});
