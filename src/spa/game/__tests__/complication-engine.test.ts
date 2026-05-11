/**
 * Tests for the Complication Engine (issue #296).
 *
 * tickComplication(game, rng) → ComplicationResult | null
 *
 * Pure, deterministic module. Tests use array-backed seededRng helpers.
 * Prior art: win-condition.test.ts, engine.test.ts
 */
import { describe, expect, it } from "vitest";
import {
	applyComplicationResult,
	decrementComplicationCountdown,
	tickComplication,
} from "../complication-engine.js";
import { DEFAULT_LANDMARKS } from "../direction.js";
import { createGame, getActivePhase, startPhase } from "../engine.js";
import type {
	ActiveComplication,
	AiId,
	AiPersona,
	ComplicationSchedule,
	ContentPack,
	GameState,
	GridPosition,
	PersonaSpatialState,
	PhaseState,
	ToolName,
	WorldEntity,
	WorldState,
} from "../types.js";

// ── RNG helper ────────────────────────────────────────────────────────────────

/**
 * Returns a closure that yields each value in `values` in order.
 * Throws if the array is exhausted (catches unintended extra rng reads).
 */
function seededRng(values: number[]): () => number {
	let idx = 0;
	return () => {
		if (idx >= values.length) {
			throw new Error(
				`seededRng: exhausted after ${values.length} reads (call #${idx + 1})`,
			);
		}
		// biome-ignore lint/style/noNonNullAssertion: bounded by check above
		return values[idx++]!;
	};
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "test goal",
		blurb: "test blurb",
		typingQuirks: ["fragments", "ALL CAPS"],
		voiceExamples: ["Now.", "BURN IT.", "Soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "test goal",
		blurb: "test blurb",
		typingQuirks: ["ellipses", "no contractions"],
		voiceExamples: ["OK...", "That is not balanced.", "One more."],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "test goal",
		blurb: "test blurb",
		typingQuirks: ["lowercase only", "fragments"],
		voiceExamples: ["sure.", "if you say so.", "fine."],
	},
};

const AI_IDS: AiId[] = ["red", "green", "cyan"];

function makePersonaSpatial(
	positions: Record<AiId, GridPosition> = {},
): Record<AiId, PersonaSpatialState> {
	const defaults: Record<AiId, GridPosition> = {
		red: { row: 0, col: 0 },
		green: { row: 0, col: 1 },
		cyan: { row: 0, col: 2 },
	};
	const merged = { ...defaults, ...positions };
	const result: Record<AiId, PersonaSpatialState> = {};
	for (const [id, pos] of Object.entries(merged)) {
		result[id] = { position: pos, facing: "north" };
	}
	return result;
}

function makePhase(overrides: Partial<PhaseState> = {}): PhaseState {
	const personaSpatial = overrides.personaSpatial ?? makePersonaSpatial();
	const world: WorldState = overrides.world ?? { entities: [] };

	const budgets: Record<AiId, { remaining: number; total: number }> = {};
	const conversationLogs: Record<AiId, []> = {};
	for (const id of AI_IDS) {
		budgets[id] = { remaining: 0.5, total: 0.5 };
		conversationLogs[id] = [];
	}

	const contentPack: ContentPack = {
		phaseNumber: 1,
		setting: "test",
		weather: "clear",
		timeOfDay: "day",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: personaSpatial,
	};

	const complicationSchedule: ComplicationSchedule = {
		countdown: 3,
		settingShiftFired: false,
	};

	return {
		phaseNumber: 1,
		setting: "test",
		weather: "clear",
		timeOfDay: "day",
		contentPack,
		aiGoals: { red: "goal", green: "goal", cyan: "goal" },
		round: 5,
		world,
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		chatLockouts: new Map(),
		personaSpatial,
		complicationSchedule,
		activeComplications: [],
		...overrides,
	};
}

function makeGameStateAround(phase: PhaseState): GameState {
	return {
		currentPhase: 1,
		phases: [phase],
		personas: TEST_PERSONAS,
		isComplete: false,
		contentPacksA: [],
		contentPacksB: [],
		activePackId: "A",
	};
}

function makeObstacle(id: string, pos: GridPosition): WorldEntity {
	return {
		id,
		kind: "obstacle",
		name: id,
		examineDescription: `A ${id}.`,
		holder: pos,
	};
}

