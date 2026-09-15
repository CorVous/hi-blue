import { expect, type Page, type Request } from "@playwright/test";
import type { AiHandles } from "./handles.js";
import { getAiHandles } from "./handles.js";

/**
 * A factory function that produces word chunks for a `/v1/chat/completions`
 * response, optionally inspecting the intercepted request.  May be async.
 */
export type WordsFactory = (request: Request) => string[] | Promise<string[]>;

/**
 * Build a minimal OpenAI-compatible SSE body that streams the given word
 * chunks as delta content events, followed by a [DONE] sentinel.
 *
 * Wire format mirrors what src/proxy/openai-proxy.ts forwards from OpenRouter:
 *   data: {"choices":[{"delta":{"content":"<text>"},"finish_reason":null}]}\n\n
 *   data: [DONE]\n\n
 *

/**
 * Build a minimal OpenAI-compatible SSE body that emits a single `message`
 * tool-call addressed to "blue", carrying the joined `words` as its content.
 * This is the post-#214 wire shape that lands in panel transcripts: panels
 * render only entries written into conversationLogs by the `message` tool.
 *
 * Includes a final usage chunk so the budget-deduction path sees a non-zero
 * cost. Mirrors `makeMessageToolCallSseStream` from `src/spa/__tests__/game.test.ts`.
 */
function messageToolCallToBlueSseBody(words: string[]): string {
	const args = JSON.stringify({ to: "blue", content: words.join("") });
	const headerChunk = `data: ${JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_msg",
							function: { name: "message", arguments: "" },
						},
					],
				},
			},
		],
	})}\n\n`;
	const argsChunk = `data: ${JSON.stringify({
		choices: [
			{
				delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
				finish_reason: "tool_calls",
			},
		],
	})}\n\n`;
	const usageChunk = `data: ${JSON.stringify({ choices: [], usage: { cost: 0.01, total_tokens: 100 } })}\n\n`;
	return `${headerChunk}${argsChunk}${usageChunk}data: [DONE]\n\n`;
}

// ── Pure helpers (request classification + canned responses) ─────────────────

export type ParsedBody = {
	stream?: boolean;
	response_format?: unknown;
	messages?: Array<{ role?: string; content?: string }>;
} | null;

/** True when a request is an OpenAI JSON-mode (non-streaming) call. */
function isJsonModeRequest(body: ParsedBody): boolean {
	return (
		body !== null && (body.stream === false || body.response_format != null)
	);
}

/**
 * Classify a JSON-mode request by its user-message preamble. Callers fire
 * JSON-mode `/v1/chat/completions` at game start:
 *   - persona synthesis (`Synthesize blurbs for these personas:` …)
 *   - dual content-pack generation (`Generate a dual A/B content pack for:` …)
 *   - single content-pack generation (`Generate a content pack for:` …)
 *
 * Returns "unknown" for callers we don't recognise so future additions surface
 * loudly instead of silently receiving a persona-shaped reply.
 */
export function classifyJsonRequest(
	body: ParsedBody,
): "synthesis" | "dual-content-pack" | "content-pack" | "unknown" {
	const userMsg = body?.messages?.[1]?.content ?? "";
	if (userMsg.startsWith("Synthesize blurbs for these personas:"))
		return "synthesis";
	if (userMsg.startsWith("Generate a dual A/B content pack for:"))
		return "dual-content-pack";
	if (userMsg.startsWith("Generate a content pack for:")) return "content-pack";
	return "unknown";
}

/**
 * Extract persona ids from a synthesis user-message content string.
 * The synthesis user message format is: `id: "xxxx", temperaments: ...`
 * Ids are exactly 4 lowercase alphanumeric characters.
 */
function extractInputIds(content: string): string[] {
	return Array.from(
		content.matchAll(/id:\s*"([a-z0-9]{4})"/g),
		(m) => m[1] ?? "",
	).filter(Boolean);
}

/** Build a synthesis JSON-mode response body that echoes the input ids. */
function buildSynthesisResponseBody(
	body: ParsedBody,
	blurbFn: (id: string) => string,
): string {
	const ids = extractInputIds(body?.messages?.[1]?.content ?? "");
	const content = JSON.stringify({
		personas: ids.map((id) => ({
			id,
			blurb: blurbFn(id),
			voiceExamples: [
				`Stub voice 1 for ${id}.`,
				`Stub voice 2 for ${id}.`,
				`Stub voice 3 for ${id}.`,
			],
		})),
	});
	return JSON.stringify({ choices: [{ message: { content } }] });
}

