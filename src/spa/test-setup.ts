/**
 * Vitest setup for the browser (jsdom) project.
 * Provides build-time globals that esbuild would normally inject.
 */
import { beforeEach, vi } from "vitest";

beforeEach(() => {
	vi.stubGlobal("__WORKER_BASE_URL__", "http://localhost:8787");
	vi.stubGlobal("__DEV__", true);
});