// ── Countdown decrement ───────────────────────────────────────────────────────

describe("tickComplication — countdown > 0: returns null", () => {
	it("returns null when countdown is 3", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(game, seededRng([]));
		expect(result).toBeNull();
	});

	it("returns null when countdown is 2", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 2, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(game, seededRng([]));
		expect(result).toBeNull();
	});

	it("returns null when countdown is 1", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 1, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(game, seededRng([]));
		expect(result).toBeNull();
	});

	it("does not call rng when countdown is > 0 (seededRng with empty array would throw)", () => {
		// If rng were called, seededRng([]) would throw — passing means no rng calls happened
		const phase = makePhase({
			complicationSchedule: { countdown: 5, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// Should NOT throw
		expect(() => tickComplication(game, seededRng([]))).not.toThrow();
	});
});

describe("decrementComplicationCountdown", () => {
	it("decrements countdown by 1", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const updated = decrementComplicationCountdown(game);
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.complicationSchedule.countdown).toBe(2);
	});

	it("does not alter settingShiftFired", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: true },
		});
		const game = makeGameStateAround(phase);
		const updated = decrementComplicationCountdown(game);
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.complicationSchedule.settingShiftFired).toBe(true);
	});

	it("does not alter activeComplications", () => {
		const active: ActiveComplication[] = [
			{ kind: "chat_lockout", target: "red", resolveAtRound: 8 },
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: false },
			activeComplications: active,
		});
		const game = makeGameStateAround(phase);
		const updated = decrementComplicationCountdown(game);
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.activeComplications).toEqual(active);
	});
});

describe("applyComplicationResult — countdown reset", () => {
	it("resets countdown to exactly 5 when rng returns 0.0", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "weather_change" as const } };
		// rng=0.0 → floor(0.0 * 11) = 0 → 5 + 0 = 5
		const updated = applyComplicationResult(game, result, seededRng([0.0]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.complicationSchedule.countdown).toBe(5);
	});

	it("resets countdown to exactly 15 when rng returns just below 1.0", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "weather_change" as const } };
		// rng=0.9999 → floor(0.9999 * 11) = 10 → 5 + 10 = 15
		const updated = applyComplicationResult(game, result, seededRng([0.9999]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.complicationSchedule.countdown).toBe(15);
	});

	it("resets countdown to a value in [5, 15]", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "weather_change" as const } };
		for (const v of [0, 0.1, 0.5, 0.9, 0.9999]) {
			const updated = applyComplicationResult(game, result, seededRng([v]));
			const updatedPhase = getActivePhase(updated);
			expect(
				updatedPhase.complicationSchedule.countdown,
			).toBeGreaterThanOrEqual(5);
			expect(updatedPhase.complicationSchedule.countdown).toBeLessThanOrEqual(
				15,
			);
		}
	});
});

// ── Complication fires at countdown === 0 ─────────────────────────────────────

