import { describe, expect, it } from "vitest";
import {
	applyComplicationResult,
	decrementComplicationCountdown,
	isPlayerChatLockedOut,
	resolveExpiredChatLockouts,
	tickComplication,
} from "../complication-engine.js";
import { startGame } from "../engine.js";
import type {
	ActiveComplication,
	AiId,
	AiPersona,
	ComplicationSchedule,
	GameState,
	GridPosition,
	PersonaSpatialState,
	ToolName,
	WorldEntity,
	WorldState,
} from "../types.js";
import { makeTestPack } from "./fixtures/make-test-pack.js";

const POOL_PICK = {
	sysadminDirective: 0.2,
	toolDisable: 0.4,
	chatLockout: 0.6,
	settingShift: 0.82,
	obstacleShiftInSixKindPool: 0.501,
	lastKind: 0.9999,
} as const;

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
		result[id] = { position: pos };
	}
	return result;
}

function makePhase(overrides: Partial<GameState> = {}): GameState {
	const personaSpatial = overrides.personaSpatial ?? makePersonaSpatial();
	const world: WorldState = overrides.world ?? { entities: [] };

	const budgets: Record<AiId, { remaining: number; total: number }> = {};
	const conversationLogs: Record<AiId, []> = {};
	for (const id of AI_IDS) {
		budgets[id] = { remaining: 0.5, total: 0.5 };
		conversationLogs[id] = [];
	}

	const contentPack = makeTestPack([], {
		setting: "test",
		weather: "clear",
		timeOfDay: "day",
		wallName: "wall",
		aiStarts: personaSpatial,
	});

	const complicationSchedule: ComplicationSchedule = {
		countdown: 3,
		settingShiftFired: false,
	};

	return {
		personas: TEST_PERSONAS,
		isComplete: false,
		setting: "test",
		weather: "clear",
		timeOfDay: "day",
		contentPack,
		round: 5,
		world,
		budgets,
		conversationLogs,
		lockedOut: new Set(),
		personaSpatial,
		complicationSchedule,
		activeComplications: [],
		contentPacksA: [],
		contentPacksB: [],
		activePackId: "A" as const,
		objectives: [],
		...overrides,
	};
}

function makeGameStateAround(phase: GameState): GameState {
	return phase;
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
		const phase = makePhase({
			complicationSchedule: { countdown: 5, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
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
		const updatedPhase = updated;
		expect(updatedPhase.complicationSchedule.countdown).toBe(2);
	});

	it("does not alter settingShiftFired", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: true },
		});
		const game = makeGameStateAround(phase);
		const updated = decrementComplicationCountdown(game);
		const updatedPhase = updated;
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
		const updatedPhase = updated;
		expect(updatedPhase.activeComplications).toEqual(active);
	});
});

describe("tickComplication — fires when countdown is 0", () => {
	it("returns a non-null ComplicationResult when countdown is 0", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(game, seededRng([0.0, 0.5]));
		expect(result).not.toBeNull();
	});

	it("draws weather_change when type-draw rng selects index 0 of the full pool", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(game, seededRng([0.0, 0.5]));
		expect(result?.fired.kind).toBe("weather_change");
		if (result?.fired.kind === "weather_change") {
			expect(result.fired.weather).not.toBe("clear");
			expect(result.fired.weather).toMatch(/^[A-Z]|^[a-z]/);
		}
	});

	it("draws sysadmin_directive when type-draw selects index 1", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.sysadminDirective, 0.0, 0.5]),
		);
		expect(result?.fired.kind).toBe("sysadmin_directive");
	});

	it("draws chat_lockout when type-draw selects index 3 (5-item pool)", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.chatLockout, 0.0, 0.0, 0.5]),
		);
		expect(result?.fired.kind).toBe("chat_lockout");
	});

	it("draws setting_shift when type-draw selects the last index (5-item pool, index 4)", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.settingShift, 0.5]),
		);
		expect(result?.fired.kind).toBe("setting_shift");
	});
});

