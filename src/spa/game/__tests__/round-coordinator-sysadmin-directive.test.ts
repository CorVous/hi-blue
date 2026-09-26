import { describe, expect, it } from "vitest";
import { appendMessage } from "../engine";
import { buildAiContext } from "../prompt-builder";
import { runRound } from "../round-coordinator";
import type { AiId } from "../types";
import {
	makeSilentProvider,
	makeTestGame,
	ROW_AI_STARTS,
	seededRng,
	TEST_PERSONAS,
	withCountdownZero,
} from "./fixtures/make-game-state";

function makeGame() {
	return makeTestGame({ pack: { aiStarts: ROW_AI_STARTS } });
}

const DRAW_SYSADMIN_DIRECTIVE_KIND = 0.2;
const DRAW_FIRST_TARGET = 0.0;
const DRAW_FIRST_DIRECTIVE_TEXT = 0.0;
const DRAW_MIN_COUNTDOWN = 0.0;
const FIRST_DIRECTIVE_TO_RED_DRAWS = [
	DRAW_SYSADMIN_DIRECTIVE_KIND,
	DRAW_FIRST_TARGET,
	DRAW_FIRST_DIRECTIVE_TEXT,
	DRAW_MIN_COUNTDOWN,
];

describe("runRound — sysadmin_directive complication", () => {
	it("activeComplications contains exactly one sysadmin_directive with non-empty directive text", async () => {
		const game = withCountdownZero(makeGame());
		const rng = seededRng(FIRST_DIRECTIVE_TO_RED_DRAWS, () => 0);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng,
			},
		);

		const phase = nextState;
		const directives = phase.activeComplications.filter(
			(c) => c.kind === "sysadmin_directive",
		);
		expect(directives).toHaveLength(1);
		const directive = directives[0];
		expect(directive?.kind).toBe("sysadmin_directive");
		if (directive?.kind === "sysadmin_directive") {
			expect(directive.directive).not.toBe("");
			expect(directive.directive).toMatch(/./);
		}
	});

	it("target Daemon's conversationLog contains a sysadmin message with directive text and secrecy fragment", async () => {
		const game = withCountdownZero(makeGame());
		const rng = seededRng(FIRST_DIRECTIVE_TO_RED_DRAWS, () => 0);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng,
			},
		);

		const phase = nextState;
		const directive = phase.activeComplications.find(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive",
		);
		expect(directive).toBeDefined();
		const target = directive?.target as AiId;
		const targetLog = phase.conversationLogs[target] ?? [];

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
		const rng = seededRng(FIRST_DIRECTIVE_TO_RED_DRAWS, () => 0);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng,
			},
		);

		const phase = nextState;
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
		const existingDirective = "Pretend you have misplaced something important.";
		const baseGame = withCountdownZero(makeGame());
		const game = {
			...baseGame,
			activeComplications: [
				{
					kind: "sysadmin_directive" as const,
					target: "red",
					directive: existingDirective,
					resolveAtRound: 999,
				},
			],
		};

		const rng = seededRng(FIRST_DIRECTIVE_TO_RED_DRAWS, () => 0);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng,
			},
		);

		const phase = nextState;

		const directivesForRed = phase.activeComplications.filter(
			(c) => c.kind === "sysadmin_directive" && c.target === "red",
		);
		expect(directivesForRed).toHaveLength(1);

		if (directivesForRed[0]?.kind === "sysadmin_directive") {
			expect(directivesForRed[0].directive).not.toBe("");
		}

		const redLog = phase.conversationLogs.red ?? [];
		const sysadminMessages = redLog.filter(
			(e) => e.kind === "message" && e.from === "sysadmin",
		);
		expect(sysadminMessages.length).toBeGreaterThanOrEqual(2);

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
		const rng = seededRng(FIRST_DIRECTIVE_TO_RED_DRAWS, () => 0);

		const { nextState } = await runRound(
			game,
			"red",
			"hi",
			makeSilentProvider(),
			{
				rng,
			},
		);

		const phase = nextState;
		const directive = phase.activeComplications.find(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive",
		);
		expect(directive).toBeDefined();
		const target = directive?.target as AiId;

		const ctx = buildAiContext(nextState, target);
		expect(ctx.activeDirectives).toContain(directive?.directive);

		const prompt = ctx.toSystemPrompt();
		expect(prompt).toContain("<directives>");
		expect(prompt).toContain(`- ${directive?.directive}`);
	});
});

describe("conversation log — sysadmin sender rendering", () => {
	it("renders sysadmin→target message as 'the Sysadmin dms you: <content>'", () => {
		const game = makeGame();
		const withMessage = appendMessage(
			game,
			"sysadmin",
			"red",
			"Follow the directive.",
		);
		const ctx = buildAiContext(withMessage, "red");

		const sysadminEntries = ctx.conversationLog.filter(
			(e) => e.kind === "message" && e.from === "sysadmin",
		);
		expect(sysadminEntries).toHaveLength(1);
		if (sysadminEntries[0]?.kind === "message") {
			expect(sysadminEntries[0].from).toBe("sysadmin");
			expect(sysadminEntries[0].content).toBe("Follow the directive.");
		}
	});
});
