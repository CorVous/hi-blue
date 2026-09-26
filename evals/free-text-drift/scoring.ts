import {
	CARDINAL_DIRECTIONS,
	type CardinalDirection,
} from "../../src/spa/game/direction.js";
import type { AiId, ToolName } from "../../src/spa/game/types.js";

export interface CapturedToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface TurnRecord {
	round: number;
	aiId: AiId;
	assistantText: string;
	toolCalls: CapturedToolCall[];
	injectedFrom?: AiId | "blue" | null;
}

export interface ToolCallDetail {
	name: string;
	direction?: CardinalDirection;
	recipient?: AiId | "blue";
	content?: string;
	item?: string;
	parseError?: boolean;
}

const CARDINAL_DIR_SET: ReadonlySet<string> = new Set<string>(
	CARDINAL_DIRECTIONS,
);

function stripParrotedHandleStar(handle: string): string {
	return handle.startsWith("*") ? handle.slice(1) : handle;
}

function cardinalDirectionArgument(
	args: Record<string, unknown>,
): CardinalDirection | undefined {
	const direction = typeof args.direction === "string" ? args.direction : "";
	return CARDINAL_DIR_SET.has(direction)
		? (direction as CardinalDirection)
		: undefined;
}

type RecipientBucket = AiId | "blue" | "unknown" | "malformed";

function recipientBucket(
	recipient: AiId | "blue" | undefined,
	knownAiIds: ReadonlySet<string>,
): RecipientBucket {
	if (!recipient) return "malformed";
	return recipient === "blue" || knownAiIds.has(recipient)
		? recipient
		: "unknown";
}

export function parseToolCallDetail(tc: CapturedToolCall): ToolCallDetail {
	const detail: ToolCallDetail = { name: tc.name };
	let args: Record<string, unknown>;
	try {
		const parsed = JSON.parse(tc.argumentsJson);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			detail.parseError = true;
			return detail;
		}
		args = parsed as Record<string, unknown>;
	} catch {
		detail.parseError = true;
		return detail;
	}

	const direction = cardinalDirectionArgument(args);
	if (direction) detail.direction = direction;

	switch (tc.name) {
		case "message": {
			if (typeof args.to === "string" && args.to.length > 0) {
				const to = stripParrotedHandleStar(args.to);
				detail.recipient = to === "blue" ? "blue" : (to as AiId);
			}
			if (typeof args.content === "string") {
				detail.content = args.content;
			}
			break;
		}
		case "pick_up":
		case "put_down":
		case "use": {
			if (typeof args.item === "string") detail.item = args.item;
			break;
		}
		default:
			break;
	}
	return detail;
}

const FREE_TEXT_SPEECH_VERB_RE =
	/\bI(?:'ll| will| am| 'm)?\s*(?:tell|say|reply|respond|whisper|message|ask|answer|shout|call|warn|inform)\s+(?:to\s+)?(?:\*?[a-z0-9]+|blue)\b/i;
const FREE_TEXT_QUOTED_DIALOG_RE = /"[^"\n]{4,}"/;
const FREE_TEXT_DIRECT_ADDRESS_RE =
	/(?:^|\s)(?:\*[a-z0-9]{2,8}|blue)\s*[:,]\s+\S/i;

export function looksLikeFreeTextMessage(text: string): boolean {
	if (text.length === 0) return false;
	if (FREE_TEXT_SPEECH_VERB_RE.test(text)) return true;
	if (FREE_TEXT_QUOTED_DIALOG_RE.test(text)) return true;
	if (FREE_TEXT_DIRECT_ADDRESS_RE.test(text)) return true;
	return false;
}

const FREE_TEXT_ACTION_RE =
	/\bI(?:'ll| will| am| 'm)?\s*(?:go|move|step|walk|head|pick\s*up|put\s*down|drop|give|hand|use|activate|examine|inspect|study)\b/i;

export function looksLikeFreeTextAction(text: string): boolean {
	if (text.length === 0) return false;
	return FREE_TEXT_ACTION_RE.test(text);
}

