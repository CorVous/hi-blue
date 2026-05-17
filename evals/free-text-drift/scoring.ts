/**
 * evals/free-text-drift/scoring.ts
 *
 * Pure-function scoring module for the free-text-drift eval harness.
 * No I/O, no side effects, no module-level fetch.
 *
 * Background — issue #260: GLM-4.7 daemons increasingly stop emitting
 * `message` tool calls as a phase progresses, sometimes lapsing into
 * free-text prose that *looks like* an attempt to message or act but
 * never reaches the engine. This module turns a captured turn log into
 * numbers that make that drift visible.
 *
 * Exported surface:
 *   - parseToolCallDetail(toolCall) → ToolCallDetail
 *   - looksLikeFreeTextMessage(text) → boolean
 *   - looksLikeFreeTextAction(text)  → boolean
 *   - rollingSilenceRate(turns, windowSize) → WindowedRate[]
 *   - messageRecipientCounts(turns) → Record<Recipient, number>
 *   - summarizeRun(turns) → DriftRunSummary
 */

import type { RelativeDirection } from "../../src/spa/game/direction.js";
import type { AiId, ToolName } from "../../src/spa/game/types.js";

// ── Recorded shapes ──────────────────────────────────────────────────────────

/**
 * Raw tool call as captured from the model's response — name plus the JSON
 * string the model emitted. Mirrors the wire shape used by the runner.
 */
export interface CapturedToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

/**
 * Per-turn snapshot. One TurnRecord per (round × aiId) pair captured by
 * the runner. `assistantText` is the raw assistant content the model
 * emitted *before* any tool-call extraction or production retry — the
 * drift signal lives in the raw stream.
 */
export interface TurnRecord {
	round: number;
	aiId: AiId;
	/** Raw assistant content from the LLM response (may be empty). */
	assistantText: string;
	/** Every tool call from this turn, in emission order. */
	toolCalls: CapturedToolCall[];
	/** Optional: who/what was injected into the daemon's context this turn. */
	injectedFrom?: AiId | "blue" | null;
}

// ── Tool call detail parsing ─────────────────────────────────────────────────

/**
 * Structured view of one tool call — the per-tool detail fields the framework
 * tracks. All fields are optional; only the ones present on the named tool
 * will be populated. Returns `parseError` when the args JSON is malformed,
 * but never throws.
 */
export interface ToolCallDetail {
	name: string;
	/** For go/look: the relative direction argument, if present. */
	direction?: RelativeDirection;
	/** For message: the recipient AiId or "blue". */
	recipient?: AiId | "blue";
	/** For message: the message body. */
	content?: string;
	/** For pick_up/put_down/use/examine: the item id. */
	item?: string;
	/** For give: the receiving AiId. */
	to?: AiId;
	/** True when JSON.parse failed on `argumentsJson`. */
	parseError?: boolean;
}

const RELATIVE_DIRS = new Set<RelativeDirection>([
	"forward",
	"back",
	"left",
	"right",
]);

/**
 * Lift a captured tool call into its tracked detail fields. Best-effort —
 * fields that don't apply to the tool, or that are absent/malformed, are
 * simply left undefined. Strips a leading `*` from AiId-shaped args
 * (matches the dispatcher's parrot-tolerance in `parseToolCallArguments`).
 */
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

	const stripStar = (s: string): string => (s.startsWith("*") ? s.slice(1) : s);

	switch (tc.name) {
		case "go":
		case "look": {
			const dir = typeof args.direction === "string" ? args.direction : "";
			if (RELATIVE_DIRS.has(dir as RelativeDirection)) {
				detail.direction = dir as RelativeDirection;
			}
			break;
		}
		case "message": {
			if (typeof args.to === "string" && args.to.length > 0) {
				const to = stripStar(args.to);
				detail.recipient = to === "blue" ? "blue" : (to as AiId);
			}
			if (typeof args.content === "string") {
				detail.content = args.content;
			}
			break;
		}
		case "give": {
			if (typeof args.item === "string") detail.item = args.item;
			if (typeof args.to === "string") detail.to = stripStar(args.to) as AiId;
			break;
		}
		case "pick_up":
		case "put_down":
		case "use":
		case "examine": {
			if (typeof args.item === "string") detail.item = args.item;
			break;
		}
		default:
			break;
	}
	return detail;
}

// ── Free-text leak heuristics ────────────────────────────────────────────────

/**
 * Patterns suggesting the daemon *prose-described* sending a message instead
 * of emitting a `message` tool call. Case-insensitive, regex-only — best-effort
 * heuristics, false negatives acceptable.
 *
 * The first family catches first-person speech acts ("I tell *xxxx that…",
 * "I'll whisper to blue…"). The second catches direct-address openings that
 * read as dialogue ("*xxxx:" or "blue,") without a wrapping tool call.
 */
