import type { Page, Request } from "@playwright/test";

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
 */
export function wordsToOpenAiSseBody(words: string[]): string {
	const lines: string[] = words.map(
		(word) =>
			`data: ${JSON.stringify({ choices: [{ delta: { content: word }, finish_reason: null }] })}\n\n`,
	);
	lines.push("data: [DONE]\n\n");
	return lines.join("");
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

export type SynthesisStubOptions = {
	/** Generate a blurb for a given persona id. Defaults to `id => \`Stub blurb for ${id}.\`` */
	blurb?: (id: string) => string;
};

/**
 * Register a Playwright route stub that handles the persona synthesis
 * JSON-mode `/v1/chat/completions` call.  It parses the request body,
 * extracts persona ids from the user message, and returns a canned
 * `{ choices: [{ message: { content: JSON.stringify({ personas: [...] }) } }] }`
 * response that echoes each input id verbatim.
 *
 * Non-synthesis (SSE/streaming) requests are forwarded via `route.fallback()`.
 */
export async function stubPersonaSynthesis(
	page: Page,
	options?: SynthesisStubOptions,
): Promise<void> {
	const blurbFn = options?.blurb ?? ((id: string) => `Stub blurb for ${id}.`);
	await page.route("**/v1/chat/completions", async (route, request) => {
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(request.postData() ?? "null");
		} catch {
			// ignore parse error
		}
		const body = parsed as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ content?: string }>;
		} | null;
		const isJsonMode =
			body !== null && (body.stream === false || body.response_format != null);
		if (isJsonMode) {
			const ids = extractInputIds(body?.messages?.[1]?.content ?? "");
			const content = JSON.stringify({
				personas: ids.map((id) => ({ id, blurb: blurbFn(id) })),
			});
			await route.fulfill({
				status: 200,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ choices: [{ message: { content } }] }),
			});
			return;
		}
		await route.fallback();
	});
}

export type NewGameLLMOptions = {
	sse: string[] | WordsFactory;
	synthesis?: SynthesisStubOptions;
};

/**
 * Combined stub that handles both the persona synthesis JSON call and the
 * gameplay SSE streaming call in a single `page.route` registration.
 *
 * Distinguishes calls by request body:
 *   - `stream === false` or `response_format` present → synthesis JSON response
 *   - otherwise → SSE streaming response
 */
export async function stubNewGameLLM(
	page: Page,
	opts: NewGameLLMOptions,
): Promise<void> {
	const blurbFn =
		opts.synthesis?.blurb ?? ((id: string) => `Stub blurb for ${id}.`);
	const wordsOrFactory = opts.sse;

	await page.route("**/v1/chat/completions", async (route, request) => {
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(request.postData() ?? "null");
		} catch {
			// ignore parse error
		}
		const body = parsed as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ content?: string }>;
		} | null;
		const isJsonMode =
			body !== null && (body.stream === false || body.response_format != null);

		if (isJsonMode) {
			const ids = extractInputIds(body?.messages?.[1]?.content ?? "");
			const content = JSON.stringify({
				personas: ids.map((id) => ({ id, blurb: blurbFn(id) })),
			});
			await route.fulfill({
				status: 200,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ choices: [{ message: { content } }] }),
			});
			return;
		}

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
			body: wordsToOpenAiSseBody(words),
		});
	});
}

/**
 * Register a Playwright route stub for the `/v1/chat/completions` endpoint
 * that responds with a synthetic streaming OpenAI SSE body.
 *
 * Also handles the persona synthesis JSON-mode call (stream === false or
 * response_format present) by returning a canned JSON response that echoes
 * the input persona ids verbatim.  This means every existing spec that calls
 * `stubChatCompletions` continues to work even when the SPA fires the
 * synthesis call first.
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
	await page.route("**/v1/chat/completions", async (route, request) => {
		let parsed: unknown = null;
		try {
			parsed = JSON.parse(request.postData() ?? "null");
		} catch {
			// ignore parse error
		}
		const body = parsed as {
			stream?: boolean;
			response_format?: unknown;
			messages?: Array<{ content?: string }>;
		} | null;
		const isJsonMode =
			body !== null && (body.stream === false || body.response_format != null);

		if (isJsonMode) {
			// Synthesis path — echo input ids with canned blurbs
			const ids = extractInputIds(body?.messages?.[1]?.content ?? "");
			const content = JSON.stringify({
				personas: ids.map((id) => ({ id, blurb: `Stub blurb for ${id}.` })),
			});
			await route.fulfill({
				status: 200,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ choices: [{ message: { content } }] }),
			});
			return;
		}

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
			body: wordsToOpenAiSseBody(words),
		});
	});
}