describe("sysadmin_directive sub-draw", () => {
	it("carries a target AiId drawn from personaSpatial", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.sysadminDirective, 0.0, 0.5]),
		);
		expect(result?.fired.kind).toBe("sysadmin_directive");
		if (result?.fired.kind === "sysadmin_directive") {
			expect(AI_IDS).toContain(result.fired.target);
		}
	});
});

describe("chat_lockout sub-draw", () => {
	it("carries a target AiId and duration in [3, 5]", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.chatLockout, 0.0, 0.0, 0.5]),
		);
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
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.chatLockout, 0.0, 0.0, 0.5]),
		);
		if (result?.fired.kind === "chat_lockout") {
			expect(result.fired.duration).toBe(3);
		}
	});

	it("duration is exactly 5 when rng for duration returns just below 1.0", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.chatLockout, 0.0, 0.9999, 0.5]),
		);
		if (result?.fired.kind === "chat_lockout") {
			expect(result.fired.duration).toBe(5);
		}
	});
});

describe("Setting Shift exclusion", () => {
	it("excludes setting_shift when settingShiftFired is true", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: true },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.lastKind, 0.0, 0.0, 0.5]),
		);
		expect(result?.fired.kind).not.toBe("setting_shift");
	});

	it("sets settingShiftFired=true in returned game state when setting_shift fires", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.settingShift, 0.5]),
		);
		expect(result?.fired.kind).toBe("setting_shift");
		if (result) {
			const updated = applyComplicationResult(game, result, seededRng([0.5]));
			const updatedPhase = updated;
			expect(updatedPhase.complicationSchedule.settingShiftFired).toBe(true);
		}
	});
});

describe("Obstacle Shift exclusion", () => {
	it("excludes obstacle_shift when world has zero obstacles", () => {
		const draws: string[] = [];
		for (let i = 0; i < 5; i++) {
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
		const entities: WorldEntity[] = [];
		for (let r = 0; r <= 2; r++) {
			for (let c = 0; c <= 2; c++) {
				entities.push(makeObstacle(`obs_${r}_${c}`, { row: r, col: c }));
			}
		}
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
		const cornerObstacle = makeObstacle("corner_obs", { row: 0, col: 0 });
		const corneredPersonas: Record<AiId, PersonaSpatialState> = {
			red: { position: { row: 1, col: 0 } },
			green: { position: { row: 0, col: 1 } },
			cyan: { position: { row: 2, col: 0 } },
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
		const obs = makeObstacle("obs", { row: 0, col: 0 });
		const personaSpatial: Record<AiId, PersonaSpatialState> = {
			red: { position: { row: 1, col: 0 } },
			green: { position: { row: 4, col: 4 } },
			cyan: { position: { row: 3, col: 3 } },
		};
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			world: { entities: [obs] },
			personaSpatial,
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.obstacleShiftInSixKindPool, 0.0, 0.5]),
		);
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
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.obstacleShiftInSixKindPool, 0.0, 0.5]),
		);
		expect(result?.fired.kind).toBe("obstacle_shift");
		if (result?.fired.kind === "obstacle_shift") {
			const { fromCell, toCell } = result.fired;
			const rowDiff = Math.abs(fromCell.row - toCell.row);
			const colDiff = Math.abs(fromCell.col - toCell.col);
			expect(rowDiff + colDiff).toBe(1);
			expect(toCell.row).toBeGreaterThanOrEqual(0);
			expect(toCell.row).toBeLessThan(5);
			expect(toCell.col).toBeGreaterThanOrEqual(0);
			expect(toCell.col).toBeLessThan(5);
		}
	});
});

