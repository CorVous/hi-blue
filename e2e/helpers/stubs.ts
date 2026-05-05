import type { Page, Request } from "@playwright/test";
import type { SseEvent } from "../../src/spa/game/round-result-encoder";
import { eventsToSseBody } from "./sse";

/**
 * A factory function that produces SSE events, optionally inspecting the
 * intercepted request. May be async.
 */
export type EventsFactory = (
	request: Request,
) => SseEvent[] | Promise<SseEvent[]>;

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
 * Register a Playwright route stub for the /v1/chat/completions endpoint that
 * responds with a synthetic streaming OpenAI SSE body built from the given word
 * chunks. The SPA's own token-pacing loop (TOKEN_PACE_MS × AI_TYPING_SPEED) will
 * produce observable inter-token delays in the transcript after the fetch completes.
 *
 * @param page     The Playwright Page to install the route on.
 * @param words    Word-level chunks to stream as `delta.content` events.
 *
 * @remarks
 * - Matches **\/v1/chat/completions so it covers the worker-proxied URL.
 * - The stub is installed as a last-route-wins Playwright route; calling it
 *   again replaces the previous stub because Playwright prepends new routes.
 * - Only intercepts requests fired from the page context (SPA fetch). See
 *   stubGameTurn remarks for full gotchas.
 */
export async function streamChatCompletion(
	page: Page,
	words: string[],
): Promise<void> {
	await page.route("**/v1/chat/completions", async (route) => {
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
 * Register a Playwright route stub for the game/turn endpoint that responds
 * with a synthetic SSE body.
 *
 * @param page            The Playwright Page to install the route on.
 * @param eventsOrFactory Either a static SseEvent[] array or an
 *                        EventsFactory that receives the intercepted
 *                        Request and returns events (sync or async).
 *
 * @remarks
 * - Matches the glob pattern **\/game/turn, covering http://localhost:8787/game/turn
 *   and any path-prefixed variant.
 * - Response headers mirror src/proxy/_smoke.ts lines 281-283 verbatim.
 * - Last-route-wins: calling stubGameTurn again on the same page replaces the
 *   previous stub because Playwright prepends new routes.
 * - Only intercepts requests fired from the page context (SPA fetch, navigation,
 *   form submits). `page.request.*` calls bypass `page.route` — to exercise this
 *   stub from a spec, trigger /game/turn through the SPA flow or via
 *   `page.evaluate(() => fetch("/game/turn", …))`. See docs/agents/testing.md.
 */
export async function stubGameTurn(
	page: Page,
	eventsOrFactory: SseEvent[] | EventsFactory,
): Promise<void> {
	await page.route("**/game/turn", async (route, request) => {
		const events =
			typeof eventsOrFactory === "function"
				? await eventsOrFactory(request)
				: eventsOrFactory;

		await route.fulfill({
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			},
			body: eventsToSseBody(events),
		});
	});
}
