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
