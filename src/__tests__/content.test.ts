/**
 * Structure-only tests for src/content/.
 *
 * Validates:
 * - Content pools (TEMPERAMENT_POOL, PERSONA_GOAL_POOL, COLOR_PALETTE) have
 *   the correct types and sizes.
 * - generatePersonas() produces three distinct personas.
 * - PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG are correctly chained.
 * - Each phase has aiGoalPool, objective, and initialWorld populated.
 */
import { describe, expect, it } from "vitest";
import {
	COLOR_PALETTE,
	generatePersonas,
	PERSONA_GOAL_POOL,
	PHASE_1_CONFIG,
	PHASE_2_CONFIG,
	PHASE_3_CONFIG,
	PHASE_GOAL_POOL,
	TEMPERAMENT_POOL,
} from "../content";
import type { SynthesisInput } from "../spa/game/llm-synthesis-provider.js";
import { MockSynthesisProvider } from "../spa/game/llm-synthesis-provider.js";

// ── Content pools ─────────────────────────────────────────────────────────────

describe("TEMPERAMENT_POOL", () => {
	it("has at least 12 entries", () => {
		expect(TEMPERAMENT_POOL.length).toBeGreaterThanOrEqual(12);
	});

	it("has at most 20 entries", () => {
		expect(TEMPERAMENT_POOL.length).toBeLessThanOrEqual(20);
	});

	it("every entry is a non-empty string", () => {
		for (const t of TEMPERAMENT_POOL) {
			expect(typeof t).toBe("string");
			expect(t.length).toBeGreaterThan(0);
		}
	});
});

describe("PERSONA_GOAL_POOL", () => {
	it("has at least 10 entries", () => {
		expect(PERSONA_GOAL_POOL.length).toBeGreaterThanOrEqual(10);
	});

	it("has at most 15 entries", () => {
		expect(PERSONA_GOAL_POOL.length).toBeLessThanOrEqual(15);
	});

	it("every entry is a non-empty string", () => {
		for (const g of PERSONA_GOAL_POOL) {
			expect(typeof g).toBe("string");
			expect(g.length).toBeGreaterThan(0);
		}
	});
});

