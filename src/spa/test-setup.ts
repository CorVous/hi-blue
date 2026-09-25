import { beforeEach, vi } from "vitest";

beforeEach(() => {
	vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
	vi.stubGlobal("__DEV__", true);
	if (typeof window !== "undefined" && window.history?.replaceState) {
		window.history.replaceState({}, "", "/");
	}
});