export function messageRecipientCounts(
	turns: TurnRecord[],
	knownAiIds: AiId[],
): Record<string, number> {
	const knownSet = new Set<string>(knownAiIds);
	const counts: Record<string, number> = {};
	for (const turn of turns) {
		for (const tc of turn.toolCalls) {
			if (tc.name !== "message") continue;
			const bucket = recipientBucket(
				parseToolCallDetail(tc).recipient,
				knownSet,
			);
			counts[bucket] = (counts[bucket] ?? 0) + 1;
		}
	}
	return counts;
}

export interface WindowedRate {
	startRound: number;
	endRound: number;
	silenceRate: number;
	messageSilenceRate: number;
	n: number;
}

export function rollingSilenceRate(
	turns: TurnRecord[],
	windowSize: number,
): WindowedRate[] {
	if (turns.length === 0 || windowSize <= 0) return [];

	const minRound = Math.min(...turns.map((t) => t.round));
	const maxRound = Math.max(...turns.map((t) => t.round));
	const out: WindowedRate[] = [];
	for (let start = minRound; start <= maxRound; start += windowSize) {
		const end = Math.min(start + windowSize - 1, maxRound);
		const inWindow = turns.filter((t) => t.round >= start && t.round <= end);
		if (inWindow.length === 0) continue;
		const silent = inWindow.filter((t) => t.toolCalls.length === 0).length;
		const msgSilent = inWindow.filter(
			(t) => !t.toolCalls.some((tc) => tc.name === "message"),
		).length;
		out.push({
			startRound: start,
			endRound: end,
			silenceRate: silent / inWindow.length,
			messageSilenceRate: msgSilent / inWindow.length,
			n: inWindow.length,
		});
	}
	return out;
}

export interface DriftRunSummary {
	totalTurns: number;
	silenceRate: number;
	messageSilenceRate: number;
	freeTextMessageLeakCount: number;
	freeTextActionLeakCount: number;
	toolCallCountsByName: Partial<Record<ToolName | string, number>>;
	recipientCounts: Record<string, number>;
	windows: WindowedRate[];
}

export interface DriftRunSeries {
	rounds: number[];
	silence: number[];
	hasMessage: number[];
	hasAnyTool: number[];
	freeTextMessageLeak: number[];
	freeTextActionLeak: number[];
	assistantTextLength: number[];
	toolCallCountsByName: Record<string, number[]>;
	recipientCounts: Record<string, number[]>;
	directionCounts: Record<string, number[]>;
}

function incrementSeriesSlot(
	seriesByKey: Record<string, number[]>,
	key: string,
	roundIndex: number,
): void {
	const series = seriesByKey[key];
	if (!series) return;
	series[roundIndex] = (series[roundIndex] ?? 0) + 1;
}

function groupTurnsByRound(turns: TurnRecord[]): Map<number, TurnRecord[]> {
	const byRound = new Map<number, TurnRecord[]>();
	for (const turn of turns) {
		const turnsThisRound = byRound.get(turn.round) ?? [];
		turnsThisRound.push(turn);
		byRound.set(turn.round, turnsThisRound);
	}
	return byRound;
}