// ── Binding-shaped content-pack stub helpers ─────────────────────────────────

type BindingSpec = {
	type: "carry" | "use_space" | "use_item" | "convergence";
	index: number;
};

type BindingContentPackSpec = {
	setting: string;
	bindings: BindingSpec[];
	obstacleCount: number;
};

type DualBindingContentPackSpec = {
	settingA: string;
	settingB: string;
	bindings: BindingSpec[];
	obstacleCount: number;
};

function parseBindingContentPackSpec(userMsg: string): BindingContentPackSpec {
	const settingMatch = /setting="([^"]*)"/.exec(userMsg);
	const setting = settingMatch?.[1] ?? "stub-setting";

	const bindingMatches = [
		...userMsg.matchAll(/Binding\s+(\d+)\s+\(([^)]+)\):/g),
	];
	const bindings: BindingSpec[] = bindingMatches.map((m) => ({
		index: Number(m[1]),
		type: m[2] as BindingSpec["type"],
	}));

	const obstacleIds = [...userMsg.matchAll(/obstacle id="([^"]+)"/g)];
	const obstacleCount = obstacleIds.length;

	return { setting, bindings, obstacleCount };
}

function parseDualBindingContentPackSpec(
	userMsg: string,
): DualBindingContentPackSpec {
	const settingAMatch = /settingA="([^"]*)"/.exec(userMsg);
	const settingBMatch = /settingB="([^"]*)"/.exec(userMsg);
	const settingA = settingAMatch?.[1] ?? "stub-setting-a";
	const settingB = settingBMatch?.[1] ?? "stub-setting-b";

	const bindingMatches = [
		...userMsg.matchAll(/Binding\s+(\d+)\s+\(([^)]+)\):/g),
	];
	const bindings: BindingSpec[] = bindingMatches.map((m) => ({
		index: Number(m[1]),
		type: m[2] as BindingSpec["type"],
	}));

	const obstacleIds = [...userMsg.matchAll(/obstacle id="([^"]+)"/g)];
	const obstacleCount = obstacleIds.length;

	return { settingA, settingB, bindings, obstacleCount };
}

function buildBoundPack(
	setting: string,
	bindings: BindingSpec[],
	obstacleCount: number,
): object {
	const builtBindings = bindings.map((sk) => {
		const i = sk.index;
		switch (sk.type) {
			case "carry":
				return {
					id: `carry-${i}`,
					type: "carry",
					object: {
						id: `carry-${i}-obj`,
						name: `Stub carry object ${i}`,
						examineDescription: `A stub carry object; place it at the carry-${i}-space.`,
						useOutcome: "Nothing happens.",
						placementFlavor: "{actor} sets it down carefully.",
						proximityFlavor: "Something draws your attention nearby.",
					},
					space: {
						id: `carry-${i}-space`,
						name: `Stub carry space ${i}`,
						examineDescription: `A stub destination space, awaiting delivery.`,
						proximityFlavor: "A quiet pull draws you toward this area.",
					},
				};
			case "use_space":
				return {
					id: `useSpace-${i}`,
					type: "use_space",
					space: {
						id: `useSpace-${i}-space`,
						name: `Stub use-space ${i}`,
						examineDescription: `A stub interactive surface — use the lever to activate it.`,
						proximityFlavor: "An activatable surface beckons.",
						activationFlavor: "The surface hums as you engage the lever.",
						satisfactionFlavor: "The surface settles into completion.",
						postExamineDescription:
							"The surface sits dormant after activation.",
						postLookFlavor: "The surface rests, purpose fulfilled.",
					},
				};
			case "use_item":
				return {
					id: `useItem-${i}`,
					type: "use_item",
					item: {
						id: `useItem-${i}-item`,
						name: `Stub use-item ${i}`,
						examineDescription: `A stub item — press the button to activate.`,
						proximityFlavor: "The item draws your eye.",
						useOutcome: "Nothing changes.",
						activationFlavor:
							"The item clicks into action as you press the button.",
						postExamineDescription: "The item sits used and inert.",
						postLookFlavor: "The item rests, spent.",
					},
				};
			case "convergence":
				return {
					id: `convergence-${i}`,
					type: "convergence",
					space: {
						id: `convergence-${i}-space`,
						name: `Stub convergence space ${i}`,
						examineDescription: `A stub gathering point — a meeting place where two are needed.`,
						proximityFlavor: "The space seems to anticipate company.",
						convergenceTier1Flavor: `A presence lingers at the convergence space.`,
						convergenceTier2Flavor: `Two presences converge at the space.`,
						convergenceTier1ActorFlavor: `You stand alone; the space awaits another presence.`,
						convergenceTier2ActorFlavor: `You share this space with another presence.`,
					},
				};
			default:
				throw new Error(`Unknown binding type: ${sk.type}`);
		}
	});

	const decoys = [
		{
			id: "decoy-0",
			name: "Stub decoy A",
			examineDescription: "A harmless stub item.",
			proximityFlavor: "Something inert nearby.",
			useOutcome: "Nothing happens.",
		},
		{
			id: "decoy-1",
			name: "Stub decoy B",
			examineDescription: "Another harmless stub item.",
			proximityFlavor: "Something inert nearby.",
			useOutcome: "Nothing happens.",
		},
	];

	const obstacles = Array.from({ length: obstacleCount }, (_, i) => ({
		id: `obstacle-${i}`,
		name: `Stub obstacle ${i}`,
		examineDescription: `A stub obstacle.`,
		shiftFlavor: `The obstacle grinds across the floor.`,
	}));

	return {
		setting,
		wallName: "stub boundary wall",
		bindings: builtBindings,
		decoys,
		obstacles,
	};
}

