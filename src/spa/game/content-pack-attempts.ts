import type { ValidationError } from "./content-pack-validation.js";

export const ATTEMPTS_STORAGE_KEY = "hi-blue:debug/content-pack-attempts";

export const ATTEMPTS_RING_SIZE = 50;

const ATTEMPTS_ENVELOPE_VERSION = 1;

const FAILED_ATTEMPT_LOG_PREFIX = "[content-pack:attempt]";

export type AttemptOutcome = "ok" | "validation-failed" | "hard-error";

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
		if (parsed.v !== ATTEMPTS_ENVELOPE_VERSION) return [];
		return Array.isArray(parsed.records) ? parsed.records : [];
	} catch {
		return [];
	}
}

function persistToStorage(records: AttemptRecord[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		const envelope: StorageEnvelope = { v: ATTEMPTS_ENVELOPE_VERSION, records };
		localStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(envelope));
	} catch {}
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

export function recordContentPackAttempt(input: {
	op: "single" | "dual";
	attempt: number;
	outcome: AttemptOutcome;
	errorMessage?: string;
	validationErrors?: ValidationError[];
	rawLength?: number;
}): void {
	if (!__DEV__) return;
	installDevtoolsAccessor();

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
		console.warn(FAILED_ATTEMPT_LOG_PREFIX, record);
	}
}

export function getContentPackAttempts(): AttemptRecord[] {
	return [...getRing()];
}

export function clearContentPackAttempts(): void {
	ringInMemory = [];
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.removeItem(ATTEMPTS_STORAGE_KEY);
		} catch {}
	}
}

export function __resetContentPackAttemptsForTests(): void {
	ringInMemory = undefined;
}

function installDevtoolsAccessor(): void {
	if (typeof window === "undefined") return;
	const w = window as unknown as {
		__contentPackAttempts?: () => AttemptRecord[];
	};
	if (w.__contentPackAttempts === undefined) {
		w.__contentPackAttempts = getContentPackAttempts;
	}
}
