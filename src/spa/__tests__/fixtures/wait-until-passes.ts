import { vi } from "vitest";

const POLL_INTERVAL_MS = 1;

export function waitUntilPasses<T>(
	assertion: () => T | Promise<T>,
): Promise<T> {
	return vi.waitFor(assertion, { interval: POLL_INTERVAL_MS });
}