function buildBoundContentPackResponseBody(body: ParsedBody): string {
	const userMsg = body?.messages?.[1]?.content ?? "";
	const spec = parseBindingContentPackSpec(userMsg);
	const pack = buildBoundPack(spec.setting, spec.bindings, spec.obstacleCount);
	const content = JSON.stringify({ pack });
	return JSON.stringify({ choices: [{ message: { content } }] });
}

function buildBoundDualContentPackResponseBody(body: ParsedBody): string {
	const userMsg = body?.messages?.[1]?.content ?? "";
	const spec = parseDualBindingContentPackSpec(userMsg);
	const packA = buildBoundPack(
		spec.settingA,
		spec.bindings,
		spec.obstacleCount,
	);
	const packB = buildBoundPack(
		spec.settingB,
		spec.bindings,
		spec.obstacleCount,
	);
	const content = JSON.stringify({ phases: [{ packA, packB }] });
	return JSON.stringify({ choices: [{ message: { content } }] });
}

/** Parse a request body as the OpenAI-ish shape these specs inspect. */
export function parseRequestBody(request: Request): ParsedBody {
	try {
		return JSON.parse(request.postData() ?? "null") as ParsedBody;
	} catch {
		return null;
	}
}

/**
 * Fulfill any JSON-mode `/v1/chat/completions` request with the appropriate
 * canned reply (synthesis or content-pack). Returns true if handled, false
 * if the request was not JSON-mode and the caller should handle it itself.
 *
 * Throws if the request is JSON-mode but unrecognised — silent persona-shaped
 * fallbacks were the bug this helper exists to prevent.
 */
async function tryFulfillJsonMode(
	route: Parameters<Parameters<Page["route"]>[1]>[0],
	body: ParsedBody,
	blurbFn: (id: string) => string,
): Promise<boolean> {
	if (!isJsonModeRequest(body)) return false;
	const kind = classifyJsonRequest(body);
	const responseBody =
		kind === "synthesis"
			? buildSynthesisResponseBody(body, blurbFn)
			: kind === "dual-content-pack"
				? buildBoundDualContentPackResponseBody(body)
				: kind === "content-pack"
					? buildBoundContentPackResponseBody(body)
					: null;
	if (responseBody === null) {
		throw new Error(
			`stubs.ts: unrecognised JSON-mode /v1/chat/completions caller. ` +
				`User message preamble: ${(body?.messages?.[1]?.content ?? "").slice(0, 80)}`,
		);
	}
	await route.fulfill({
		status: 200,
		headers: { "Content-Type": "application/json" },
		body: responseBody,
	});
	return true;
}

// ── Public stub helpers ──────────────────────────────────────────────────────

export type SynthesisStubOptions = {
	/** Generate a blurb for a given persona id. Defaults to `id => \`Stub blurb for ${id}.\`` */
	blurb?: (id: string) => string;
};

/**
 * Register a Playwright route stub that handles all JSON-mode
 * `/v1/chat/completions` calls fired at new-game time:
 *   - persona synthesis → echoes input ids with canned blurbs
 *   - content-pack generation → echoes input phase shapes with canned entities
 *
 * Non-JSON (SSE/streaming) requests are forwarded via `route.fallback()`.
 */