describe("tickComplication — fires when countdown is 0", () => {
	it("returns a non-null ComplicationResult when countdown is 0", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// rng needs to select a type AND reset countdown
		// Full pool has 6 types; rng[0]=0.0 → index 0 → weather_change
		// rng[1]=0.5 → countdown reset (some value in [5,15])
		const result = tickComplication(game, seededRng([0.0, 0.5]));
		expect(result).not.toBeNull();
	});

	it("draws weather_change when type-draw rng selects index 0 of the full pool", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// rng[0]=0.0 → index 0 of 6 → weather_change
		const result = tickComplication(game, seededRng([0.0, 0.5]));
		expect(result?.fired.kind).toBe("weather_change");
	});

	it("draws sysadmin_directive when type-draw selects index 1", () => {
		// makePhase has empty world → pool is 5 items (no obstacle_shift):
		// [weather_change(0), sysadmin_directive(1), tool_disable(2), chat_lockout(3), setting_shift(4)]
		// index 1 → sysadmin_directive: rng[0] in [1/5, 2/5) → use 0.2
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// rng[0]=0.2 → floor(0.2*5)=1 → sysadmin_directive, rng[1]=0.0 → target, rng[2]=0.5 → countdown
		const result = tickComplication(game, seededRng([0.2, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("sysadmin_directive");
	});

	it("draws chat_lockout when type-draw selects index 3 (5-item pool)", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool (no obstacle_shift): index 3 → chat_lockout
		// rng[0]=0.6 → floor(0.6*5)=3, rng[1]=0 → target, rng[2]=0 → duration=3, rng[3]=0.5 → countdown
		const result = tickComplication(game, seededRng([0.6, 0.0, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("chat_lockout");
	});

	it("draws setting_shift when type-draw selects the last index (5-item pool, index 4)", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: index 4 → setting_shift
		// rng[0]=0.82 → floor(0.82*5)=4 → setting_shift, rng[1]=0.5 for countdown
		const result = tickComplication(game, seededRng([0.82, 0.5]));
		expect(result?.fired.kind).toBe("setting_shift");
	});
});

// ── sysadmin_directive sub-draw ────────────────────────────────────────────────

describe("sysadmin_directive sub-draw", () => {
	it("carries a target AiId drawn from personaSpatial", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: rng[0]=0.2 → index 1 → sysadmin_directive; rng[1]=0.0 → first AI; rng[2]=0.5 → countdown
		const result = tickComplication(game, seededRng([0.2, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("sysadmin_directive");
		if (result?.fired.kind === "sysadmin_directive") {
			expect(AI_IDS).toContain(result.fired.target);
		}
	});
});

// ── chat_lockout sub-draw ──────────────────────────────────────────────────────

describe("chat_lockout sub-draw", () => {
	it("carries a target AiId and duration in [3, 5]", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: index 3 → chat_lockout: rng[0]=0.6
		const result = tickComplication(game, seededRng([0.6, 0.0, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("chat_lockout");
		if (result?.fired.kind === "chat_lockout") {
			expect(AI_IDS).toContain(result.fired.target);
			expect(result.fired.duration).toBeGreaterThanOrEqual(3);
			expect(result.fired.duration).toBeLessThanOrEqual(5);
		}
	});

	it("duration is exactly 3 when rng for duration returns 0.0", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: chat_lockout at index 3: rng[0]=0.6, target=0.0, duration=0.0 → 3+floor(0*3)=3
		const result = tickComplication(game, seededRng([0.6, 0.0, 0.0, 0.5]));
		if (result?.fired.kind === "chat_lockout") {
			expect(result.fired.duration).toBe(3);
		}
	});

	it("duration is exactly 5 when rng for duration returns just below 1.0", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: chat_lockout at index 3: rng[0]=0.6, target=0.0, duration=0.9999 → 3+floor(0.9999*3)=3+2=5
		const result = tickComplication(game, seededRng([0.6, 0.0, 0.9999, 0.5]));
		if (result?.fired.kind === "chat_lockout") {
			expect(result.fired.duration).toBe(5);
		}
	});
});

// ── Setting Shift exclusion ───────────────────────────────────────────────────

describe("Setting Shift exclusion", () => {
	it("excludes setting_shift when settingShiftFired is true", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: true },
		});
		const game = makeGameStateAround(phase);
		// Pool: no obstacle_shift (empty world), no setting_shift (fired) → 4 items:
		// [weather_change(0), sysadmin_directive(1), tool_disable(2), chat_lockout(3)]
		// rng[0]=0.9999 → floor(0.9999*4)=3 → chat_lockout (last item; NOT setting_shift)
		const result = tickComplication(game, seededRng([0.9999, 0.0, 0.0, 0.5]));
		// setting_shift should NOT be drawn
		expect(result?.fired.kind).not.toBe("setting_shift");
	});

	it("sets settingShiftFired=true in returned game state when setting_shift fires", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool (no obstacle_shift): index 4 → setting_shift
		// rng[0]=0.82 → floor(0.82*5)=4, rng[1]=0.5 → countdown
		const result = tickComplication(game, seededRng([0.82, 0.5]));
		expect(result?.fired.kind).toBe("setting_shift");
		// Apply result
		if (result) {
			const updated = applyComplicationResult(game, result, seededRng([0.5]));
			const updatedPhase = getActivePhase(updated);
			expect(updatedPhase.complicationSchedule.settingShiftFired).toBe(true);
		}
	});
});

// ── Obstacle Shift exclusion ──────────────────────────────────────────────────

