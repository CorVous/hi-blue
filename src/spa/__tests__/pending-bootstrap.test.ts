import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiId, AiPersona, ContentPack } from "../game/types.js";
import { STATIC_CONTENT_PACKS } from "./fixtures/static-content-packs.js";
import { STATIC_PERSONAS } from "./fixtures/static-personas.js";

const STATIC_CONTENT_PACK = STATIC_CONTENT_PACKS[0];
if (!STATIC_CONTENT_PACK) {
	throw new Error("STATIC_CONTENT_PACKS[0] is undefined");
}

const STATIC_CONTENT: {
	packsA: ContentPack[];
	packsB: ContentPack[];
} = {
	packsA: [STATIC_CONTENT_PACK],
	packsB: [STATIC_CONTENT_PACK],
};

async function awaitIgnoringRejection(
	promise: Promise<unknown>,
): Promise<void> {
	try {
		await promise;
	} catch {}
}

describe("pending-bootstrap.ts", () => {
	afterEach(async () => {
		const { clearPendingBootstrap } = await import(
			"../game/pending-bootstrap.js"
		);
		clearPendingBootstrap();
	});

	it("getCachedPersonas() returns the resolved personas after personasPromise settles", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getCachedPersonas } = await import(
			"../game/pending-bootstrap.js"
		);

		const pending = startBootstrap();

		expect(getCachedPersonas()).toBeUndefined();

		await pending.personasPromise;

		const cached = getCachedPersonas();
		expect(cached).toBeDefined();
		expect(cached).toEqual(STATIC_PERSONAS);
	});

	it("getCachedPersonas() returns personas even when status is 'failed' (content packs failed)", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.reject(
					new Error("content pack generation failed"),
				),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.reject(
					new Error("content pack generation failed"),
				),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getCachedPersonas } = await import(
			"../game/pending-bootstrap.js"
		);

		const pending = startBootstrap();

		await pending.personasPromise;
		await awaitIgnoringRejection(pending.contentPacksPromise);

		expect(pending.status).toBe("failed");
		const cached = getCachedPersonas();
		expect(cached).toEqual(STATIC_PERSONAS);
	});

	it("restartContentPacks() reuses cached personas without re-generating", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getCachedPersonas, restartContentPacks } =
			await import("../game/pending-bootstrap.js");

		const initial = startBootstrap();
		await initial.personasPromise;

		const initialPersonas = getCachedPersonas();
		expect(initialPersonas).toBeDefined();

		const restarted = restartContentPacks();

		expect(getCachedPersonas()).toBe(initialPersonas);

		const restartedPersonas = await restarted.personasPromise;
		expect(restartedPersonas).toBe(initialPersonas);
	});

	it("restartContentPacks() falls back to startBootstrap when no personas cached", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.reject(new Error("persona synthesis failed")),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getCachedPersonas, restartContentPacks } =
			await import("../game/pending-bootstrap.js");

		const initial = startBootstrap();

		await awaitIgnoringRejection(initial.personasPromise);

		expect(getCachedPersonas()).toBeUndefined();

		const restarted = restartContentPacks();

		await awaitIgnoringRejection(restarted.personasPromise);
	});

	it("clearPendingBootstrap() wipes cached personas", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getCachedPersonas, clearPendingBootstrap } =
			await import("../game/pending-bootstrap.js");

		const pending = startBootstrap();
		await pending.personasPromise;

		expect(getCachedPersonas()).toBeDefined();

		clearPendingBootstrap();

		expect(getCachedPersonas()).toBeUndefined();
	});

	it("recordPendingCall sets callName + startedAtMs", async () => {
		vi.resetModules();

		const { recordPendingCall, getPendingCallMeta } = await import(
			"../game/pending-bootstrap.js"
		);

		const beforeMs = Date.now();
		recordPendingCall("persona-synthesis");
		const afterMs = Date.now();

		const meta = getPendingCallMeta();
		expect(meta.callName).toBe("persona-synthesis");
		expect(meta.startedAtMs).toBeGreaterThanOrEqual(beforeMs);
		expect(meta.startedAtMs).toBeLessThanOrEqual(afterMs);
		expect(meta.retryCount).toBe(0);
		expect(meta.retryMax).toBe(3);
		expect(meta.lastError).toBeUndefined();
	});

	it("recordPendingRetry increments retryCount and stores lastError", async () => {
		vi.resetModules();

		const { recordPendingCall, recordPendingRetry, getPendingCallMeta } =
			await import("../game/pending-bootstrap.js");

		recordPendingCall("content-pack");

		recordPendingRetry(new Error("502 upstream"));

		const meta = getPendingCallMeta();
		expect(meta.callName).toBe("content-pack");
		expect(meta.retryCount).toBe(1);
		expect(meta.lastError).toBe("502 upstream");

		recordPendingRetry(new Error("503 service unavailable"));

		const meta2 = getPendingCallMeta();
		expect(meta2.retryCount).toBe(2);
		expect(meta2.lastError).toBe("503 service unavailable");
	});

	it("clearPendingBootstrap clears meta", async () => {
		vi.resetModules();

		const { recordPendingCall, clearPendingBootstrap, getPendingCallMeta } =
			await import("../game/pending-bootstrap.js");

		recordPendingCall("persona-synthesis");
		expect(getPendingCallMeta().callName).toBe("persona-synthesis");

		clearPendingBootstrap();

		const meta = getPendingCallMeta();
		expect(meta.callName).toBeUndefined();
		expect(meta.startedAtMs).toBeUndefined();
		expect(meta.retryCount).toBeUndefined();
		expect(meta.lastError).toBeUndefined();
	});

	it("startBootstrap calls recordPendingCall('persona-synthesis') synchronously", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getPendingCallMeta } = await import(
			"../game/pending-bootstrap.js"
		);

		startBootstrap();

		const meta = getPendingCallMeta();
		expect(meta.callName).toBe("persona-synthesis");
		expect(meta.startedAtMs).toBeDefined();
		expect(meta.retryCount).toBe(0);
	});

	it("startBootstrap calls recordPendingCall('content-pack') when personas resolve", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getPendingCallMeta } = await import(
			"../game/pending-bootstrap.js"
		);

		const pending = startBootstrap();

		expect(getPendingCallMeta().callName).toBe("persona-synthesis");

		await pending.personasPromise;

		expect(getPendingCallMeta().callName).toBe("content-pack");
	});

	it("startBootstrap calls recordPendingRetry when personas fail", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.reject(new Error("persona generation failed")),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, getPendingCallMeta } = await import(
			"../game/pending-bootstrap.js"
		);

		const pending = startBootstrap();

		await awaitIgnoringRejection(pending.personasPromise);

		const meta = getPendingCallMeta();
		expect(meta.retryCount).toBe(1);
		expect(meta.lastError).toBe("persona generation failed");
	});

	it("restartContentPacks calls recordPendingCall('content-pack') synchronously", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, restartContentPacks, getPendingCallMeta } =
			await import("../game/pending-bootstrap.js");

		const initial = startBootstrap();
		await initial.personasPromise;

		const { recordPendingCall } = await import("../game/pending-bootstrap.js");
		recordPendingCall("placeholder");

		restartContentPacks();

		const meta = getPendingCallMeta();
		expect(meta.callName).toBe("content-pack");
		expect(meta.startedAtMs).toBeDefined();
	});

	it("restartContentPacks calls recordPendingRetry when content packs fail", async () => {
		vi.doMock("../game/bootstrap.js", () => ({
			generateNewGameAssetsSplit: () => ({
				personasPromise: Promise.resolve(STATIC_PERSONAS),
				contentPacksPromise: Promise.resolve(STATIC_CONTENT),
			}),
			generateContentPacksOnlySplit: (_personas: Record<AiId, AiPersona>) => ({
				personasPromise: Promise.resolve(_personas),
				contentPacksPromise: Promise.reject(
					new Error("content pack generation failed"),
				),
			}),
		}));
		vi.resetModules();

		const { startBootstrap, restartContentPacks, getPendingCallMeta } =
			await import("../game/pending-bootstrap.js");

		const initial = startBootstrap();
		await initial.personasPromise;

		const restarted = restartContentPacks();

		await awaitIgnoringRejection(restarted.contentPacksPromise);

		const meta = getPendingCallMeta();
		expect(meta.retryCount).toBe(1);
		expect(meta.lastError).toBe("content pack generation failed");
	});
});
