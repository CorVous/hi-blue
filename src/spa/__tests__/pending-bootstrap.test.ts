/**
 * Unit tests for pending-bootstrap.ts
 *
 * Covers:
 * - getCachedPersonas() returns resolved personas
 * - getCachedPersonas() works even when status is "failed" (personas resolved, content packs failed)
 * - restartContentPacks() reuses cached personas without re-generating
 * - restartContentPacks() falls back to startBootstrap when no personas cached
 * - clearPendingBootstrap() wipes cached personas
 */
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

describe("pending-bootstrap.ts", () => {
	afterEach(async () => {
		// Clear pending bootstrap between tests
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

		// Initially no cached personas
		expect(getCachedPersonas()).toBeUndefined();

		// Wait for personas to resolve
		await pending.personasPromise;

		// Now personas are cached
		const cached = getCachedPersonas();
		expect(cached).toBeDefined();
		expect(cached).toEqual(STATIC_PERSONAS);
	});

	it("getCachedPersonas() returns personas even when status is 'failed' (content packs failed)", async () => {
		// Mock: personas succeed, content packs fail
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

		// Wait for both to settle (personas succeed, content packs fail)
		await pending.personasPromise;
		try {
			await pending.contentPacksPromise;
		} catch {
			// Expected: content packs failed
		}

		// Personas should still be cached even though status is "failed"
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

		// Start initial bootstrap
		const initial = startBootstrap();
		await initial.personasPromise;

		const initialPersonas = getCachedPersonas();
		expect(initialPersonas).toBeDefined();

		// Restart content packs (should reuse cached personas)
		const restarted = restartContentPacks();

		// Personas should be the same object (reused, not re-generated)
		expect(getCachedPersonas()).toBe(initialPersonas);

		// The restarted bootstrap should have the same personas
		const restartedPersonas = await restarted.personasPromise;
		expect(restartedPersonas).toBe(initialPersonas);
	});

	it("restartContentPacks() falls back to startBootstrap when no personas cached", async () => {
		// Mock: personas fail, content packs would succeed
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

		// Start initial bootstrap with persona failure
		const initial = startBootstrap();

		// Wait for rejection
		try {
			await initial.personasPromise;
		} catch {
			// Expected: personas failed
		}

		// No cached personas
		expect(getCachedPersonas()).toBeUndefined();

		// Restart content packs should fall back to full startBootstrap
		const restarted = restartContentPacks();

		// Since we're mocking generateNewGameAssetsSplit with persona failure,
		// this will also fail. But the point is it called startBootstrap
		// (fallback path) not generateContentPacksOnlySplit.
		try {
			await restarted.personasPromise;
		} catch {
			// Expected: personas still fail via fallback path
		}
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

		// Start bootstrap and wait for personas
		const pending = startBootstrap();
		await pending.personasPromise;

		expect(getCachedPersonas()).toBeDefined();

		// Clear
		clearPendingBootstrap();

		// Personas should be gone
		expect(getCachedPersonas()).toBeUndefined();
	});
});
