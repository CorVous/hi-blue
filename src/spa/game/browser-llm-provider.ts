/**
 * BrowserLLMProvider
 *
 * Adapts the browser-side `streamCompletion` (which uses `fetch` + SSE)
 * to the `LLMProvider` interface expected by `runRound` / `GameSession`.
 *
 * The adapter bridges the callback-based `streamCompletion` into an
 * `AsyncIterable<string>` by queuing tokens and resuming the generator
 * via a shared resolve handle.
 */

import type { LLMProvider } from "../../proxy/llm-provider";
import { streamCompletion } from "../llm-client.js";

export class BrowserLLMProvider implements LLMProvider {
	async *streamCompletion(prompt: string): AsyncIterable<string> {
		const queue: string[] = [];
		let resolveNext: (() => void) | null = null;
		let done = false;
		let err: unknown;

		streamCompletion({
			messages: [{ role: "system", content: prompt }],
			onDelta: (text) => {
				queue.push(text);
				resolveNext?.();
			},
		}).then(
			() => {
				done = true;
				resolveNext?.();
			},
			(e: unknown) => {
				err = e;
				done = true;
				resolveNext?.();
			},
		);

		while (true) {
			if (queue.length > 0) {
				const token = queue.shift();
				if (token !== undefined) yield token;
				continue;
			}
			if (done) {
				if (err) throw err;
				return;
			}
			await new Promise<void>((r) => {
				resolveNext = r;
			});
		}
	}
}
