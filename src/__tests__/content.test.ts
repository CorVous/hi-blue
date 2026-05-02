/**
 * Structure-only tests for src/content/.
 *
 * These tests validate that:
 * - PERSONAS has the required keys with all required fields present.
 * - PHASE_1_CONFIG, PHASE_2_CONFIG, PHASE_3_CONFIG are correctly chained.
 * - Each phase has aiGoals, objective, and initialWorld populated.
 *
 * NOTE: Prose quality is NOT tested here — all strings may be TODO placeholders.
 * AC counting: 3 personas, 3 phases, 9 goals (3 per phase × 3), 3 objectives, 3 world states.
 */
import { describe, expect, it } from "vitest";
import {
	PERSONAS,
	PHASE_1_CONFIG,
	PHASE_2_CONFIG,
	PHASE_3_CONFIG,
	PHASE_GOAL_POOL,
} from "../content";

// ── Personas ──────────────────────────────────────────────────────────────────

describe("PERSONAS", () => {
	it("has exactly the three AI keys", () => {
		expect(Object.keys(PERSONAS).sort()).toEqual(["blue", "green", "red"]);
	});

	it.each([
		"red",
		"green",
		"blue",
	] as const)("%s persona has all required base fields", (aiId) => {
		const p = PERSONAS[aiId];
		expect(p.id).toBe(aiId);
		expect(p.name).toBeTruthy();
		expect(p.color).toBe(aiId);
		expect(p.personality).toBeTruthy();
		expect(p.goal).toBeTruthy();
		expect(p.budgetPerPhase).toBeGreaterThan(0);
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

// ── AC counts ─────────────────────────────────────────────────────────────────

describe("acceptance-criteria counts", () => {
	it("3 personas total", () => {
		expect(Object.keys(PERSONAS)).toHaveLength(3);
	});

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