export async function stubPersonaSynthesis(
	page: Page,
	options?: SynthesisStubOptions,
): Promise<void> {
	const blurbFn = options?.blurb ?? ((id: string) => `Stub blurb for ${id}.`);
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (await tryFulfillJsonMode(route, body, blurbFn)) return;
		await route.fallback();
	});
}

export type NewGameLLMOptions = {
	sse: string[] | WordsFactory;
	synthesis?: SynthesisStubOptions;
};

/**
 * Combined stub that handles both the new-game JSON-mode calls (persona
 * synthesis and content-pack generation) and the gameplay SSE streaming
 * call in a single `page.route` registration.
 */
export async function stubNewGameLLM(
	page: Page,
	opts: NewGameLLMOptions,
): Promise<void> {
	const blurbFn =
		opts.synthesis?.blurb ?? ((id: string) => `Stub blurb for ${id}.`);
	const wordsOrFactory = opts.sse;

	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (await tryFulfillJsonMode(route, body, blurbFn)) return;

		// SSE path
		const words =
			typeof wordsOrFactory === "function"
				? await wordsOrFactory(request)
				: wordsOrFactory;
		await route.fulfill({
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			},
			body: messageToolCallToBlueSseBody(words),
		});
	});
}

/**
 * Register a Playwright route stub for the `/v1/chat/completions` endpoint
 * that responds with a synthetic streaming OpenAI SSE body.
 *
 * Also handles the new-game JSON-mode calls (persona synthesis and
 * content-pack generation) so existing specs work unmodified even when the
 * SPA fires the JSON-mode calls before the first SSE request.
 *
 * The SPA's `BrowserLLMProvider` (via `src/spa/llm-client.ts`) calls
 * `${__WORKER_BASE_URL__}/v1/chat/completions` — this is the correct endpoint
 * to stub for end-to-end specs.  The SPA's own token-pacing loop
 * (TOKEN_PACE_MS × AI_TYPING_SPEED) drives the observable inter-token
 * animation after the fetch resolves.
 *
 * @param page            The Playwright Page to install the route on.
 * @param wordsOrFactory  Either a static `string[]` of word chunks, or a
 *                        `WordsFactory` that receives the intercepted Request
 *                        and returns word chunks (sync or async).  Use a
 *                        factory when successive calls need distinct replies
 *                        (e.g. one completion per AI per round).
 *
 * @remarks
 * - Matches `**\/v1/chat/completions` so it covers the worker-proxied URL.
 * - Last-route-wins: calling `stubChatCompletions` again on the same page
 *   replaces the previous stub because Playwright prepends new routes.
 * - Only intercepts requests fired from the page context (SPA fetch).
 *   `page.request.*` calls bypass `page.route` — trigger fetch through
 *   the SPA flow or via `page.evaluate(() => fetch(...))`.
 *   See docs/agents/testing.md for full gotchas.
 */
export async function stubChatCompletions(
	page: Page,
	wordsOrFactory: string[] | WordsFactory,
): Promise<void> {
	const blurbFn = (id: string) => `Stub blurb for ${id}.`;
	await page.route("**/v1/chat/completions", async (route, request) => {
		const body = parseRequestBody(request);
		if (await tryFulfillJsonMode(route, body, blurbFn)) return;

		const words =
			typeof wordsOrFactory === "function"
				? await wordsOrFactory(request)
				: wordsOrFactory;

		await route.fulfill({
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			},
			body: messageToolCallToBlueSseBody(words),
		});
	});
}

export type GoToGameOptions = {
	/** SSE reply words or factory. Defaults to `["stub reply"]`. */
	sse?: string[] | WordsFactory;
	/** Synthesis blurb options. */
	synthesis?: SynthesisStubOptions;
	/**
	 * URL to navigate to instead of `"/"`. Useful for specs that need query-string
	 * test affordances (e.g. `"/?winImmediately=1"`, `"/?think=1"`, `"/?lockout=1"`).
	 * The start screen reads `location.search` at render time, so affordances set
	 * in the query string flow through to `applyTestAffordances` when BEGIN is clicked.
	 * Defaults to `"/"`.
	 */
	url?: string;
};

