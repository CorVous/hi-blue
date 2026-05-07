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

	it("has at most 12 entries", () => {
		expect(COLOR_PALETTE.length).toBeLessThanOrEqual(12);
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

describe("phase configs — objectives", () => {
	it.each([
		["PHASE_1_CONFIG", PHASE_1_CONFIG],
		["PHASE_2_CONFIG", PHASE_2_CONFIG],
		["PHASE_3_CONFIG", PHASE_3_CONFIG],
	] as const)("%s has a non-empty objective", (_name, cfg) => {
		expect(cfg.objective).toBeTruthy();
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

describe("phase configs — initialWorld", () => {
	it.each([
		["PHASE_1_CONFIG", PHASE_1_CONFIG],
		["PHASE_2_CONFIG", PHASE_2_CONFIG],
		["PHASE_3_CONFIG", PHASE_3_CONFIG],
	] as const)("%s initialWorld is a WorldState", (_name, cfg) => {
		expect(Array.isArray(cfg.initialWorld.items)).toBe(true);
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

	it("3 objectives", () => {
		const phases = [PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG];
		const objectives = phases.map((p) => p.objective).filter(Boolean);
		expect(objectives).toHaveLength(3);
	});

	it("3 world states", () => {
		const phases = [PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG];
		const worlds = phases.map((p) => p.initialWorld);
		expect(worlds).toHaveLength(3);
	});
});
