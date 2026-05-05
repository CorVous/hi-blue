import type { SseEvent } from "../../src/spa/game/round-result-encoder";

/**
 * Serialise an array of SSE events into a complete SSE response body.
 *
 * Each event is emitted as `data: <JSON>\n\n`, mirroring the worker's wire
 * format (see `src/proxy/_smoke.ts` lines 311 and 327). A terminating
 * `data: [DONE]\n\n` sentinel is appended automatically.
 *
 * @param events  The ordered list of SSE events to emit.
 * @returns       A complete SSE body string. Callers MUST NOT append anything
 *                further — the `[DONE]` sentinel is already included.
 */
export function eventsToSseBody(events: SseEvent[]): string {
	const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
	lines.push("data: [DONE]\n\n");
	return lines.join("");
}
