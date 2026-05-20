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

type ParsedBody = {
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

const STUB_LANDMARKS = {
	north: {
		shortName: "Distant ridge",
		horizonPhrase: "A jagged ridge cuts the skyline.",
	},
	south: {
		shortName: "Rolling hills",
		horizonPhrase: "Gentle slopes melt into haze.",
	},
	east: {
		shortName: "Stone tower",
		horizonPhrase: "A weathered tower breaks the treeline.",
	},
	west: {
		shortName: "Misty forest",
		horizonPhrase: "A dark canopy blurs into fog.",
	},
};

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
		landmarks: STUB_LANDMARKS,
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

function parseRequestBody(request: Request): ParsedBody {
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