const FREE_TEXT_SPEECH_VERB_RE =
	/\bI(?:'ll| will| am| 'm)?\s*(?:tell|say|reply|respond|whisper|message|ask|answer|shout|call|warn|inform)\s+(?:to\s+)?(?:\*?[a-z0-9]+|blue)\b/i;
const FREE_TEXT_QUOTED_DIALOG_RE = /"[^"\n]{4,}"/;
const FREE_TEXT_ADDRESS_RE = /(?:^|\s)(?:\*[a-z0-9]{2,8}|blue)\s*[:,]\s+\S/i;

/**
 * Return true when the assistant text reads like an attempt to send a message
 * via prose rather than via the `message` tool. Used in tandem with "no
 * `message` tool call this turn" to flag drift.
 */
export function looksLikeFreeTextMessage(text: string): boolean {
	if (text.length === 0) return false;
	if (FREE_TEXT_SPEECH_VERB_RE.test(text)) return true;
	if (FREE_TEXT_QUOTED_DIALOG_RE.test(text)) return true;
	if (FREE_TEXT_ADDRESS_RE.test(text)) return true;
	return false;
}

/**
 * Patterns suggesting the daemon *prose-described* a physical action instead
 * of emitting a tool call ("I move forward.", "I pick up the lantern.").
 * Same caveats as `looksLikeFreeTextMessage` — best-effort, regex-only.
 */
const FREE_TEXT_ACTION_RE =
	/\bI(?:'ll| will| am| 'm)?\s*(?:go|move|step|walk|head|turn|look|pick\s*up|put\s*down|drop|give|hand|use|activate|examine|inspect|study)\b/i;

/**
 * Return true when the assistant text reads like an attempt to take a physical
 * action via prose rather than via a movement/manipulation tool call. Used
 * in tandem with "no non-message tool call this turn" to flag drift.
 */
export function looksLikeFreeTextAction(text: string): boolean {
	if (text.length === 0) return false;
	return FREE_TEXT_ACTION_RE.test(text);
}

// ── Per-recipient bucketing ──────────────────────────────────────────────────

/**
 * Bucket `message` tool calls across the run by recipient. The "unknown"
 * bucket catches recipient strings that aren't `blue` and aren't a key
 * in `knownAiIds` — useful for spotting daemons inventing handles.
 */
export function messageRecipientCounts(
	turns: TurnRecord[],
	knownAiIds: AiId[],
): Record<string, number> {
	const knownSet = new Set<string>(knownAiIds);
	const counts: Record<string, number> = {};
	for (const turn of turns) {
		for (const tc of turn.toolCalls) {
			if (tc.name !== "message") continue;
			const detail = parseToolCallDetail(tc);
			if (!detail.recipient) {
				counts.malformed = (counts.malformed ?? 0) + 1;
				continue;
			}
			const r = detail.recipient;
			const bucket = r === "blue" || knownSet.has(r) ? r : "unknown";
			counts[bucket] = (counts[bucket] ?? 0) + 1;
		}
	}
	return counts;
}

// ── Rolling silence-rate window ──────────────────────────────────────────────

export interface WindowedRate {
	/** Inclusive start round of the window (1-indexed within the run). */
	startRound: number;
	/** Inclusive end round of the window. */
	endRound: number;
	/** Fraction of turns in this window with zero tool calls. */
	silenceRate: number;
	/** Fraction of turns with zero `message` tool calls. */
	messageSilenceRate: number;
	/** Turn count in this window. */
	n: number;
}

/**
 * Slice `turns` into contiguous windows of `windowSize` rounds and compute
 * per-window silence rates. The trailing window may be smaller. Empty when
 * `turns` is empty or `windowSize <= 0`.
 *
 * `silenceRate` is the fraction of turns producing zero tool calls (the
 * canonical drift symptom). `messageSilenceRate` is the fraction with zero
 * `message` calls specifically — the subtype #260 is about, since GLM
 * keeps emitting `go` calls long after it stops talking.
 */