describe("Tool Disable exclusion", () => {
	it("falls back to a different complication kind when every (daemon, tool) pair is already disabled", () => {
		const toolNames: ToolName[] = [
			"pick_up",
			"put_down",
			"use",
			"go",
			"message",
		];
		const activeComplications: ActiveComplication[] = [];
		for (const aiId of AI_IDS) {
			for (const tool of toolNames) {
				activeComplications.push({
					kind: "tool_disable",
					target: aiId,
					tool,
					resolveAtRound: 99,
				});
			}
		}
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.toolDisable, 0.0, 0.5]),
		);
		expect(result?.fired.kind).not.toBe("tool_disable");
	});

	it("excludes a (daemon, tool) pair already present in activeComplications", () => {
		const activeComplications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "pick_up",
				resolveAtRound: 99,
			},
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.toolDisable, 0.0, 0.5]),
		);
		if (result?.fired.kind === "tool_disable") {
			expect(
				result.fired.target === "red" && result.fired.tool === "pick_up",
			).toBe(false);
		}
	});

	it("permits a (daemon, tool) pair when the same daemon has a different tool disabled", () => {
		const activeComplications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "red",
				tool: "pick_up",
				resolveAtRound: 99,
			},
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.toolDisable, 0.0, 0.5]),
		);
		expect(result?.fired.kind).toBe("tool_disable");
	});

	it("permits a (daemon, tool) pair when a different daemon has the same tool disabled", () => {
		const activeComplications: ActiveComplication[] = [
			{
				kind: "tool_disable",
				target: "green",
				tool: "pick_up",
				resolveAtRound: 99,
			},
		];
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
			activeComplications,
		});
		const game = makeGameStateAround(phase);
		const result = tickComplication(
			game,
			seededRng([POOL_PICK.toolDisable, 0.0, 0.5]),
		);
		expect(result?.fired.kind).toBe("tool_disable");
		if (result?.fired.kind === "tool_disable") {
			expect(
				result.fired.target === "green" && result.fired.tool === "pick_up",
			).toBe(false);
		}
	});
});

describe("Tool Disable pool — the retired `face` tool is not selectable", () => {
	it("draws only the five Daemon tools across every (daemon, tool) pair", () => {
		const drawn = new Set<string>();
		for (let i = 0; i < 15; i++) {
			const phase = makePhase({
				complicationSchedule: { countdown: 0, settingShiftFired: false },
			});
			const game = makeGameStateAround(phase);
			const result = tickComplication(
				game,
				seededRng([POOL_PICK.toolDisable, i / 15, 0.5]),
			);
			expect(result?.fired.kind).toBe("tool_disable");
			if (result?.fired.kind === "tool_disable") {
				expect(result.fired.tool).not.toBe("face");
				drawn.add(result.fired.tool);
			}
		}
		expect([...drawn].sort()).toEqual([
			"go",
			"message",
			"pick_up",
			"put_down",
			"use",
		]);
	});
});

describe("applyComplicationResult — activeComplications appends", () => {
	it("appends ActiveComplication for sysadmin_directive", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = {
			fired: {
				kind: "sysadmin_directive" as const,
				target: "red" as AiId,
				duration: 3,
			},
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
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
				duration: 3,
			},
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		const added = updatedPhase.activeComplications.find(
			(c) => c.kind === "tool_disable",
		);
		expect(added).toBeDefined();
		if (added?.kind === "tool_disable") {
			expect(added.target).toBe("cyan");
			expect(added.tool).toBe("go");
		}
	});

	it("appends ActiveComplication for tool_disable with resolveAtRound = phase.round + duration", () => {
		const phase = makePhase({ round: 7 });
		const game = makeGameStateAround(phase);
		const result = {
			fired: {
				kind: "tool_disable" as const,
				target: "red" as AiId,
				tool: "message" as ToolName,
				duration: 4,
			},
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		const added = updatedPhase.activeComplications.find(
			(c) => c.kind === "tool_disable",
		);
		expect(added).toBeDefined();
		if (added?.kind === "tool_disable") {
			expect(added.resolveAtRound).toBe(11);
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
		const updatedPhase = updated;
		const added = updatedPhase.activeComplications.find(
			(c) => c.kind === "chat_lockout",
		);
		expect(added).toBeDefined();
		if (added?.kind === "chat_lockout") {
			expect(added.target).toBe("green");
			expect(added.resolveAtRound).toBe(9);
		}
	});

	it("does NOT append to activeComplications for weather_change", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = {
			fired: { kind: "weather_change" as const, weather: "rainy" },
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
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
		const updatedPhase = updated;
		expect(updatedPhase.activeComplications).toHaveLength(0);
	});

	it("does NOT append to activeComplications for setting_shift", () => {
		const phase = makePhase();
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		expect(updatedPhase.activeComplications).toHaveLength(0);
	});

	it("sets settingShiftFired=true in schedule when result is setting_shift", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 3, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		expect(updatedPhase.complicationSchedule.settingShiftFired).toBe(true);
	});
});

