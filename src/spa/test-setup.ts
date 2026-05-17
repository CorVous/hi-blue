/**
 * Vitest setup for the browser (jsdom) project.
 * Provides build-time globals that esbuild would normally inject.
 */
import { beforeEach, vi } from "vitest";

beforeEach(() => {
	vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
	vi.stubGlobal("__DEV__", true);
	// Reset location.search between tests. setSearch() helpers in route tests
	// use history.replaceState which persists across tests otherwise; leaking
	// ?winImmediately=1 into a persistence test silently ends the round on the
	// next submit and breaks the AI-response assertions.
	if (typeof window !== "undefined" && window.history?.replaceState) {
		window.history.replaceState({}, "", "/");
	}
});
