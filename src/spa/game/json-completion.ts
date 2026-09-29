import type { JsonCompletionResult } from "../llm-client.js";
import { HttpStatusError } from "../llm-errors.js";

const MAX_RETRY_AFTER_WAIT_MS = 10_000;

export function parseJsonCompletion(
	result: JsonCompletionResult,
	label: string,
	toError: (message: string) => Error,
): { parsed: unknown; raw: string } {
	const { content, reasoning } = result;
	const raw = content !== null && content !== "" ? content : reasoning;
	if (raw === null || raw === "") {
		throw toError(`${label} response has neither content nor reasoning`);
	}

	try {
		return { parsed: JSON.parse(raw), raw };
	} catch {
		throw toError(`${label} JSON parse failed: ${raw}`);
	}
}

export function retryDelayMs(err: unknown, defaultMs: number): number {
	if (err instanceof HttpStatusError && err.retryAfterSec !== null) {
		return Math.min(
			Math.max(defaultMs, err.retryAfterSec * 1000),
			MAX_RETRY_AFTER_WAIT_MS,
		);
	}
	return defaultMs;
}

export function sleepUnlessAborted(
	ms: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