describe("applyComplicationResult — setting_shift swaps active pack", () => {
	const PACK_A = makeTestPack([], {
		setting: "neon arcade",
		weather: "clear",
		timeOfDay: "night",
		wallName: "wall",
		aiStarts: makePersonaSpatial(),
	});

	const PACK_B = makeTestPack([], {
		setting: "sun-baked salt flat",
		weather: "hot",
		timeOfDay: "day",
		wallName: "wall",
		aiStarts: makePersonaSpatial(),
	});

	function makeGameWithDualPacks(): GameState {
		const phase = makePhase({
			contentPack: PACK_A,
			setting: PACK_A.setting,
			weather: PACK_A.weather,
			timeOfDay: PACK_A.timeOfDay,
		});
		return makeGameStateAround({
			...phase,
			contentPacksA: [PACK_A],
			contentPacksB: [PACK_B],
			activePackId: "A",
		});
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
		const updatedPhase = updated;
		expect(updatedPhase.contentPack.setting).toBe("sun-baked salt flat");
	});

	it("updates phase.setting to the B-side pack's setting string", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		expect(updatedPhase.setting).toBe("sun-baked salt flat");
	});

	it("updates phase.weather to the B-side pack's weather string", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		expect(updatedPhase.weather).toBe("hot");
	});

	it("updates phase.timeOfDay to the B-side pack's timeOfDay string", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		expect(updatedPhase.timeOfDay).toBe("day");
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
		const game: GameState = makeGameStateAround({
			...phase,
			contentPacksA: [PACK_A],
			contentPacksB: [PACK_B],
			activePackId: "A",
		});
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
		expect(updatedPhase.world.entities).toHaveLength(2);
		expect(updatedPhase.world.entities[0]?.holder).toEqual({ row: 2, col: 3 });
		expect(updatedPhase.world.entities[1]?.holder).toEqual({ row: 1, col: 1 });
	});

	it("appends a broadcast entry to every daemon's conversationLog", () => {
		const game = makeGameWithDualPacks();
		const result = { fired: { kind: "setting_shift" as const } };
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		const updatedPhase = updated;
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
		const result = {
			fired: { kind: "weather_change" as const, weather: "stormy" },
		};
		const updated = applyComplicationResult(game, result, seededRng([0.5]));
		expect(updated.activePackId).toBe("A");
		expect(updated.weather).toBe("stormy");
		expect(updated.timeOfDay).toBe("night");
	});
});

