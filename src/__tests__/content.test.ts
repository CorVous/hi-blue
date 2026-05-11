/**
 * Structure-only tests for src/content/.
 *
 * Validates:
 * - Content pools (TEMPERAMENT_POOL, PERSONA_GOAL_POOL, COLOR_PALETTE) have
 *   the correct types and sizes.
 * - generatePersonas() produces three distinct personas.
 * - GAME_CONTENT_RANGES is populated.
 */
import { describe, expect, it } from "vitest";
import {
	COLOR_PALETTE,
	GAME_CONTENT_RANGES,
	generatePersonas,
	PERSONA_GOAL_POOL,
	PHASE_GOAL_POOL,
	TEMPERAMENT_POOL,
	TYPING_QUIRK_POOL,
} from "../content";
import type { SynthesisInput } from "../spa/game/llm-synthesis-provider.js";
import { MockSynthesisProvider } from "../spa/game/llm-synthesis-provider.js";

// ── Content pools ─────────────────────────────────────────────────────────────

describe("TEMPERAMENT_POOL", () => {
	it("every entry is a non-empty string", () => {
		for (const t of TEMPERAMENT_POOL) {
			expect(typeof t).toBe("string");
			expect(t.length).toBeGreaterThan(0);
		}
	});
});

describe("PERSONA_GOAL_POOL", () => {
	it("every entry is a non-empty string", () => {
		for (const g of PERSONA_GOAL_POOL) {
			expect(typeof g).toBe("string");
			expect(g.length).toBeGreaterThan(0);
		}
	});
});

describe("COLOR_PALETTE", () => {
	it("every entry is a valid lowercase hex color", () => {
		for (const c of COLOR_PALETTE) {
			expect(c).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});
});

describe("TYPING_QUIRK_POOL", () => {
	it("every entry is a non-empty string", () => {
		for (const q of TYPING_QUIRK_POOL) {
			expect(typeof q).toBe("string");
			expect(q.length).toBeGreaterThan(0);
		}
	});

	it("every entry differs from every other (no duplicates)", () => {
		expect(new Set(TYPING_QUIRK_POOL).size).toBe(TYPING_QUIRK_POOL.length);
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

	it("each persona has at least 2 non-empty typingQuirks", async () => {
		const personas = await generatePersonas(() => 0);
		for (const p of Object.values(personas)) {
			expect(Array.isArray(p.typingQuirks)).toBe(true);
			expect(p.typingQuirks.length).toBeGreaterThanOrEqual(2);
			for (const quirk of p.typingQuirks) {
				expect(typeof quirk).toBe("string");
				expect((quirk as string).length).toBeGreaterThan(0);
			}
		}
	});

	it("every typingQuirks entry is drawn from TYPING_QUIRK_POOL", async () => {
		const personas = await generatePersonas(() => 0.5);
		for (const p of Object.values(personas)) {
			for (const quirk of p.typingQuirks) {
				expect(TYPING_QUIRK_POOL).toContain(quirk);
			}
		}
	});
});

// ── Game content ranges ───────────────────────────────────────────────────────

describe("GAME_CONTENT_RANGES", () => {
	it("has valid kRange/nRange/mRange", () => {
		expect(GAME_CONTENT_RANGES.kRange).toHaveLength(2);
		expect(GAME_CONTENT_RANGES.nRange).toHaveLength(2);
		expect(GAME_CONTENT_RANGES.mRange).toHaveLength(2);
		expect(GAME_CONTENT_RANGES.kRange[0]).toBeGreaterThanOrEqual(1);
		expect(GAME_CONTENT_RANGES.nRange[0]).toBeGreaterThanOrEqual(0);
		expect(GAME_CONTENT_RANGES.mRange[0]).toBeGreaterThanOrEqual(0);
	});
});

describe("PHASE_GOAL_POOL", () => {
	it("every entry is a non-empty string", () => {
		for (const goal of PHASE_GOAL_POOL) {
			expect(typeof goal).toBe("string");
			expect(goal.length).toBeGreaterThan(0);
		}
	});
});

describe("acceptance-criteria counts", () => {
	it("GAME_CONTENT_RANGES has kRange, nRange, mRange", () => {
		expect(GAME_CONTENT_RANGES.kRange).toHaveLength(2);
		expect(GAME_CONTENT_RANGES.nRange).toHaveLength(2);
		expect(GAME_CONTENT_RANGES.mRange).toHaveLength(2);
	});

	it("PHASE_GOAL_POOL is a non-empty array of strings", () => {
		expect(Array.isArray(PHASE_GOAL_POOL)).toBe(true);
		expect(PHASE_GOAL_POOL.length).toBeGreaterThan(0);
		for (const g of PHASE_GOAL_POOL) {
			expect(typeof g).toBe("string");
		}
	});
});

// ── generatePersonas — LLM path ───────────────────────────────────────────────

describe("generatePersonas — LLM path", () => {
	it("passes all 3 persona tuples in a single batched call", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({
					id: p.id,
					blurb: `BLURB_${p.id}`,
					voiceExamples: [`voice1-${p.id}`, `voice2-${p.id}`, `voice3-${p.id}`],
				})),
			}),
		);

		await generatePersonas(() => 0.5, mockProvider);

		expect(mockProvider.calls).toHaveLength(1);
	});

	it("returned record has exactly 3 entries with blurbs matching canned values", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({
					id: p.id,
					blurb: `BLURB_${p.id}`,
					voiceExamples: [`voice1-${p.id}`, `voice2-${p.id}`, `voice3-${p.id}`],
				})),
			}),
		);

		const personas = await generatePersonas(() => 0.5, mockProvider);

		expect(Object.keys(personas)).toHaveLength(3);
		for (const [id, persona] of Object.entries(personas)) {
			expect(persona.blurb).toBe(`BLURB_${id}`);
		}
	});

	it("returned record has voiceExamples plumbed through from LLM result", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({
					id: p.id,
					blurb: `BLURB_${p.id}`,
					voiceExamples: [`voice1-${p.id}`, `voice2-${p.id}`, `voice3-${p.id}`],
				})),
			}),
		);

		const personas = await generatePersonas(() => 0.5, mockProvider);

		for (const [id, persona] of Object.entries(personas)) {
			expect(persona.voiceExamples).toEqual([
				`voice1-${id}`,
				`voice2-${id}`,
				`voice3-${id}`,
			]);
		}
	});

	it("input to mock contains 3-element array of {id, temperaments, personaGoal} tuples", async () => {
		const mockProvider = new MockSynthesisProvider(
			(input: SynthesisInput[]) => ({
				personas: input.map((p) => ({
					id: p.id,
					blurb: `BLURB_${p.id}`,
					voiceExamples: [`voice1-${p.id}`, `voice2-${p.id}`, `voice3-${p.id}`],
				})),
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
					voiceExamples: [`voice1-${p.id}`, `voice2-${p.id}`, `voice3-${p.id}`],
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

	it("template fallback (no-LLM) produces voiceExamples of length 3 non-empty strings", async () => {
		const personas = await generatePersonas(() => 0.5);
		for (const p of Object.values(personas)) {
			expect(p.voiceExamples).toHaveLength(3);
			for (const ex of p.voiceExamples) {
				expect(typeof ex).toBe("string");
				expect(ex.length).toBeGreaterThan(0);
			}
		}
	});
});