/**
 * Navigate through the start screen into the game and return AI handles.
 *
 * Steps:
 *  a. Stubs all new-game LLM calls (synthesis, content-pack, SSE) via `stubNewGameLLM`.
 *  b. `await page.goto(opts.url ?? "/?skipDialup=1")` — the default skips the
 *     dial-up animation so the login form appears immediately.
 *  c. Waits for `#begin` (CONNECT) to be enabled (generation complete).
 *  d. Fills `#password` with the accepted password.
 *  e. Clicks `#begin`.
 *  f. Waits for `main[data-view="game"]` and `#composer` visibility.
 *  g. Returns AiHandles from `getAiHandles(page)`.
 *
 * Specs that test the start-screen path itself should NOT use this helper —
 * they should navigate to `"/"` directly and exercise start-screen behaviour.
 */
export async function goToGame(
	page: Page,
	opts?: GoToGameOptions,
): Promise<AiHandles> {
	const sse = opts?.sse ?? ["stub reply"];
	await stubNewGameLLM(page, { sse, synthesis: opts?.synthesis });
	await page.goto(withSkipDialup(opts?.url ?? "/"));
	// Fast-synthesis stub returns instantly; 10s is ample — down from 30s.
	await expect(page.locator("#begin")).toBeEnabled({ timeout: 10_000 });
	await page.locator("#password").fill("password");
	await page.locator("#begin").click();
	await expect(page.locator('main[data-view="game"]')).toBeAttached({
		timeout: 10_000,
	});
	await expect(page.locator("#composer")).toBeVisible();
	return getAiHandles(page);
}

/** Append `skipDialup=1` to the URL's query string if it's not already present. */
function withSkipDialup(url: string): string {
	if (/[?&]skipDialup=/.test(url)) return url;
	const sep = url.includes("?") ? "&" : "?";
	return `${url}${sep}skipDialup=1`;
}

// ── Live tool-call SSE bodies ────────────────────────────────────────────────

/**
 * Build a minimal OpenAI-compatible SSE body that emits a single tool call with
 * `args` and then closes. The parser in `src/spa/streaming.ts` collects
 * `tool_calls` deltas by index and flushes them on
 * `finish_reason:"tool_calls"` or `[DONE]`.
 *
 * Specs use this to drive one live action for a chosen Daemon (`go`, `pick_up`)
 * instead of the `message` tool call `stubChatCompletions` emits.
 */
export function toolCallSseBody(
	name: string,
	args: Record<string, string>,
): string {
	const toolCallChunk = JSON.stringify({
		choices: [
			{
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_e2e_tc",
							function: { name, arguments: JSON.stringify(args) },
						},
					],
				},
				finish_reason: null,
			},
		],
	});
	const finishChunk = JSON.stringify({
		choices: [{ delta: {}, finish_reason: "tool_calls" }],
	});
	return `data: ${toolCallChunk}\n\ndata: ${finishChunk}\n\ndata: [DONE]\n\n`;
}

// ── Vista geometry (ADR 0015) ────────────────────────────────────────────────

/** A room cell. Row 0 is the room's north edge; columns increase eastward. */
export interface GridPosition {
	row: number;
	col: number;
}

/** The four directions `go` accepts. */
export type CardinalDirection = "north" | "south" | "east" | "west";

/** The four movement directions, in the order the specs iterate them. */
export const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = [
	"north",
	"south",
	"east",
	"west",
];

/** Compass order used to order the axis steps of a cell label (ADR 0015). */
const COMPASS_ORDER: readonly CardinalDirection[] = [
	"north",
	"east",
	"south",
	"west",
];

/** Spelled-out distances, as `describeSteps` renders them. */
const DISTANCE_WORDS: readonly string[] = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
];

/** Row/column delta for one cardinal step. North decreases the row. */
export function stepDelta(direction: CardinalDirection): {
	drow: number;
	dcol: number;
} {
	switch (direction) {
		case "north":
			return { drow: -1, dcol: 0 };
		case "south":
			return { drow: 1, dcol: 0 };
		case "east":
			return { drow: 0, dcol: 1 };
		case "west":
			return { drow: 0, dcol: -1 };
	}
}

/** True when an entity holder is a grid cell rather than a Daemon id. */
export function isGridPosition(holder: unknown): holder is GridPosition {
	return (
		typeof holder === "object" &&
		holder !== null &&
		typeof (holder as GridPosition).row === "number" &&
		typeof (holder as GridPosition).col === "number"
	);
}

/** True when both positions name the same cell. */
export function positionsEqual(a: GridPosition, b: GridPosition): boolean {
	return a.row === b.row && a.col === b.col;
}

/** True when `position` is inside the 5×5 room. */
export function inRoom(position: GridPosition): boolean {
	return (
		position.row >= 0 &&
		position.row < 5 &&
		position.col >= 0 &&
		position.col < 5
	);
}