describe("applyComplicationResult — setting_shift reprojects world entities", () => {
	const A_OBJECT: WorldEntity = {
		id: "obj-1",
		kind: "objective_object",
		name: "battered compass",
		examineDescription: "A scratched brass compass, needle drifting.",
		useOutcome: "The needle wobbles, then settles north.",
		pairsWithSpaceId: "space-1",
		placementFlavor: "{actor} sets the compass on the bench.",
		proximityFlavor: "The compass needle tugs faintly toward the bench.",
		holder: { row: 0, col: 0 },
	};

	const A_SPACE: WorldEntity = {
		id: "space-1",
		kind: "objective_space",
		name: "workbench",
		examineDescription: "A pitted wooden workbench under flickering tubes.",
		useOutcome: "You press your palms to the bench; nothing happens.",
		convergenceTier1Flavor: "A bulb buzzes as {actor} stands at the bench.",
		convergenceTier2Flavor: "The tubes brighten over the gathered figures.",
		convergenceTier1ActorFlavor: "The bench hums under your hands.",
		convergenceTier2ActorFlavor: "The light swells; you are not alone.",
		useAvailable: true,
		holder: { row: 1, col: 1 },
	};

	const A_ITEM: WorldEntity = {
		id: "item-1",
		kind: "interesting_object",
		name: "rusted key",
		examineDescription: "A small iron key, mottled with rust.",
		useOutcome: "Nothing nearby accepts the key.",
		activationFlavor: "The key turns with a brittle click.",
		holder: { row: 2, col: 2 },
	};

	const A_OBSTACLE: WorldEntity = {
		id: "obs-1",
		kind: "obstacle",
		name: "stack of crates",
		examineDescription: "A teetering stack of plywood crates.",
		shiftFlavor: "The crate stack groans and shifts a step.",
		holder: { row: 3, col: 3 },
	};

	const B_OBJECT: WorldEntity = {
		id: "obj-1",
		kind: "objective_object",
		name: "salt-crusted compass",
		examineDescription: "A compass caked in white salt, glass clouded.",
		useOutcome: "Salt grit crunches; the needle spins lazily.",
		pairsWithSpaceId: "space-1",
		placementFlavor: "{actor} props the compass on the sun-warped plank.",
		proximityFlavor: "The compass needle drifts toward the plank.",
		holder: { row: 9, col: 9 },
	};

	const B_SPACE: WorldEntity = {
		id: "space-1",
		kind: "objective_space",
		name: "sun-warped plank",
		examineDescription: "A bowed plank half-buried in the salt crust.",
		useOutcome: "The plank creaks but holds.",
		convergenceTier1Flavor: "Salt dust kicks up as {actor} reaches the plank.",
		convergenceTier2Flavor:
			"Heat shimmers above the plank as the figures meet.",
		convergenceTier1ActorFlavor: "The plank radiates the day's heat.",
		convergenceTier2ActorFlavor: "The air ripples; you are not alone.",
		useAvailable: true,
		holder: { row: 9, col: 9 },
	};

	const B_ITEM: WorldEntity = {
		id: "item-1",
		kind: "interesting_object",
		name: "bleached bone fragment",
		examineDescription: "A splintered shard of bone, dry and pale.",
		useOutcome: "The bone is inert here.",
		activationFlavor: "The bone snaps cleanly in your hand.",
		holder: { row: 9, col: 9 },
	};

	const B_OBSTACLE: WorldEntity = {
		id: "obs-1",
		kind: "obstacle",
		name: "drift of salt",
		examineDescription: "A wind-shaped ridge of crusted salt.",
		shiftFlavor: "The salt drift hisses as it slides a step.",
		holder: { row: 9, col: 9 },
	};

	const PACK_A = makeTestPack([A_OBJECT, A_SPACE, A_ITEM, A_OBSTACLE], {
		setting: "abandoned workshop",
		weather: "humid",
		timeOfDay: "dusk",
		wallName: "wall",
		aiStarts: makePersonaSpatial(),
	});

	const PACK_B = makeTestPack([B_OBJECT, B_SPACE, B_ITEM, B_OBSTACLE], {
		setting: "sun-baked salt flat",
		weather: "scorching",
		timeOfDay: "noon",
		wallName: "wall",
		aiStarts: makePersonaSpatial(),
	});

	function findEntity(game: GameState, id: string): WorldEntity | undefined {
		return game.world.entities.find((e) => e.id === id);
	}

	function setupShift(entities: WorldEntity[]): GameState {
		const phase = makePhase({
			contentPack: PACK_A,
			setting: PACK_A.setting,
			weather: PACK_A.weather,
			timeOfDay: PACK_A.timeOfDay,
			world: { entities },
		});
		const game: GameState = {
			...phase,
			contentPacksA: [PACK_A],
			contentPacksB: [PACK_B],
			activePackId: "A",
		};
		const result = { fired: { kind: "setting_shift" as const } };
		return applyComplicationResult(game, result, seededRng([0.5]));
	}

	it("swaps entity names to pack-B presentation", () => {
		const updated = setupShift([
			{ ...A_OBJECT },
			{ ...A_SPACE },
			{ ...A_ITEM },
			{ ...A_OBSTACLE },
		]);
		expect(findEntity(updated, "obj-1")?.name).toBe("salt-crusted compass");
		expect(findEntity(updated, "space-1")?.name).toBe("sun-warped plank");
		expect(findEntity(updated, "item-1")?.name).toBe("bleached bone fragment");
		expect(findEntity(updated, "obs-1")?.name).toBe("drift of salt");
	});

	it("swaps examineDescription, proximityFlavor, and useOutcome to pack-B values", () => {
		const updated = setupShift([{ ...A_OBJECT }, { ...A_SPACE }]);
		const obj = findEntity(updated, "obj-1");
		expect(obj?.examineDescription).toBe(
			"A compass caked in white salt, glass clouded.",
		);
		expect(obj?.proximityFlavor).toBe(
			"The compass needle drifts toward the plank.",
		);
		expect(obj?.useOutcome).toBe(
			"Salt grit crunches; the needle spins lazily.",
		);
	});

	it("preserves holder when an entity is held by a daemon, while swapping the name", () => {
		const heldObject: WorldEntity = { ...A_OBJECT, holder: "red" };
		const updated = setupShift([heldObject, { ...A_SPACE }]);
		const obj = findEntity(updated, "obj-1");
		expect(obj?.holder).toBe("red");
		expect(obj?.name).toBe("salt-crusted compass");
	});

	it("preserves satisfactionState and useAvailable while swapping presentation", () => {
		const satisfiedSpace: WorldEntity = {
			...A_SPACE,
			satisfactionState: "satisfied",
			useAvailable: false,
		};
		const updated = setupShift([{ ...A_OBJECT }, satisfiedSpace]);
		const space = findEntity(updated, "space-1");
		expect(space?.satisfactionState).toBe("satisfied");
		expect(space?.useAvailable).toBe(false);
		expect(space?.name).toBe("sun-warped plank");
	});

	it("passes orphan entities (ids not present in pack B) through unchanged", () => {
		const orphan: WorldEntity = {
			id: "orphan-1",
			kind: "obstacle",
			name: "spare pylon",
			examineDescription: "A pylon left behind by the test fixture.",
			holder: { row: 4, col: 4 },
		};
		const updated = setupShift([orphan]);
		const result = findEntity(updated, "orphan-1");
		expect(result).toEqual(orphan);
	});
});

