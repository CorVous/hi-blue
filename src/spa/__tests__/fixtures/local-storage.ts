import { vi } from "vitest";
import type { GameState, ObjectiveType } from "../../game/types";
import { STATIC_CONTENT_PACKS } from "./static-content-packs";
import { STATIC_PERSONAS } from "./static-personas";

export function makeLocalStorageStub(initialData: Record<string, string> = {}) {
	const store: Record<string, string> = { ...initialData };
	return {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		get length() {
			return Object.keys(store).length;
		},
		key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
		_store: store,
	};
}

export type LocalStorageStub = ReturnType<typeof makeLocalStorageStub>;

export function installLocalStorageStub(
	initialData: Record<string, string> = {},
): LocalStorageStub {
	const stub = makeLocalStorageStub(initialData);
	vi.stubGlobal("localStorage", stub);
	return stub;
}

export async function withLocalStorage<T>(
	stub: LocalStorageStub,
	run: () => T | Promise<T>,
): Promise<T> {
	const prev = globalThis.localStorage;
	Object.defineProperty(globalThis, "localStorage", {
		value: stub,
		writable: true,
		configurable: true,
	});
	try {
		return await run();
	} finally {
		Object.defineProperty(globalThis, "localStorage", {
			value: prev,
			writable: true,
			configurable: true,
		});
	}
}

export interface SeedSessionOptions {
	objectiveTypes?: ObjectiveType[];
	buildState?: () => GameState | Promise<GameState>;
}

async function buildStaticSessionState(
	objectiveTypes: ObjectiveType[] | undefined,
): Promise<GameState> {
	const { buildSessionFromAssets } = await import("../../game/bootstrap.js");
	return buildSessionFromAssets({
		personas: STATIC_PERSONAS,
		contentPacksA: STATIC_CONTENT_PACKS,
		contentPacksB: STATIC_CONTENT_PACKS,
		...(objectiveTypes ? { objectiveTypes } : {}),
	}).getState();
}

export async function seedSessionInStub(
	stub: LocalStorageStub,
	opts: SeedSessionOptions = {},
): Promise<void> {
	const { mintAndActivateNewSession, saveActiveSession } = await import(
		"../../persistence/session-storage.js"
	);
	const buildState =
		opts.buildState ?? (() => buildStaticSessionState(opts.objectiveTypes));
	await withLocalStorage(stub, async () => {
		mintAndActivateNewSession();
		saveActiveSession(await buildState());
	});
}
