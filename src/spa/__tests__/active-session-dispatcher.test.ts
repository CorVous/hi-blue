/**
 * active-session-dispatcher.test.ts
 *
 * Five-state truth table for dispatchActiveSession. Pure function — no DOM.
 *
 * Issue #173 (parent #155).
 */
import { describe, expect, it } from "vitest";
import {
	type DispatcherSnapshot,
	dispatchActiveSession,
} from "../persistence/active-session-dispatcher.js";

describe("dispatchActiveSession — five-state truth table", () => {
	it("Row 1 — no active pointer → #/start, no-active-pointer, needsMint true", () => {
		const snapshot: DispatcherSnapshot = {
			activeSessionId: null,
			// loadResult is irrelevant when activeSessionId is null, but must be valid
			loadResult: { kind: "none" },
		};
		const verdict = dispatchActiveSession(snapshot);
		expect(verdict.route).toBe("#/start");
		expect(verdict.reason).toBe("no-active-pointer");
		expect(verdict.needsMint).toBe(true);
	});

	it("Row 2 — ok load result → #/game, populated, needsMint false", () => {
		const snapshot: DispatcherSnapshot = {
			activeSessionId: "0xABCD",
			loadResult: {
				kind: "ok",
				// biome-ignore lint/suspicious/noExplicitAny: minimal stub for type check
				state: {} as any,
				sessionId: "0xABCD",
				createdAt: "2024-01-01T00:00:00.000Z",
				lastSavedAt: "2024-01-01T00:00:00.000Z",
				epoch: 1,
			},
		};
		const verdict = dispatchActiveSession(snapshot);
		expect(verdict.route).toBe("#/game");
		expect(verdict.reason).toBe("populated");
		expect(verdict.needsMint).toBe(false);
	});

	it("Row 3 — none load result → #/start, empty, needsMint false", () => {
		const snapshot: DispatcherSnapshot = {
			activeSessionId: "0xABCD",
			loadResult: { kind: "none" },
		};
		const verdict = dispatchActiveSession(snapshot);
		expect(verdict.route).toBe("#/start");
		expect(verdict.reason).toBe("empty");
		expect(verdict.needsMint).toBe(false);
	});

	it("Row 4 — broken load result → #/sessions, broken, needsMint false", () => {
		const snapshot: DispatcherSnapshot = {
			activeSessionId: "0xABCD",
			loadResult: { kind: "broken", sessionId: "0xABCD" },
		};
		const verdict = dispatchActiveSession(snapshot);
		expect(verdict.route).toBe("#/sessions");
		expect(verdict.reason).toBe("broken");
		expect(verdict.needsMint).toBe(false);
	});

	it("Row 5 — version-mismatch load result → #/sessions, version-mismatch, needsMint false", () => {
		const snapshot: DispatcherSnapshot = {
			activeSessionId: "0xABCD",
			loadResult: { kind: "version-mismatch", sessionId: "0xABCD" },
		};
		const verdict = dispatchActiveSession(snapshot);
		expect(verdict.route).toBe("#/sessions");
		expect(verdict.reason).toBe("version-mismatch");
		expect(verdict.needsMint).toBe(false);
	});
});