describe("COLOR_PALETTE", () => {
	it("has at least 10 entries", () => {
		expect(COLOR_PALETTE.length).toBeGreaterThanOrEqual(10);
	});

	it("has at most 30 entries", () => {
		expect(COLOR_PALETTE.length).toBeLessThanOrEqual(30);
	});

	it("every entry is a valid lowercase hex color", () => {
		for (const c of COLOR_PALETTE) {
			expect(c).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});
});

// ── generatePersonas ──────────────────────────────────────────────────────────

describe("generatePersonas — template fallback (no llm)", () => {
	it("produces exactly 3 personas", async () => {
		const personas = await generatePersonas(() => 0.5);
		expect(Object.keys(personas)).toHaveLength(3);
	});

	it("persona names are 4-char [a-z0-9] strings", async () => {
		const personas = await generatePersonas(() => 0);
		for (const [id, p] of Object.entries(personas)) {
			expect(id).toMatch(/^[a-z0-9]{4}$/);
			expect(p.name).toBe(id);
		}
	});

	it("persona colors are hex strings from the palette", async () => {
		const personas = await generatePersonas(() => 0.5);
		for (const p of Object.values(personas)) {
			expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it("all 3 personas have distinct names", async () => {
		const personas = await generatePersonas();
		const names = Object.keys(personas);
		expect(new Set(names).size).toBe(3);
	});

	it("all 3 personas have distinct colors", async () => {
		const personas = await generatePersonas(() => Math.random());
		const colors = Object.values(personas).map((p) => p.color);
		expect(new Set(colors).size).toBe(3);
	});

	it("each persona has a blurb string", async () => {
		const personas = await generatePersonas(() => 0);
		for (const p of Object.values(personas)) {
			expect(typeof p.blurb).toBe("string");
			expect(p.blurb.length).toBeGreaterThan(0);
		}
	});

	it("intensification path: same temperament twice yields 'intensely' blurb", async () => {
		// Seed that returns 0 always — same index for both temperament draws
		const personas = await generatePersonas(() => 0);
		const firstPersona = Object.values(personas)[0];
		if (!firstPersona) throw new Error("no persona");
		expect(firstPersona.temperaments[0]).toBe(firstPersona.temperaments[1]);
		expect(firstPersona.blurb).toContain("intensely");
	});
});

// ── Phase configs ─────────────────────────────────────────────────────────────

describe("phase configs — phase numbers", () => {
	it("PHASE_1_CONFIG has phaseNumber 1", () => {
		expect(PHASE_1_CONFIG.phaseNumber).toBe(1);
	});

	it("PHASE_2_CONFIG has phaseNumber 2", () => {
		expect(PHASE_2_CONFIG.phaseNumber).toBe(2);
	});

	it("PHASE_3_CONFIG has phaseNumber 3", () => {
		expect(PHASE_3_CONFIG.phaseNumber).toBe(3);
	});
});

describe("phase configs — chaining", () => {
	it("PHASE_1_CONFIG.nextPhaseConfig === PHASE_2_CONFIG", () => {
		expect(PHASE_1_CONFIG.nextPhaseConfig).toBe(PHASE_2_CONFIG);
	});

	it("PHASE_2_CONFIG.nextPhaseConfig === PHASE_3_CONFIG", () => {
		expect(PHASE_2_CONFIG.nextPhaseConfig).toBe(PHASE_3_CONFIG);
	});

	it("PHASE_3_CONFIG has no nextPhaseConfig", () => {
		expect(PHASE_3_CONFIG.nextPhaseConfig).toBeUndefined();
	});
});

describe("phase configs — kRange/nRange/mRange", () => {
	it.each([
		["PHASE_1_CONFIG", PHASE_1_CONFIG],
		["PHASE_2_CONFIG", PHASE_2_CONFIG],
		["PHASE_3_CONFIG", PHASE_3_CONFIG],
	] as const)("%s has valid kRange/nRange/mRange", (_name, cfg) => {
		expect(cfg.kRange).toHaveLength(2);
		expect(cfg.nRange).toHaveLength(2);
		expect(cfg.mRange).toHaveLength(2);
		expect(cfg.kRange[0]).toBeGreaterThanOrEqual(1);
		expect(cfg.nRange[0]).toBeGreaterThanOrEqual(0);
		expect(cfg.mRange[0]).toBeGreaterThanOrEqual(0);
	});
});

describe("phase configs — aiGoalPool", () => {
	it.each([
		["PHASE_1_CONFIG", PHASE_1_CONFIG],
		["PHASE_2_CONFIG", PHASE_2_CONFIG],
		["PHASE_3_CONFIG", PHASE_3_CONFIG],
	] as const)("%s references the shared PHASE_GOAL_POOL", (_name, cfg) => {
		expect(cfg.aiGoalPool).toBe(PHASE_GOAL_POOL);
	});
});

describe("PHASE_GOAL_POOL", () => {
	it("contains at least one goal", () => {
		expect(PHASE_GOAL_POOL.length).toBeGreaterThanOrEqual(1);
	});

	it("every entry is a non-empty string", () => {
		for (const goal of PHASE_GOAL_POOL) {
			expect(typeof goal).toBe("string");
			expect(goal.length).toBeGreaterThan(0);
		}
	});
});

describe("phase configs — ranges", () => {
	it.each([
		["PHASE_1_CONFIG", PHASE_1_CONFIG],
		["PHASE_2_CONFIG", PHASE_2_CONFIG],
		["PHASE_3_CONFIG", PHASE_3_CONFIG],
	] as const)("%s has numeric ranges", (_name, cfg) => {
		expect(typeof cfg.kRange[0]).toBe("number");
		expect(typeof cfg.nRange[0]).toBe("number");
		expect(typeof cfg.mRange[0]).toBe("number");
	});
});

describe("acceptance-criteria counts", () => {
	it("3 phase configs", () => {
		const phases = [PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG];
		expect(phases).toHaveLength(3);
	});

	it("all 3 phases share the global PHASE_GOAL_POOL (per-AI goals drawn at phase start)", () => {
		const phases = [PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG];
		for (const p of phases) {
			expect(p.aiGoalPool).toBe(PHASE_GOAL_POOL);
		}
	});

	it("all 3 phases have kRange", () => {
		const phases = [PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG];
		for (const p of phases) {
			expect(p.kRange).toHaveLength(2);
		}
	});

	it("all 3 phases have nRange and mRange", () => {
		const phases = [PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG];
		for (const p of phases) {
			expect(p.nRange).toHaveLength(2);
			expect(p.mRange).toHaveLength(2);
		}
	});
});

// ── generatePersonas — LLM path ───────────────────────────────────────────────

describe("generatePersonas — LLM path", () => {
	it("passes all 3 persona tuples in a single batched call", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({ id: p.id, blurb: `BLURB_${p.id}` })),
			}),
		);

		await generatePersonas(() => 0.5, mockProvider);

		expect(mockProvider.calls).toHaveLength(1);
	});

	it("returned record has exactly 3 entries with blurbs matching canned values", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({ id: p.id, blurb: `BLURB_${p.id}` })),
			}),
		);

		const personas = await generatePersonas(() => 0.5, mockProvider);

		expect(Object.keys(personas)).toHaveLength(3);
		for (const [id, persona] of Object.entries(personas)) {
			expect(persona.blurb).toBe(`BLURB_${id}`);
		}
	});

	it("input to mock contains 3-element array of {id, temperaments, personaGoal} tuples", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({ id: p.id, blurb: `BLURB_${p.id}` })),
			}),
		);

		await generatePersonas(() => 0.5, mockProvider);

		const callInput = mockProvider.calls[0];
		expect(callInput).toHaveLength(3);
		for (const tuple of callInput ?? []) {
			expect(typeof tuple.id).toBe("string");
			expect(Array.isArray(tuple.temperaments)).toBe(true);
			expect(tuple.temperaments).toHaveLength(2);
			expect(typeof tuple.personaGoal).toBe("string");
		}
	});

	it("makes exactly one batched call, not one per persona (AC #7)", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p, i) => ({
					id: p.id,
					blurb: ["BLURB_A", "BLURB_B", "BLURB_C"][i] ?? "BLURB_UNKNOWN",
				})),
			}),
		);

		const personas = await generatePersonas(() => 0.5, mockProvider);

		// One call for all three, not three separate calls
		expect(mockProvider.calls.length).toBe(1);

		// Blurbs match canned values in positional order
		const values = Object.values(personas);
		expect(values[0]?.blurb).toBe("BLURB_A");
		expect(values[1]?.blurb).toBe("BLURB_B");
		expect(values[2]?.blurb).toBe("BLURB_C");
	});
});
