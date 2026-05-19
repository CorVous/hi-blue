import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingBootstrap, PendingCallMeta } from "../../game/pending-bootstrap.js";
import {
	__resetPendingStripForTests,
	clearPendingStrip,
	renderPendingStrip,
	updatePendingStrip,
} from "../pending-strip.js";

function makePending(
	status: PendingBootstrap["status"],
	error?: unknown,
): PendingBootstrap {
	return {
		personasPromise: new Promise(() => {}),
		contentPacksPromise: new Promise(() => {}),
		status,
		...(error !== undefined ? { error } : {}),
	};
}

describe("pending-strip.ts", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		document.body.innerHTML = '<div id="dev-game-strip"></div>';
	});

	afterEach(() => {
		vi.useRealTimers();
		__resetPendingStripForTests();
	});

	it("renders pip + callName + elapsed for 'pending' status", () => {
		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "persona-synthesis",
			startedAtMs: Date.now(),
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		const pipEl = containerEl.querySelector('[data-field="pip"]');
		expect(pipEl?.textContent).toBe("●");
		expect(pipEl?.getAttribute("data-state")).toBe("in-flight");

		const statusWordEl = containerEl.querySelector('[data-field="status-word"]');
		expect(statusWordEl?.textContent).toBe("fetching");

		const callNameEl = containerEl.querySelector('[data-field="call-name"]');
		expect(callNameEl?.textContent).toBe("persona-synthesis");
		expect(callNameEl?.hasAttribute("hidden")).toBe(false);

		const elapsedEl = containerEl.querySelector('[data-field="elapsed"]');
		expect(elapsedEl?.hasAttribute("hidden")).toBe(false);
		expect(elapsedEl?.textContent).toMatch(/^0\.0s elapsed$/);
	});

	it("hides retry span when retryCount is 0 or undefined", () => {
		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: Date.now(),
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		const retryEl = containerEl.querySelector('[data-field="retry"]');
		expect(retryEl?.hasAttribute("hidden")).toBe(true);

		const sepRetryEl = containerEl.querySelector('[data-field="sep-retry"]');
		expect(sepRetryEl?.hasAttribute("hidden")).toBe(true);
	});

	it("shows retry 'retry N/M' when retryCount > 0", () => {
		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: Date.now(),
			retryCount: 1,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		const retryEl = containerEl.querySelector('[data-field="retry"]');
		expect(retryEl?.textContent).toBe("retry 1/3");
		expect(retryEl?.hasAttribute("hidden")).toBe(false);

		const sepRetryEl = containerEl.querySelector('[data-field="sep-retry"]');
		expect(sepRetryEl?.hasAttribute("hidden")).toBe(false);
	});

	it("shows last-error span when lastError is set", () => {
		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: Date.now(),
			retryCount: 1,
			retryMax: 3,
			lastError: "502 upstream",
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		const lastErrorEl = containerEl.querySelector('[data-field="last-error"]');
		expect(lastErrorEl?.textContent).toBe("last error: 502 upstream");
		expect(lastErrorEl?.hasAttribute("hidden")).toBe(false);

		const sepErrorEl = containerEl.querySelector('[data-field="sep-error"]');
		expect(sepErrorEl?.hasAttribute("hidden")).toBe(false);
	});

	it("pip → ✕ / 'errored' on status 'failed'", () => {
		const pending = makePending("failed", new Error("test error"));
		const meta: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: Date.now(),
			retryCount: 3,
			retryMax: 3,
			lastError: "test error",
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		const pipEl = containerEl.querySelector('[data-field="pip"]');
		expect(pipEl?.textContent).toBe("✕");
		expect(pipEl?.getAttribute("data-state")).toBe("errored");

		const statusWordEl = containerEl.querySelector('[data-field="status-word"]');
		expect(statusWordEl?.textContent).toBe("errored");
	});

	it("pip → ○ / 'ready' on status 'ready'", () => {
		const pending = makePending("ready");
		const meta: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: Date.now(),
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		const pipEl = containerEl.querySelector('[data-field="pip"]');
		expect(pipEl?.textContent).toBe("○");
		expect(pipEl?.getAttribute("data-state")).toBe("idle");

		const statusWordEl = containerEl.querySelector('[data-field="status-word"]');
		expect(statusWordEl?.textContent).toBe("ready");
	});

	it("elapsed ticks via setInterval (~100ms) — advance fake timers, assert text updates", () => {
		const pending = makePending("pending");
		const startMs = Date.now();
		const meta: PendingCallMeta = {
			callName: "persona-synthesis",
			startedAtMs: startMs,
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);

		let elapsedEl = containerEl.querySelector('[data-field="elapsed"]');
		expect(elapsedEl?.textContent).toBe("0.0s elapsed");

		// Advance 5 seconds
		vi.advanceTimersByTime(5000);

		elapsedEl = containerEl.querySelector('[data-field="elapsed"]');
		expect(elapsedEl?.textContent).toBe("5.0s elapsed");

		// Advance another 2.5 seconds
		vi.advanceTimersByTime(2500);

		elapsedEl = containerEl.querySelector('[data-field="elapsed"]');
		expect(elapsedEl?.textContent).toBe("7.5s elapsed");
	});

	it("updatePendingStrip swaps callName without restarting ticker (spy on setInterval, assert called once)", () => {
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

		const pending = makePending("pending");
		const startMs = Date.now();
		const meta1: PendingCallMeta = {
			callName: "persona-synthesis",
			startedAtMs: startMs,
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta1);
		expect(setIntervalSpy).toHaveBeenCalledTimes(1);

		// Update with different callName
		const meta2: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: startMs,
			retryCount: 0,
			retryMax: 3,
		};
		updatePendingStrip(containerEl, pending, meta2);

		// setInterval should still have been called only once
		expect(setIntervalSpy).toHaveBeenCalledTimes(1);

		// But the callName should be updated
		const callNameEl = containerEl.querySelector('[data-field="call-name"]');
		expect(callNameEl?.textContent).toBe("content-pack");

		setIntervalSpy.mockRestore();
	});

	it("clearPendingStrip clears interval + DOM; advancing timers after clear is safe (no throw)", () => {
		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "persona-synthesis",
			startedAtMs: Date.now(),
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);
		expect(containerEl.querySelector('[data-field="pip"]')).toBeTruthy();

		clearPendingStrip(containerEl);

		// DOM should be cleared
		expect(containerEl.querySelector('[data-field="pip"]')).toBeFalsy();
		expect(containerEl.classList.contains("dev-pending-strip")).toBe(false);

		// Advancing timers after clear should not throw
		expect(() => {
			vi.advanceTimersByTime(500);
		}).not.toThrow();
	});

	it("renderPendingStrip called twice clears the previous interval first", () => {
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "persona-synthesis",
			startedAtMs: Date.now(),
			retryCount: 0,
			retryMax: 3,
		};
		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderPendingStrip(containerEl, pending, meta);
		expect(clearIntervalSpy).not.toHaveBeenCalled();

		// Render again
		renderPendingStrip(containerEl, pending, meta);
		expect(clearIntervalSpy).toHaveBeenCalled();

		clearIntervalSpy.mockRestore();
	});

	it("renderInspector branch: pendingBootstrap-only → pending strip renders, map hidden", async () => {
		// Import after setup so fake timers are in place
		const { renderInspector } = await import("../index.js");

		const pending = makePending("pending");
		const meta: PendingCallMeta = {
			callName: "content-pack",
			startedAtMs: Date.now(),
			retryCount: 1,
			retryMax: 3,
		};

		// Add map and footers to DOM
		const mapEl = document.createElement("div");
		mapEl.id = "dev-world-map";
		document.body.appendChild(mapEl);

		const footerEl = document.createElement("div");
		footerEl.className = "dev-daemon-footer";
		document.body.appendChild(footerEl);

		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		// Mock getPendingCallMeta
		vi.doMock("../../game/pending-bootstrap.js", () => ({
			getPendingCallMeta: () => meta,
		}));

		renderInspector(document.body, { pendingBootstrap: pending });

		expect(containerEl.getAttribute("hidden")).toBeNull();
		expect(containerEl.getAttribute("data-strip")).toBe("pending");
		expect(mapEl.getAttribute("hidden")).toBe("");
		expect(footerEl.getAttribute("hidden")).toBe("");
	});

	it("renderInspector branch: session-set → pending strip cleared, game-strip renders", async () => {
		const { renderInspector } = await import("../index.js");
		const { STATIC_CONTENT_PACKS } = await import(
			"../../__tests__/fixtures/static-content-packs.js"
		);
		const { STATIC_PERSONAS } = await import(
			"../../__tests__/fixtures/static-personas.js"
		);
		const { GameSession } = await import("../../game/game-session.js");

		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);

		// Add map and footers to DOM
		const mapEl = document.createElement("div");
		mapEl.id = "dev-world-map";
		document.body.appendChild(mapEl);

		const footerEl = document.createElement("div");
		footerEl.className = "dev-daemon-footer";
		document.body.appendChild(footerEl);

		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderInspector(document.body, { session });

		// Strip should not have pending data
		expect(containerEl.getAttribute("data-strip")).not.toBe("pending");
		expect(containerEl.getAttribute("hidden")).toBeNull();
		expect(mapEl.getAttribute("hidden")).toBeNull();
		expect(footerEl.getAttribute("hidden")).toBeNull();
	});

	it("renderInspector branch: neither set → strip hidden + empty", async () => {
		const { renderInspector } = await import("../index.js");

		// Add map and footers to DOM
		const mapEl = document.createElement("div");
		mapEl.id = "dev-world-map";
		document.body.appendChild(mapEl);

		const footerEl = document.createElement("div");
		footerEl.className = "dev-daemon-footer";
		document.body.appendChild(footerEl);

		const containerEl = document.getElementById("dev-game-strip") as HTMLElement;

		renderInspector(document.body, {});

		expect(containerEl.getAttribute("hidden")).toBe("");
		expect(containerEl.children.length).toBe(0);
		expect(mapEl.getAttribute("hidden")).toBe("");
		expect(footerEl.getAttribute("hidden")).toBe("");
	});
});