/**
 * The runtime's witness gate (ADR 0015): `cell` is inside the Vista centred on
 * `observer` when `dx² + dy² ≤ 4`, where north decreases the row. Mirrors
 * `vistaContains` in `src/spa/game/vista-projector.ts` — position only, with
 * obstacles never occluding membership.
 */
export function inVista(observer: GridPosition, cell: GridPosition): boolean {
	const dx = cell.col - observer.col;
	const dy = observer.row - cell.row;
	return dx * dx + dy * dy <= 4;
}

/** One cell of the projected Vista, with the label the listing renders. */
export interface VistaCell {
	position: GridPosition;
	isOwnCell: boolean;
	isWall: boolean;
	label: string;
}

/**
 * The 13 Vista offsets (ADR 0015): `dx` runs east–west and `dy` north–south.
 * Mirrors `VISTA_OFFSETS` in `src/spa/game/vista-projector.ts`.
 */
const VISTA_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
	{ dx: 0, dy: 0 },
	{ dx: 0, dy: 2 },
	{ dx: -1, dy: 1 },
	{ dx: 0, dy: 1 },
	{ dx: 1, dy: 1 },
	{ dx: -2, dy: 0 },
	{ dx: -1, dy: 0 },
	{ dx: 1, dy: 0 },
	{ dx: 2, dy: 0 },
	{ dx: -1, dy: -1 },
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: -1 },
	{ dx: 0, dy: -2 },
];

/**
 * Cardinal label for one Vista offset, capitalised as the listing renders it
 * ("one step north and one step east" → "One step north and one step east").
 * Mirrors `describeSteps` + `capitalize` in `src/spa/game/prompt-builder.ts`.
 */
function vistaLabel(dx: number, dy: number): string {
	if (dx === 0 && dy === 0) return "Your cell";
	const steps: Array<{ direction: CardinalDirection; distance: number }> = [];
	if (dy !== 0) {
		steps.push({
			direction: dy > 0 ? "north" : "south",
			distance: Math.abs(dy),
		});
	}
	if (dx !== 0) {
		steps.push({ direction: dx > 0 ? "east" : "west", distance: Math.abs(dx) });
	}
	steps.sort(
		(a, b) =>
			COMPASS_ORDER.indexOf(a.direction) - COMPASS_ORDER.indexOf(b.direction),
	);
	const label = steps
		.map(
			(step) =>
				`${DISTANCE_WORDS[step.distance] ?? String(step.distance)} ` +
				`${step.distance === 1 ? "step" : "steps"} ${step.direction}`,
		)
		.join(" and ");
	return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Project the position-only 13-cell Vista from `observer`, flagging the
 * out-of-bounds cells the Daemon perceives as Walls. Mirrors `projectVista`.
 */
export function vistaCells(observer: GridPosition): VistaCell[] {
	return VISTA_OFFSETS.map((offset) => {
		const position = {
			row: observer.row - offset.dy,
			col: observer.col + offset.dx,
		};
		return {
			position,
			isOwnCell: offset.dx === 0 && offset.dy === 0,
			isWall: !inRoom(position),
			label: vistaLabel(offset.dx, offset.dy),
		};
	});
}

/** The cell labels of a rendered `<what_you_see>` block ("- <label>: <contents>"). */
export function listingLabels(block: string): string[] {
	return block
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => {
			const separator = line.indexOf(": ");
			return separator === -1 ? line.slice(2) : line.slice(2, separator);
		});
}

/** The text between the last `open` marker and the `close` that follows it. */
export function sectionBetween(
	text: string,
	open: string,
	close: string,
): string {
	const start = text.lastIndexOf(open);
	if (start === -1) return "";
	const end = text.indexOf(close, start);
	if (end === -1) return "";
	return text.slice(start + open.length, end);
}

/**
 * Relative-direction vocabulary ADR 0015 retired in favour of the room's
 * cardinal axes: a listing must never phrase a position relative to a Daemon.
 * Not a Vista shape — an absence check on rendered prompt prose.
 */
export const RELATIVE_DIRECTION_WORDS =
	/\b(ahead|behind|forward|backward|left|right)\b/i;

// ── Sealed engine.dat storage ────────────────────────────────────────────────

/**
 * XOR obfuscation key for `engine.dat`, mirrored from
 * `src/spa/persistence/sealed-blob-codec.ts`. The blob is obfuscated, not
 * encrypted, and specs need to read (and occasionally seed) persisted engine
 * state, so the codec lives here rather than importing the SPA module.
 */