describe("Obstacle Shift exclusion", () => {
	it("excludes obstacle_shift when world has zero obstacles", () => {
		// Ensure obstacle_shift is never returned when the pool is empty of obstacles
		const draws: string[] = [];
		for (let i = 0; i < 5; i++) {
			// Try each slot in a 5-item pool
			const v = i / 5;
			const r = tickComplication(
				makeGameStateAround(
					makePhase({
						complicationSchedule: { countdown: 0, settingShiftFired: false },
						world: { entities: [] },
					}),
				),
				seededRng([v, 0.0, 0.0, 0.5]),
			);
			if (r) draws.push(r.fired.kind);
		}
		expect(draws).not.toContain("obstacle_shift");
	});

	it("excludes obstacle_shift when every obstacle has all adjacent cells blocked by other obstacles or out-of-bounds", () => {
		// Corner obstacle at (0,0): only 2 in-bounds neighbors (south=1,0 and east=0,1).
		// Block both with obstacles. The corner obstacle now has NO valid shift targets.
		// South and east obstacles have their own neighbors, but they're only 2x2 blocking walls.
		// Actually, south obstacle at (1,0) can still move west(-OOB), east(1,1), south(2,0) → has valid.
		// So this scenario with obstacles blocking each other's valid moves needs all obstacles to be
		// completely boxed in. Let's use a simpler approach: fill a small "room" so all obstacles
		// are surrounded by out-of-bounds or other obstacles with no valid targets.
		//
		// Build a 3×3 block at (0,0)–(2,2), covering rows 0-2, cols 0-2 (9 obstacles):
		// Every obstacle at a corner or edge has at most 1 in-bounds/unoccupied neighbor.
		// Obstacle at (0,0): south=(1,0) blocked, east=(0,1) blocked → no free cells.
		// Obstacle at (1,1): all 4 neighbors occupied.
		// This is a valid "fully blocked" setup for a 3×3 obstacle square.
		const entities: WorldEntity[] = [];
		for (let r = 0; r <= 2; r++) {
			for (let c = 0; c <= 2; c++) {
				entities.push(makeObstacle(`obs_${r}_${c}`, { row: r, col: c }));
			}
		}
		// Now every obstacle's adjacent cells (south of row-2 obstacles go to row 3 which is free!)
		// So bottom row obstacles (row=2) can shift south to row=3.
		// We need to also fill rows 3-4 or use a different approach.
		//
		// Simpler: use a single obstacle at (0,0) and use PERSONAS + OOB to block both neighbors.
		// (0,0) has in-bounds neighbors: south (1,0) and east (0,1).
		// Block both with additional obstacles.
		// BUT those obstacles at (1,0) and (0,1) would have their own unoccupied neighbors.
		//
		// The only way to have NO obstacle with a valid adjacent cell is to tile the entire
		// 5×5 grid with obstacles. Let's use that extreme: fill all 25 cells.
		const fullBlockEntities: WorldEntity[] = [];
		for (let r = 0; r < 5; r++) {
			for (let c = 0; c < 5; c++) {
				fullBlockEntities.push(
					makeObstacle(`obs_${r}_${c}`, { row: r, col: c }),
				);
			}
		}
		const draws: string[] = [];
		for (let i = 0; i < 5; i++) {
			const v = i / 5;
			const r = tickComplication(
				makeGameStateAround(
					makePhase({
						complicationSchedule: { countdown: 0, settingShiftFired: false },
						world: { entities: fullBlockEntities },
					}),
				),
				seededRng([v, 0.0, 0.0, 0.5]),
			);
			if (r) draws.push(r.fired.kind);
		}
		expect(draws).not.toContain("obstacle_shift");
	});

	it("excludes obstacle_shift when the only obstacle's neighbours are occupied by personas", () => {
		// Obstacle at corner (0,0): only adjacent cells are south(1,0) and east(0,1).
		// Two personas block both; the corner obstacle has no valid shift target.
		const cornerObstacle = makeObstacle("corner_obs", { row: 0, col: 0 });
		const corneredPersonas: Record<AiId, PersonaSpatialState> = {
			red: { position: { row: 1, col: 0 }, facing: "north" }, // south of (0,0)
			green: { position: { row: 0, col: 1 }, facing: "west" }, // east of (0,0)
			cyan: { position: { row: 2, col: 0 }, facing: "north" }, // elsewhere
		};
		const draws: string[] = [];
		for (let i = 0; i < 5; i++) {
			const v = i / 5;
			const r = tickComplication(
				makeGameStateAround(
					makePhase({
						complicationSchedule: { countdown: 0, settingShiftFired: false },
						world: { entities: [cornerObstacle] },
						personaSpatial: corneredPersonas,
					}),
				),
				seededRng([v, 0.0, 0.0, 0.5]),
			);
			if (r) draws.push(r.fired.kind);
		}
		expect(draws).not.toContain("obstacle_shift");
	});

	it("includes obstacle_shift when one obstacle has exactly one valid adjacent empty cell", () => {
		// Obstacle at (0,0): neighbours are south(1,0) and east(0,1). Place persona at (1,0), leave (0,1) free.
		const obs = makeObstacle("obs", { row: 0, col: 0 });
		const personaSpatial: Record<AiId, PersonaSpatialState> = {
			red: { position: { row: 1, col: 0 }, facing: "north" },
			green: { position: { row: 4, col: 4 }, facing: "south" },
			cyan: { position: { row: 3, col: 3 }, facing: "east" },
		};
		// Pool: [weather_change, sysadmin_directive, tool_disable, obstacle_shift, chat_lockout, setting_shift]
		// Draw index 3 → obstacle_shift: rng[0] = 3/6 + ε = 0.501
		// obstacle_shift sub-draw: 1 obstacle × 1 valid direction (east): rng[1] = 0.0 → tuple[0]
		// countdown reset: rng[2] = 0.5
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			world: { entities: [obs] },
			personaSpatial,
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(game, seededRng([0.501, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("obstacle_shift");
	});

	it("drawn obstacle_shift carries fromCell and toCell that are 4-cardinal adjacent and in-bounds", () => {
		const obs = makeObstacle("obs", { row: 2, col: 2 });
		const personaSpatial = makePersonaSpatial({
			red: { row: 0, col: 0 },
			green: { row: 0, col: 1 },
			cyan: { row: 0, col: 2 },
		});
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			world: { entities: [obs] },
			personaSpatial,
		});
		const game = makeGameStateAround(phase);
		// Draw index 3 (obstacle_shift): rng[0]=0.501
		const result = tickComplication(game, seededRng([0.501, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("obstacle_shift");
		if (result?.fired.kind === "obstacle_shift") {
			const { fromCell, toCell } = result.fired;
			const rowDiff = Math.abs(fromCell.row - toCell.row);
			const colDiff = Math.abs(fromCell.col - toCell.col);
			expect(rowDiff + colDiff).toBe(1); // exactly 4-adjacent
			expect(toCell.row).toBeGreaterThanOrEqual(0);
			expect(toCell.row).toBeLessThan(5);
			expect(toCell.col).toBeGreaterThanOrEqual(0);
			expect(toCell.col).toBeLessThan(5);
		}
	});
});

// ── Tool Disable exclusion ─────────────────────────────────────────────────────

describe("Tool Disable exclusion", () => {
	it("falls back to a different complication kind when every (daemon, tool) pair is already disabled", () => {
		// Build activeComplications with all possible (daemon, tool) pairs
		const toolNames: ToolName[] = [
			"pick_up",
			"put_down",
			"give",
			"use",
			"go",
			"look",
			"examine",
			"message",
		];
		const activeComplications: ActiveComplication[] = [];
		for (const aiId of AI_IDS) {
			for (const tool of toolNames) {
				activeComplications.push({ kind: "tool_disable", target: aiId, tool });
			}
		}
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		// 5-item pool (no obstacle_shift): index 2 → tool_disable
		// rng[0]=0.4 → floor(0.4*5)=2 → tool_disable → pairs exhausted
		// → re-draw from 4-item fallback pool (no obstacle_shift, no tool_disable)
		// rng[1]=0.0 → index 0 → weather_change, rng[2]=0.5 → countdown
		const result = tickComplication(game, seededRng([0.4, 0.0, 0.5]));
		expect(result?.fired.kind).not.toBe("tool_disable");
	});

	it("excludes a (daemon, tool) pair already present in activeComplications", () => {
		// Only red+pick_up is already disabled. With 3 daemons × 8 tools = 24 pairs,
		// 1 excluded, 23 valid pairs remain.
		const activeComplications: ActiveComplication[] = [
			{ kind: "tool_disable", target: "red", tool: "pick_up" },
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		// 5-item pool (no obstacle_shift): index 2 → tool_disable: rng[0]=0.4
		// Sub-draw: rng[1]=0.0 → first valid pair (not red+pick_up), rng[2]=0.5 → countdown
		const result = tickComplication(game, seededRng([0.4, 0.0, 0.5]));
		if (result?.fired.kind === "tool_disable") {
			expect(
				result.fired.target === "red" && result.fired.tool === "pick_up",
			).toBe(false);
		}
	});

	it("permits a (daemon, tool) pair when the same daemon has a different tool disabled", () => {
		const activeComplications: ActiveComplication[] = [
			{ kind: "tool_disable", target: "red", tool: "pick_up" },
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: tool_disable at index 2, rng[0]=0.4
		const result = tickComplication(game, seededRng([0.4, 0.0, 0.5]));
		// tool_disable should still be drawable (just not red+pick_up)
		expect(result?.fired.kind).toBe("tool_disable");
	});

	it("permits a (daemon, tool) pair when a different daemon has the same tool disabled", () => {
		const activeComplications: ActiveComplication[] = [
			{ kind: "tool_disable", target: "green", tool: "pick_up" },
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: tool_disable at index 2, rng[0]=0.4
		// rng[1]=0.0 → first valid pair (red+pick_up since green+pick_up is excluded)
		const result = tickComplication(game, seededRng([0.4, 0.0, 0.5]));
		expect(result?.fired.kind).toBe("tool_disable");
		if (result?.fired.kind === "tool_disable") {
			// It may draw red+pick_up since only green+pick_up is excluded
			expect(
				result.fired.target === "green" && result.fired.tool === "pick_up",
			).toBe(false);
		}
	});
});

// ── Persistent vs transient appends ───────────────────────────────────────────

describe("applyComplicationResult — activeComplications appends", () => {
	it("appends ActiveComplication for sysadmin_directive", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = {
			fired: { kind: "sysadmin_directive" as const, target: "red" as AiId },
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		const added = updatedPhase.activeComplications.find(
			(c) => c.kind === "sysadmin_directive",
		);
		expect(added).toBeDefined();
		if (added?.kind === "sysadmin_directive") {
			expect(added.target).toBe("red");
		}
	});

	it("appends ActiveComplication for tool_disable", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = {
			fired: {
				kind: "tool_disable" as const,
				target: "cyan" as AiId,
				tool: "go" as ToolName,
			},
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		const added = updatedPhase.activeComplications.find(
			(c) => c.kind === "tool_disable",
		);
		expect(added).toBeDefined();
		if (added?.kind === "tool_disable") {
			expect(added.target).toBe("cyan");
			expect(added.tool).toBe("go");
		}
	});

	it("appends ActiveComplication for chat_lockout with resolveAtRound = phase.round + duration", () => {
		const phase = makePhase({ round: 5 });
		const game = makeGameStateAround(phase);
		const result = {
			fired: {
				kind: "chat_lockout" as const,
				target: "green" as AiId,
				duration: 4,
			},
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		const added = updatedPhase.activeComplications.find(
			(c) => c.kind === "chat_lockout",
		);
		expect(added).toBeDefined();
		if (added?.kind === "chat_lockout") {
			expect(added.target).toBe("green");
			expect(added.resolveAtRound).toBe(9); // round 5 + duration 4
		}
	});

	it("does NOT append to activeComplications for weather_change", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "weather_change" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.activeComplications).toHaveLength(0);
	});

	it("does NOT append to activeComplications for obstacle_shift", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = {
			fired: {
				kind: "obstacle_shift" as const,
				obstacleId: "obs1",
				fromCell: { row: 0, col: 0 },
				toCell: { row: 0, col: 1 },
			},
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.activeComplications).toHaveLength(0);
	});

	it("does NOT append to activeComplications for setting_shift", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.activeComplications).toHaveLength(0);
	});

	it("sets settingShiftFired=true in schedule when result is setting_shift", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.complicationSchedule.settingShiftFired).toBe(true);
	});
});

// ── Setting Shift A/B pack swap (issue #302) ──────────────────────────────────

describe("applyComplicationResult — setting_shift swaps active pack", () => {
	const PACK_A: ContentPack = {
		phaseNumber: 1,
		setting: "neon arcade",
		weather: "clear",
		timeOfDay: "night",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: makePersonaSpatial(),
	};

	const PACK_B: ContentPack = {
		phaseNumber: 1,
		setting: "sun-baked salt flat",
		weather: "hot",
		timeOfDay: "day",
		objectivePairs: [],
		interestingObjects: [],
		obstacles: [],
		landmarks: DEFAULT_LANDMARKS,
		aiStarts: makePersonaSpatial(),
	};

	function makeGameWithDualPacks(): GameState {
		const phase = makePhase({ contentPack: PACK_A, setting: PACK_A.setting });
		return {
			currentPhase: 1,
			phases: [phase],
			personas: TEST_PERSONAS,
			isComplete: false,
			contentPacksA: [PACK_A],
			contentPacksB: [PACK_B],
			activePackId: "A",
		};
	}

	it("sets activePackId to 'B' when setting_shift fires", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		expect(updated.activePackId).toBe("B");
	});

	it("updates phase.contentPack to the B-side pack after setting_shift", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.contentPack.setting).toBe("sun-baked salt flat");
	});

	it("updates phase.setting to the B-side pack's setting string", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.setting).toBe("sun-baked salt flat");
	});

	it("leaves world entity positions unchanged after setting_shift", () => {
		const entities: WorldEntity[] = [
			makeObstacle("box", { row: 2, col: 3 }),
			makeObstacle("crate", { row: 1, col: 1 }),
		];
		const phase = makePhase({
			contentPack: PACK_A,
			setting: PACK_A.setting,
			world: { entities },
		});
		const game: GameState = {
			currentPhase: 1,
			phases: [phase],
			personas: TEST_PERSONAS,
			isComplete: false,
			contentPacksA: [PACK_A],
			contentPacksB: [PACK_B],
			activePackId: "A",
		};
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		expect(updatedPhase.world.entities).toHaveLength(2);
		expect(updatedPhase.world.entities[0]?.holder).toEqual({ row: 2, col: 3 });
		expect(updatedPhase.world.entities[1]?.holder).toEqual({ row: 1, col: 1 });
	});

	it("appends a broadcast entry to every daemon's conversationLog", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = getActivePhase(updated);
		for (const aiId of AI_IDS) {
			const log = updatedPhase.conversationLogs[aiId] ?? [];
			const broadcast = log.find((e) => e.kind === "broadcast");
			expect(broadcast).toBeDefined();
			if (broadcast?.kind === "broadcast") {
				expect(broadcast.content).toContain("sun-baked salt flat");
			}
		}
	});

	it("does NOT change activePackId when a non-shift complication fires", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "weather_change" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		expect(updated.activePackId).toBe("A");
	});
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe("determinism", () => {
	it("same game state and same rng seed sequence produces the same ComplicationResult", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		// 5-item pool: 0.5*5=2 → tool_disable; then 0.0 for pair draw; no countdown draw needed (tickComplication doesn't reset)
		const r1 = tickComplication(game, seededRng([0.5, 0.0]));
		const r2 = tickComplication(game, seededRng([0.5, 0.0]));
		expect(r1).toEqual(r2);
	});
});