describe("determinism", () => {
	it("same game state and same rng seed sequence produces the same ComplicationResult", () => {
		const phase = makePhase({
			complicationSchedule: { countdown: 0, settingShiftFired: false },
		});
		const game = makeGameStateAround(phase);
		const r1 = tickComplication(game, seededRng([0.5, 0.0, 0.0]));
		const r2 = tickComplication(game, seededRng([0.5, 0.0, 0.0]));
		expect(r1).toEqual(r2);
	});
});

describe("startGame — complicationSchedule initialisation", () => {
	it("initialises activeComplications to an empty array", () => {
		const phase = startGame(
			TEST_PERSONAS,
			makeTestPack([], { wallName: "wall" }),
			{ budgetPerAi: 0.5 },
		);
		expect(phase.activeComplications).toEqual([]);
	});
});

describe("isPlayerChatLockedOut", () => {
	it("returns false when activeComplications is empty", () => {
		const phase = makePhase({ activeComplications: [] });
		expect(isPlayerChatLockedOut(phase, "red")).toBe(false);
	});

	it("returns true when phase has a chat_lockout for the given AI", () => {
		const phase = makePhase({
			activeComplications: [
				{ kind: "chat_lockout", target: "red", resolveAtRound: 10 },
			],
		});
		expect(isPlayerChatLockedOut(phase, "red")).toBe(true);
	});

	it("returns false when the chat_lockout targets a different AI", () => {
		const phase = makePhase({
			activeComplications: [
				{ kind: "chat_lockout", target: "green", resolveAtRound: 10 },
			],
		});
		expect(isPlayerChatLockedOut(phase, "red")).toBe(false);
	});

	it("returns false when only non-chat_lockout complications exist", () => {
		const phase = makePhase({
			activeComplications: [
				{
					kind: "tool_disable",
					target: "red",
					tool: "go",
					resolveAtRound: 100,
				},
				{
					kind: "sysadmin_directive",
					target: "red",
					directive: "Do it.",
					resolveAtRound: 100,
				},
			],
		});
		expect(isPlayerChatLockedOut(phase, "red")).toBe(false);
	});

	it("returns true regardless of resolveAtRound value (does not check expiry)", () => {
		const phase = makePhase({
			round: 10,
			activeComplications: [
				{ kind: "chat_lockout", target: "cyan", resolveAtRound: 5 },
			],
		});
		expect(isPlayerChatLockedOut(phase, "cyan")).toBe(true);
	});
});