export const ENGINE_OBFUSCATION_KEY = "hi-blue:engine/v1@kJvN3pX8wQmR2sZt";

/** Reverse the engine.dat obfuscation. Mirrors `deobfuscate` in the codec. */
export function deobfuscateEngineBlob(blob: string): string {
	const keyBytes = new TextEncoder().encode(ENGINE_OBFUSCATION_KEY);
	const binary = atob(blob);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] =
			(binary.charCodeAt(i) & 0xff) ^ (keyBytes[i % keyBytes.length] as number);
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** Apply the engine.dat obfuscation. Mirrors `obfuscate` in the codec. */
export function obfuscateEngineBlob(json: string): string {
	const keyBytes = new TextEncoder().encode(ENGINE_OBFUSCATION_KEY);
	const bytes = new TextEncoder().encode(json);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = (bytes[i] as number) ^ (keyBytes[i % keyBytes.length] as number);
	}
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i] as number);
	}
	return btoa(binary);
}

/** An entity holder: a Daemon holding the entity, or the cell it rests on. */
export type EntityHolder = string | GridPosition;

/** The persisted subset of `WorldEntity` these specs read back. */
export interface SealedEntity {
	id: string;
	kind: string;
	name: string;
	holder: EntityHolder;
	satisfactionState?: string;
}

/** The persisted subset of `ContentPack` these specs read back. */
export interface SealedContentPack {
	setting: string;
	wallName: string;
	/** Flat entity list (session v11+). */
	entities?: SealedEntity[];
	/** Bucketed obstacle list (pre-v11 blobs). */
	obstacles?: Array<{ holder: GridPosition | null }>;
}

/** The persisted subset of the sealed `engine.dat` payload (session v12). */
export interface SealedEngine {
	schemaVersion: number;
	personaSpatial: Record<string, { position: GridPosition }>;
	world: { entities: SealedEntity[] };
	contentPacksA: SealedContentPack[];
	contentPacksB: SealedContentPack[];
	activePackId: "A" | "B";
	weather?: string;
}

/** One entry of a persisted `<aiId>.txt` conversation log. */
export interface SealedConversationEntry {
	kind: string;
	round: number;
	actor?: string;
	actionKind?: string;
	direction?: string;
	toolName?: string;
	success?: boolean;
	diskDelta?: string;
	content?: string;
	from?: string;
	to?: string;
}

/** The persisted subset of a Daemon's `<aiId>.txt` file. */
export interface SealedDaemonFile {
	aiId: string;
	persona: { name: string };
	conversationLog: SealedConversationEntry[];
}

/** The Content Pack the sealed engine has active (A unless a Setting Shift). */
export function activePackOf(
	sealed: SealedEngine,
): SealedContentPack | undefined {
	const packs =
		sealed.activePackId === "B" ? sealed.contentPacksB : sealed.contentPacksA;
	return packs?.[0];
}

/**
 * Grid cells of every Obstacle in a Content Pack, read from the flat `entities`
 * list the runtime places and persists (v11+). The bucketed pre-v11
 * `obstacles` field is a fallback for blobs written before the flattening.
 */
export function obstacleCellsOf(pack: SealedContentPack): GridPosition[] {
	const fromEntities = (pack.entities ?? [])
		.filter((entity) => entity.kind === "obstacle")
		.map((entity) => entity.holder)
		.filter(isGridPosition);
	if (fromEntities.length > 0) return fromEntities;
	return (pack.obstacles ?? [])
		.map((obstacle) => obstacle.holder)
		.filter(isGridPosition);
}

/** Read the active session's sealed engine payload, decoded. */
export async function readActiveSessionEngine(
	page: Page,
): Promise<{ sessionId: string; sealed: SealedEngine }> {
	const raw = await page.evaluate(() => {
		const sessionId = localStorage.getItem("hi-blue:active-session");
		if (sessionId === null) return null;
		const blob = localStorage.getItem(
			`hi-blue:sessions/${sessionId}/engine.dat`,
		);
		if (blob === null) return null;
		return { sessionId, blob };
	});
	if (raw === null) {
		throw new Error("e2e: no active session engine.dat in localStorage");
	}
	return {
		sessionId: raw.sessionId,
		sealed: JSON.parse(deobfuscateEngineBlob(raw.blob)) as SealedEngine,
	};
}

