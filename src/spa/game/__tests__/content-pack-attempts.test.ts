import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetContentPackAttemptsForTests,
	ATTEMPTS_RING_SIZE,
	ATTEMPTS_STORAGE_KEY,
	clearContentPackAttempts,
	getContentPackAttempts,
	recordContentPackAttempt,
} from "../content-pack-attempts.js";
import type { ValidationError } from "../content-pack-provider.js";

const sampleValidationError: ValidationError = {
	entityId: "decoy-0",
	field: "examineDescription",
	rule: "verb-of-activation",
	message: "Decoy decoy-0: must NOT contain use-cue keyword 'lever'",
	retryUnit: { kind: "decoy", phaseIndex: 0, decoyId: "decoy-0" },
};

describe("content-pack-attempts recorder", () => {
	beforeEach(() => {
		localStorage.clear();
		__resetContentPackAttemptsForTests();
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("records a successful single-pack attempt without console.warn", () => {
		recordContentPackAttempt({
			op: "single",
			attempt: 0,
			outcome: "ok",
			rawLength: 1234,
		});

		const records = getContentPackAttempts();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			op: "single",
			attempt: 0,
			outcome: "ok",
			rawLength: 1234,
		});
		expect(console.warn).not.toHaveBeenCalled();
	});

	it("records a validation-failed attempt with flattened errors and warns", () => {
		recordContentPackAttempt({
			op: "dual",
			attempt: 1,
			outcome: "validation-failed",
			validationErrors: [sampleValidationError],
			rawLength: 4567,
		});

		const records = getContentPackAttempts();
		expect(records[0]?.validationErrors).toEqual([
			{
				retryUnitKind: "decoy",
				rule: "verb-of-activation",
				entityId: "decoy-0",
				field: "examineDescription",
			},
		]);
		expect(console.warn).toHaveBeenCalledOnce();
		const [prefix, payload] = (console.warn as ReturnType<typeof vi.fn>).mock
			.calls[0] as [string, { outcome: string }];
		expect(prefix).toBe("[content-pack:attempt]");
		expect(payload.outcome).toBe("validation-failed");
	});

	it("records a hard-error attempt with the error message", () => {
		recordContentPackAttempt({
			op: "single",
			attempt: 2,
			outcome: "hard-error",
			errorMessage: "content-pack JSON parse failed: <truncated>",
		});

		const records = getContentPackAttempts();
		expect(records[0]?.outcome).toBe("hard-error");
		expect(records[0]?.errorMessage).toContain("JSON parse failed");
	});

	it("trims the ring to ATTEMPTS_RING_SIZE", () => {
		for (let i = 0; i < ATTEMPTS_RING_SIZE + 10; i++) {
			recordContentPackAttempt({
				op: "single",
				attempt: i % 3,
				outcome: "ok",
			});
		}

		const records = getContentPackAttempts();
		expect(records).toHaveLength(ATTEMPTS_RING_SIZE);
	});

	it("persists records across in-memory cache resets via localStorage", () => {
		recordContentPackAttempt({
			op: "dual",
			attempt: 0,
			outcome: "ok",
		});

		__resetContentPackAttemptsForTests();

		const records = getContentPackAttempts();
		expect(records).toHaveLength(1);
		expect(records[0]?.op).toBe("dual");
	});

	it("clearContentPackAttempts wipes memory and localStorage", () => {
		recordContentPackAttempt({ op: "single", attempt: 0, outcome: "ok" });
		clearContentPackAttempts();

		expect(getContentPackAttempts()).toEqual([]);
		expect(localStorage.getItem(ATTEMPTS_STORAGE_KEY)).toBeNull();
	});

	it("ignores a storage envelope with the wrong schema version", () => {
		localStorage.setItem(
			ATTEMPTS_STORAGE_KEY,
			JSON.stringify({ v: 999, records: [{ ts: 1, op: "single" }] }),
		);
		__resetContentPackAttemptsForTests();

		expect(getContentPackAttempts()).toEqual([]);
	});

	it("installs window.__contentPackAttempts after first record in __DEV__", () => {
		recordContentPackAttempt({ op: "single", attempt: 0, outcome: "ok" });

		const accessor = (
			window as unknown as { __contentPackAttempts?: () => unknown[] }
		).__contentPackAttempts;
		expect(typeof accessor).toBe("function");
		expect(accessor?.()).toHaveLength(1);
	});
});