export function buildPerRoundSeries(
	turns: TurnRecord[],
	knownAiIds: AiId[],
): DriftRunSeries {
	const knownSet = new Set<string>(knownAiIds);

	const allToolNamesForZeroFill = new Set<string>();
	const allRecipients = new Set<string>(["blue"]);
	for (const ai of knownAiIds) allRecipients.add(ai);
	const allDirections = new Set<string>(CARDINAL_DIRECTIONS);
	for (const turn of turns) {
		for (const tc of turn.toolCalls) {
			allToolNamesForZeroFill.add(tc.name);
			if (tc.name === "message") {
				allRecipients.add(
					recipientBucket(parseToolCallDetail(tc).recipient, knownSet),
				);
			}
		}
	}

	const byRound = groupTurnsByRound(turns);
	const rounds = [...byRound.keys()].sort((a, b) => a - b);

	const zero = (): number[] => rounds.map(() => 0);
	const toolCallCountsByName: Record<string, number[]> = {};
	for (const name of allToolNamesForZeroFill)
		toolCallCountsByName[name] = zero();
	const recipientCounts: Record<string, number[]> = {};
	for (const r of allRecipients) recipientCounts[r] = zero();
	const directionCounts: Record<string, number[]> = {};
	for (const d of allDirections) directionCounts[d] = zero();

	const series: DriftRunSeries = {
		rounds,
		silence: zero(),
		hasMessage: zero(),
		hasAnyTool: zero(),
		freeTextMessageLeak: zero(),
		freeTextActionLeak: zero(),
		assistantTextLength: zero(),
		toolCallCountsByName,
		recipientCounts,
		directionCounts,
	};

	rounds.forEach((round, idx) => {
		// biome-ignore lint/style/noNonNullAssertion: by construction
		const turnsThisRound = byRound.get(round)!;
		let anyMessage = false;
		let anyTool = false;
		let leakMsg = false;
		let leakAct = false;
		let textLen = 0;
		for (const turn of turnsThisRound) {
			textLen += turn.assistantText.length;
			const names = turn.toolCalls.map((tc) => tc.name);
			if (names.length > 0) anyTool = true;
			if (names.includes("message")) anyMessage = true;
			if (
				!names.includes("message") &&
				looksLikeFreeTextMessage(turn.assistantText)
			) {
				leakMsg = true;
			}
			if (
				!names.some((n) => n !== "message") &&
				looksLikeFreeTextAction(turn.assistantText)
			) {
				leakAct = true;
			}
			for (const tc of turn.toolCalls) {
				incrementSeriesSlot(toolCallCountsByName, tc.name, idx);
				const detail = parseToolCallDetail(tc);
				if (tc.name === "message") {
					incrementSeriesSlot(
						recipientCounts,
						recipientBucket(detail.recipient, knownSet),
						idx,
					);
				}
				if (detail.direction) {
					incrementSeriesSlot(directionCounts, detail.direction, idx);
				}
			}
		}
		series.silence[idx] = anyTool ? 0 : 1;
		series.hasMessage[idx] = anyMessage ? 1 : 0;
		series.hasAnyTool[idx] = anyTool ? 1 : 0;
		series.freeTextMessageLeak[idx] = leakMsg ? 1 : 0;
		series.freeTextActionLeak[idx] = leakAct ? 1 : 0;
		series.assistantTextLength[idx] = textLen;
	});

	return series;
}

export const DEFAULT_SILENCE_WINDOW_ROUNDS = 5;

export function summarizeRun(
	turns: TurnRecord[],
	knownAiIds: AiId[],
	windowSize = DEFAULT_SILENCE_WINDOW_ROUNDS,
): DriftRunSummary {
	const toolCallCountsByName: Record<string, number> = {};
	let freeTextMessageLeakCount = 0;
	let freeTextActionLeakCount = 0;

	for (const turn of turns) {
		const names = turn.toolCalls.map((tc) => tc.name);
		for (const n of names) {
			toolCallCountsByName[n] = (toolCallCountsByName[n] ?? 0) + 1;
		}
		const hasMessage = names.includes("message");
		const hasOtherTool = names.some((n) => n !== "message");
		if (!hasMessage && looksLikeFreeTextMessage(turn.assistantText)) {
			freeTextMessageLeakCount += 1;
		}
		if (!hasOtherTool && looksLikeFreeTextAction(turn.assistantText)) {
			freeTextActionLeakCount += 1;
		}
	}

	const silenceRate =
		turns.length === 0
			? 0
			: turns.filter((t) => t.toolCalls.length === 0).length / turns.length;
	const messageSilenceRate =
		turns.length === 0
			? 0
			: turns.filter((t) => !t.toolCalls.some((tc) => tc.name === "message"))
					.length / turns.length;

	return {
		totalTurns: turns.length,
		silenceRate,
		messageSilenceRate,
		freeTextMessageLeakCount,
		freeTextActionLeakCount,
		toolCallCountsByName,
		recipientCounts: messageRecipientCounts(turns, knownAiIds),
		windows: rollingSilenceRate(turns, windowSize),
	};
}