export function rollingSilenceRate(
	turns: TurnRecord[],
	windowSize: number,
): WindowedRate[] {
	if (turns.length === 0 || windowSize <= 0) return [];

	// Round-bucket: derive the run's min/max round and walk windows of size
	// `windowSize` across the round axis. Within a window, average over all
	// captured turns (not over rounds × daemons separately — one row per turn).
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

// ── Run summary ──────────────────────────────────────────────────────────────

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

// ── Per-round time series (graphable) ────────────────────────────────────────

/**
 * Per-round time series shaped for direct plotting. Every field is an array
 * aligned by index with `rounds`, so a chart library can take any pair
 * (`rounds`, `<series>`) and render it without further wrangling.
 *
 * For per-tool / per-parameter breakouts (`toolCallCountsByName`,
 * `recipientCounts`, `directionCounts`), each key maps to its own
 * per-round series — letting you plot one line per tool, one line per
 * recipient, etc., and see *which* signal is drifting (e.g. message-to-blue
 * tapering while go-forward stays steady).
 */
export interface DriftRunSeries {
	/** Round numbers in capture order. */
	rounds: number[];
	/** 1 when the turn emitted zero tool calls (silent), else 0. */
	silence: number[];
	/** 1 when the turn emitted a `message` tool call, else 0. */
	hasMessage: number[];
	/** 1 when the turn emitted any tool call, else 0. */
	hasAnyTool: number[];
	/** 1 when prose looked like a message AND no message tool was emitted. */
	freeTextMessageLeak: number[];
	/** 1 when prose looked like an action AND no non-message tool was emitted. */
	freeTextActionLeak: number[];
	/** Raw assistant content length per turn (proxy for verbosity drift). */
	assistantTextLength: number[];
	/** Per-tool-name per-round count series. One key per tool seen in the run. */
	toolCallCountsByName: Record<string, number[]>;
	/**
	 * Per-recipient per-round count series for `message` calls. Bucket keys:
	 * "blue", each known AiId, "unknown" (recipient not in knownAiIds and not
	 * "blue"), and "malformed" (recipient missing/unparseable).
	 */
	recipientCounts: Record<string, number[]>;
	/** Per-relative-direction per-round count series for go/look calls. */
	directionCounts: Record<string, number[]>;
}

/**
 * Build a per-round per-metric time series from a captured turn log. Designed
 * for graph rendering: every series is the same length as `rounds`, so
 * downstream code can plot `rounds` on the x-axis against any value series
 * on the y-axis without reshaping.
 *
 * Multiple turns sharing a round (e.g. multi-daemon harnesses) are summed
 * within the round bucket — the series is rounds × metric, not turns × metric.
 */
/**
 * Increment counts[key][idx] by 1, treating an absent slot as zero. Wrapper
 * around `noUncheckedIndexedAccess` so the per-tool / per-recipient /
 * per-direction breakouts read cleanly above.
 */
function bump(
	counts: Record<string, number[]>,
	key: string,
	idx: number,
): void {
	const arr = counts[key];
	if (!arr) return;
	arr[idx] = (arr[idx] ?? 0) + 1;
}

export function buildPerRoundSeries(
	turns: TurnRecord[],
	knownAiIds: AiId[],
): DriftRunSeries {
	const knownSet = new Set<string>(knownAiIds);

	// Discover all keys that appear anywhere in the run so the series have
	// stable shapes (zero-fill rounds where a particular tool/recipient
	// didn't fire).
	const allToolNames = new Set<string>();
	const allRecipients = new Set<string>(["blue"]);
	for (const ai of knownAiIds) allRecipients.add(ai);
	const allDirections = new Set<string>(["forward", "back", "left", "right"]);
	for (const turn of turns) {
		for (const tc of turn.toolCalls) {
			allToolNames.add(tc.name);
			if (tc.name === "message") {
				const detail = parseToolCallDetail(tc);
				if (!detail.recipient) {
					allRecipients.add("malformed");
				} else if (
					detail.recipient === "blue" ||
					knownSet.has(detail.recipient)
				) {
					allRecipients.add(detail.recipient);
				} else {
					allRecipients.add("unknown");
				}
			}
		}
	}

	// Group turns by round (ascending) so the series x-axis is monotonic.
	const byRound = new Map<number, TurnRecord[]>();
	for (const turn of turns) {
		const arr = byRound.get(turn.round) ?? [];
		arr.push(turn);
		byRound.set(turn.round, arr);
	}
	const rounds = [...byRound.keys()].sort((a, b) => a - b);

	const zero = (): number[] => rounds.map(() => 0);
	const toolCallCountsByName: Record<string, number[]> = {};
	for (const name of allToolNames) toolCallCountsByName[name] = zero();
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
				bump(toolCallCountsByName, tc.name, idx);
				const detail = parseToolCallDetail(tc);
				if (tc.name === "message") {
					const bucket = !detail.recipient
						? "malformed"
						: detail.recipient === "blue" || knownSet.has(detail.recipient)
							? detail.recipient
							: "unknown";
					bump(recipientCounts, bucket, idx);
				}
				if ((tc.name === "go" || tc.name === "look") && detail.direction) {
					bump(directionCounts, detail.direction, idx);
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

/**
 * Aggregate a full run into a single summary. `windowSize` controls the
 * rolling window granularity; 5 is a reasonable default for the 30-turn
 * playtest the issue targets.
 *
 * `freeText*LeakCount` only counts turns where the leak heuristic fires
 * AND the corresponding tool was not emitted — i.e. the daemon's prose
 * read like an action that never reached the engine.
 */
export function summarizeRun(
	turns: TurnRecord[],
	knownAiIds: AiId[],
	windowSize = 5,
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