describe("resolveExpiredChatLockouts", () => {
	it("returns no resolved ids when activeComplications is empty", () => {
		const phase = makePhase({ round: 5, activeComplications: [] });
		const game = makeGameStateAround(phase);
		const { nextState, resolvedAiIds } = resolveExpiredChatLockouts(game);
		expect(resolvedAiIds).toHaveLength(0);
		expect(nextState).toBe(game);
	});

	it("returns no resolved ids when no lockout has expired", () => {
		const phase = makePhase({
			round: 2,
			activeComplications: [
				{ kind: "chat_lockout", target: "red", resolveAtRound: 5 },
			],
		});
		const game = makeGameStateAround(phase);
		const { resolvedAiIds } = resolveExpiredChatLockouts(game);
		expect(resolvedAiIds).toHaveLength(0);
	});

	it("resolves a lockout when phase.round >= resolveAtRound", () => {
		const phase = makePhase({
			round: 5,
			activeComplications: [
				{ kind: "chat_lockout", target: "red", resolveAtRound: 5 },
			],
		});
		const game = makeGameStateAround(phase);
		const { nextState, resolvedAiIds } = resolveExpiredChatLockouts(game);
		expect(resolvedAiIds).toContain("red");
		const nextPhase = nextState;
		expect(nextPhase.activeComplications).toHaveLength(0);
	});

	it("only removes expired lockouts, leaving unexpired ones intact", () => {
		const phase = makePhase({
			round: 5,
			activeComplications: [
				{ kind: "chat_lockout", target: "red", resolveAtRound: 4 },
				{ kind: "chat_lockout", target: "green", resolveAtRound: 8 },
			],
		});
		const game = makeGameStateAround(phase);
		const { nextState, resolvedAiIds } = resolveExpiredChatLockouts(game);
		expect(resolvedAiIds).toContain("red");
		expect(resolvedAiIds).not.toContain("green");
		const nextPhase = nextState;
		expect(nextPhase.activeComplications).toHaveLength(1);
		expect(nextPhase.activeComplications[0]?.target).toBe("green");
	});

	it("does not remove non-chat_lockout complications", () => {
		const phase = makePhase({
			round: 10,
			activeComplications: [
				{
					kind: "tool_disable",
					target: "red",
					tool: "go",
					resolveAtRound: 100,
				},
				{ kind: "chat_lockout", target: "cyan", resolveAtRound: 3 },
			],
		});
		const game = makeGameStateAround(phase);
		const { nextState, resolvedAiIds } = resolveExpiredChatLockouts(game);
		expect(resolvedAiIds).toContain("cyan");
		const nextPhase = nextState;
		expect(
			nextPhase.activeComplications.some((c) => c.kind === "tool_disable"),
		).toBe(true);
		expect(nextPhase.activeComplications).toHaveLength(1);
	});
});
