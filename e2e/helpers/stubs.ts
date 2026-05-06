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
 * Register a Playwright route stub for the `/v1/chat/completions` endpoint
 * that responds with a synthetic streaming OpenAI SSE body.
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
 * that responds with a synthetic streaming OpenAI SSE body built from the
 * given word chunks.
 *
 * @deprecated Use `stubChatCompletions` instead — it accepts both static
 * word arrays and request-aware factories, making it strictly more capable.
 * `streamChatCompletion` is kept for backward compatibility with specs added
 * by Slice 2 (#86); the spec-refactor follow-up (#93) will migrate them.
 */
export async function streamChatCompletion(
	page: Page,
	words: string[],
): Promise<void> {
	return stubChatCompletions(page, words);
}
