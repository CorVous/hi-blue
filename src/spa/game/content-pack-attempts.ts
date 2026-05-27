/**
 * content-pack-attempts.ts
 *
 * Ring-buffer recorder for content-pack LLM-generation attempts. Every outer
 * retry inside BrowserContentPackProvider (single + dual) records one
 * AttemptRecord here. Production gives the LLM only OUTER_BUDGET=3 attempts,
 * so when a real bootstrap dies with "exhausted retry budget" the only
 * forensic surface is what we capture here.
 *
 * Recorder is a no-op outside __DEV__ — adds zero overhead and zero
 * localStorage writes in production builds.
 *
 * Records persist to localStorage so a failed bootstrap remains debuggable
 * after the player reloads. Pull them in devtools via
 *   `window.__contentPackAttempts()` or
 *   `localStorage.getItem("hi-blue:debug/content-pack-attempts")`.
 */

import type { ValidationError } from "./content-pack-provider.js";

/** localStorage key for the attempt ring buffer. */
export const ATTEMPTS_STORAGE_KEY = "hi-blue:debug/content-pack-attempts";

/** Max records retained in the ring buffer. */
export const ATTEMPTS_RING_SIZE = 50;

/** Storage envelope version — bump on shape change. */
const SCHEMA_VERSION = 1;

/**
 * Console prefix for grep-ability. Failed attempts emit a structured
 * `console.warn` with this prefix so playtesters can copy-paste their
 * devtools log straight into a bug report.
 */
const CONSOLE_PREFIX = "[content-pack:attempt]";

export type AttemptOutcome = "ok" | "validation-failed" | "hard-error";

/** Compact per-error summary safe to persist (no raw LLM prose). */
export interface AttemptValidationError {
	retryUnitKind: string;
	rule: string;
	entityId: string;
	field: string;
}

export interface AttemptRecord {
	ts: number;
	op: "single" | "dual";
	attempt: number;
	outcome: AttemptOutcome;
	errorMessage?: string;
	validationErrors?: AttemptValidationError[];
	/**
	 * Length of the raw assistant text. Useful to spot truncated outputs
	 * (validation-failed + tiny rawLength = JSON was cut off mid-stream).
	 */
	rawLength?: number;
}

interface StorageEnvelope {
	v: number;
	records: AttemptRecord[];
}

let ringInMemory: AttemptRecord[] | undefined;

function loadFromStorage(): AttemptRecord[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(ATTEMPTS_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as StorageEnvelope;
		if (parsed.v !== SCHEMA_VERSION) return [];
		return Array.isArray(parsed.records) ? parsed.records : [];
	} catch {
		return [];
	}
}

function persistToStorage(records: AttemptRecord[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		const envelope: StorageEnvelope = { v: SCHEMA_VERSION, records };
		localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(envelope));
	} catch {
		// localStorage may throw on quota / private-mode — drop silently.
	}
}

function getRing(): AttemptRecord[] {
	if (ringInMemory === undefined) ringInMemory = loadFromStorage();
	return ringInMemory;
}

function summariseError(err: ValidationError): AttemptValidationError {
	return {
		retryUnitKind: err.retryUnit.kind,
		rule: err.rule,
		entityId: err.entityId,
		field: err.field,
	};
}

/**
 * Record a generation attempt. No-op when __DEV__ is false.
 *
 * The caller passes ValidationError[] directly when outcome ===
 * "validation-failed"; this module flattens them into the persisted shape.
 */
export function recordContentPackAttempt(input: {
	op: "single" | "dual";
	attempt: number;
	outcome: AttemptOutcome;
	errorMessage?: string;
	validationErrors?: ValidationError[];
	rawLength?: number;
}): void {
	if (!__DEV__) return;
	installWindowAccessor();

	const record: AttemptRecord = {
		ts: Date.now(),
		op: input.op,
		attempt: input.attempt,
		outcome: input.outcome,
	};
	if (input.errorMessage !== undefined)
		record.errorMessage = input.errorMessage;
	if (input.validationErrors !== undefined) {
		record.validationErrors = input.validationErrors.map(summariseError);
	}
	if (input.rawLength !== undefined) record.rawLength = input.rawLength;

	const ring = getRing();
	ring.push(record);
	while (ring.length > ATTEMPTS_RING_SIZE) ring.shift();
	persistToStorage(ring);

	if (record.outcome !== "ok") {
		console.warn(CONSOLE_PREFIX, record);
	}
}

/** Return a defensive copy of the recorded attempts. */
export function getContentPackAttempts(): AttemptRecord[] {
	return [...getRing()];
}

/** Drop all recorded attempts (memory + localStorage). */
export function clearContentPackAttempts(): void {
	ringInMemory = [];
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.removeItem(ATTEMPTS_STORAGE_KEY);
		} catch {
			// ignore
		}
	}
}

/** Test-only: reset the in-memory cache so the next read re-loads from storage. */
export function __resetContentPackAttemptsForTests(): void {
	ringInMemory = undefined;
}

/**
 * Expose a devtools-console accessor in __DEV__ browser sessions so
 * playtesters can run `__contentPackAttempts()` after a failed bootstrap.
 *
 * Installed lazily on first record/read so a vitest run (where `__DEV__`
 * isn't defined until the setup file's `beforeEach` fires) doesn't crash
 * at module import.
 */
function installWindowAccessor(): void {
	if (typeof window === "undefined") return;
	const w = window as unknown as {
		__contentPackAttempts?: () => AttemptRecord[];
	};
	if (w.__contentPackAttempts === undefined) {
		w.__contentPackAttempts = getContentPackAttempts;
	}
}