// ── startPhase initialisation (engine.ts addendum) ───────────────────────────

describe("startPhase — complicationSchedule initialisation", () => {
	it("initialises countdown to a value in [1, 5]", () => {
		// startPhase uses: 1 + Math.floor(rng() * 5).
		// Repeat across several Math.random samples to surface out-of-range values.
		for (let i = 0; i < 6; i++) {
			const game = createGame(TEST_PERSONAS);
			const phase = getActivePhase(
				startPhase(game, {
					phaseNumber: 1,
					kRange: [1, 1],
					nRange: [1, 1],
					mRange: [0, 0],
					aiGoalPool: ["goal"],
					budgetPerAi: 0.5,
				}),
			);
			expect(phase.complicationSchedule.countdown).toBeGreaterThanOrEqual(1);
			expect(phase.complicationSchedule.countdown).toBeLessThanOrEqual(5);
			expect(phase.complicationSchedule.settingShiftFired).toBe(false);
		}
	});

	it("initialises activeComplications to an empty array", () => {
		const game = createGame(TEST_PERSONAS);
		const phase = getActivePhase(
			startPhase(game, {
				phaseNumber: 1,
				kRange: [1, 1],
				nRange: [1, 1],
				mRange: [0, 0],
				aiGoalPool: ["goal"],
				budgetPerAi: 0.5,
			}),
		);
		expect(phase.activeComplications).toEqual([]);
	});
});