/** Overwrite the active session's `engine.dat` with `sealed`, obfuscated. */
export async function writeActiveSessionEngine(
	page: Page,
	sessionId: string,
	sealed: SealedEngine,
): Promise<void> {
	const value = obfuscateEngineBlob(JSON.stringify(sealed));
	await page.evaluate(
		({ key, blob }: { key: string; blob: string }) => {
			localStorage.setItem(key, blob);
		},
		{ key: `hi-blue:sessions/${sessionId}/engine.dat`, blob: value },
	);
}

/** Read one Daemon's persisted `<aiId>.txt`. */
export async function readDaemonFile(
	page: Page,
	sessionId: string,
	aiId: string,
): Promise<SealedDaemonFile> {
	const raw = await page.evaluate(
		(key: string) => localStorage.getItem(key),
		`hi-blue:sessions/${sessionId}/${aiId}.txt`,
	);
	if (raw === null)
		throw new Error(`e2e: ${aiId}.txt not found in localStorage`);
	return JSON.parse(raw) as SealedDaemonFile;
}

/**
 * Every plain-text file the session wrote: `meta.json`, each `<aiId>.txt`, and
 * the decoded `engine.dat` payload. Used to assert on what a save actually
 * carries (rather than on one field at a time).
 */
export async function readActiveSessionFiles(page: Page): Promise<{
	meta: string;
	daemons: Record<string, string>;
	engineJson: string;
}> {
	const raw = await page.evaluate(() => {
		const sessionId = localStorage.getItem("hi-blue:active-session") ?? "";
		const prefix = `hi-blue:sessions/${sessionId}/`;
		const daemons: Record<string, string> = {};
		let meta = "";
		let engine = "";
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key === null || !key.startsWith(prefix)) continue;
			const name = key.slice(prefix.length);
			const value = localStorage.getItem(key) ?? "";
			if (name === "meta.json") meta = value;
			else if (name === "engine.dat") engine = value;
			else if (name.endsWith(".txt")) daemons[name] = value;
		}
		return { meta, daemons, engine };
	});
	return {
		meta: raw.meta,
		daemons: raw.daemons,
		engineJson: raw.engine === "" ? "" : deobfuscateEngineBlob(raw.engine),
	};
}

/**
 * Wait until `meta.json` reports at least `expectedRound`. The save writes
 * meta.json first and `engine.dat` last, so this alone does not prove the
 * round's engine state is committed — pair it with
 * {@link waitForSavedPosition} when the assertion depends on engine data.
 */
export async function waitForRound(
	page: Page,
	sessionId: string,
	expectedRound: number,
	timeoutMs = 30_000,
): Promise<void> {
	await page.waitForFunction(
		({ sid, expectedRound: round }: { sid: string; expectedRound: number }) => {
			const raw = localStorage.getItem(`hi-blue:sessions/${sid}/meta.json`);
			if (raw === null) return false;
			try {
				const meta = JSON.parse(raw) as { round?: number };
				return (meta.round ?? 0) >= round;
			} catch {
				return false;
			}
		},
		{ sid: sessionId, expectedRound },
		{ timeout: timeoutMs },
	);
}

/**
 * Wait until the committed `engine.dat` stores `expected` as `aiId`'s position.
 * `engine.dat` is written last in the save order, so it is the commit signal
 * for a round's engine state.
 */
export async function waitForSavedPosition(
	page: Page,
	sessionId: string,
	aiId: string,
	expected: GridPosition,
	timeoutMs = 30_000,
): Promise<void> {
	await page.waitForFunction(
		({
			sid,
			id,
			row,
			col,
			key,
		}: {
			sid: string;
			id: string;
			row: number;
			col: number;
			key: string;
		}) => {
			const blob = localStorage.getItem(`hi-blue:sessions/${sid}/engine.dat`);
			if (blob === null) return false;
			try {
				const keyBytes = new TextEncoder().encode(key);
				const binary = atob(blob);
				const bytes = new Uint8Array(binary.length);
				for (let i = 0; i < binary.length; i++) {
					bytes[i] =
						(binary.charCodeAt(i) & 0xff) ^
						(keyBytes[i % keyBytes.length] as number);
				}
				const sealed = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(bytes),
				) as { personaSpatial?: Record<string, { position?: GridPosition }> };
				const position = sealed.personaSpatial?.[id]?.position;
				return position?.row === row && position?.col === col;
			} catch {
				return false;
			}
		},
		{
			sid: sessionId,
			id: aiId,
			row: expected.row,
			col: expected.col,
			key: ENGINE_OBFUSCATION_KEY,
		},
		{ timeout: timeoutMs },
	);
}
