import { describe, expect, it } from "vitest";
import { availableTools, targetHandles } from "../available-tools.js";
import { dispatchAiTurn, validateToolCall } from "../dispatcher.js";
import { appendLogEntry } from "../engine.js";
import { buildOpenAiMessages } from "../openai-message-builder.js";
import { buildAiContext } from "../prompt-builder.js";
import type { GameState, ToolName, WorldEntity } from "../types.js";
import {
	CORNER_AI_STARTS,
	makeEntity,
	makeTestGame,
} from "./fixtures/make-game-state.js";

const RED_CELL = { row: 2, col: 2 };
const NORTH_OF_RED = { row: 1, col: 2 };

function makeGame(entities: WorldEntity[]): GameState {
	return makeTestGame({
		entities,
		pack: { setting: "test", aiStarts: CORNER_AI_STARTS },
		rng: () => 0,
	});
}

function itemEnum(game: GameState, tool: ToolName): string[] {
	const def = availableTools(game, "red", []).find(
		(t) => t.function.name === tool,
	);
	return def?.function.parameters.properties.item?.enum ?? [];
}

function decoyAndCarryGame(): GameState {
	const game = makeGame([
		makeEntity("decoy-1", "interesting_object", RED_CELL, {
			name: "tin cup",
			examineDescription: "A dented tin cup.",
		}),
		makeEntity("carry-0-obj", "objective_object", NORTH_OF_RED, {
			name: "yellow flashlight",
			examineDescription: "A yellow flashlight.",
			pairsWithSpaceId: "carry-0-space",
		}),
		makeEntity(
			"carry-0-space",
			"objective_space",
			{ row: 4, col: 0 },
			{
				name: "wall mount",
			},
		),
		makeEntity("useSpace-0-space", "objective_space", NORTH_OF_RED, {
			name: "service panel",
			useAvailable: true,
		}),
	]);
	return {
		...game,
		objectives: [
			{
				id: "carry-0",
				kind: "carry",
				description: "Seat the flashlight in the wall mount.",
				satisfactionState: "pending",
				objectId: "carry-0-obj",
				spaceId: "carry-0-space",
			},
			{
				id: "useSpace-0",
				kind: "use_space",
				description: "Activate the service panel.",
				satisfactionState: "pending",
				spaceId: "useSpace-0-space",
			},
		],
	};
}

describe("tool targets are the names the Daemon sees", () => {
	it("builds the pick_up and use enums from display names, never internal ids", () => {
		const game = decoyAndCarryGame();
		expect(itemEnum(game, "pick_up").sort()).toEqual([
			"tin cup",
			"yellow flashlight",
		]);
		expect(itemEnum(game, "use")).toEqual(["service panel"]);
		const allEnums = availableTools(game, "red", []).flatMap(
			(t) => t.function.parameters.properties.item?.enum ?? [],
		);
		for (const value of allEnums) {
			expect(value).not.toMatch(/decoy|carry-|useSpace-/);
		}
	});

	it("builds the put_down and use enums from the names of held items", () => {
		const game = makeGame([
			makeEntity("decoy-1", "interesting_object", "red", { name: "tin cup" }),
		]);
		expect(itemEnum(game, "put_down")).toEqual(["tin cup"]);
		expect(itemEnum(game, "use")).toEqual(["tin cup"]);
	});

	it("resolves a picked-up name to its entity and reports the result by name", () => {
		const game = decoyAndCarryGame();
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "yellow flashlight" } },
		});
		const flashlight = result.game.world.entities.find(
			(e) => e.id === "carry-0-obj",
		);
		expect(flashlight?.holder).toBe("red");
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toContain(
			"picked up the yellow flashlight",
		);
		expect(result.records[0]?.description).not.toContain("carry-0-obj");
	});

	it("activates a space named in the use enum", () => {
		const game = decoyAndCarryGame();
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "use", args: { item: "service panel" } },
		});
		expect(result.records[0]?.kind).toBe("tool_success");
		const panel = result.game.world.entities.find(
			(e) => e.id === "useSpace-0-space",
		);
		expect(panel?.useAvailable).toBe(false);
	});

	it("stores the internal id on witness entries so saves are unchanged", () => {
		const base = decoyAndCarryGame();
		const game: GameState = {
			...base,
			personaSpatial: {
				...base.personaSpatial,
				green: { position: { row: 2, col: 3 } },
			},
		};
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "tin cup" } },
		});
		const witnessed = Object.values(result.game.conversationLogs)
			.flat()
			.filter((e) => e.kind === "witnessed-event");
		expect(witnessed.length).toBeGreaterThan(0);
		for (const entry of witnessed) {
			expect(entry).toMatchObject({ item: "decoy-1" });
		}
	});

	it("names the item in failure reasons, not the id", () => {
		const game = makeGame([
			makeEntity(
				"decoy-1",
				"interesting_object",
				{ row: 4, col: 4 },
				{
					name: "tin cup",
				},
			),
		]);
		const validation = validateToolCall(game, "red", {
			name: "pick_up",
			args: { item: "tin cup" },
		});
		expect(validation.valid).toBe(false);
		expect(validation.reason).toContain('"tin cup"');
		expect(validation.reason).not.toContain("decoy-1");
	});

	it("accepts an older id-based call so replayed logs still dispatch", () => {
		const game = decoyAndCarryGame();
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "decoy-1" } },
		});
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toContain("picked up the tin cup");
	});

	it("replays an older id-based tool-call entry without error", () => {
		const game = appendLogEntry(decoyAndCarryGame(), "red", {
			kind: "tool-call",
			round: 0,
			aiId: "red",
			toolCallId: "call-old",
			toolName: "pick_up",
			toolArgumentsJson: '{"item":"carry-0-obj"}',
			result: "Ember picked up the carry-0-obj",
			success: true,
		});
		const messages = buildOpenAiMessages(buildAiContext(game, "red"));
		const replayed = messages.find(
			(m) => m.role === "assistant" && m.tool_calls?.[0]?.id === "call-old",
		);
		expect(replayed).toBeDefined();
	});
});

describe("tool targets that share a name", () => {
	function twinKeysGame(): GameState {
		return makeGame([
			makeEntity("key-a", "interesting_object", RED_CELL, {
				name: "brass key",
				examineDescription: "A brass key with a red tag.",
			}),
			makeEntity("key-b", "interesting_object", NORTH_OF_RED, {
				name: "brass key",
				examineDescription: "A brass key with a blue tag.",
			}),
		]);
	}

	it("gives each a distinct handle in the enum", () => {
		const game = twinKeysGame();
		expect(itemEnum(game, "pick_up").sort()).toEqual([
			"brass key #1",
			"brass key #2",
		]);
	});

	it("uses the same handles in the state message", () => {
		const game = twinKeysGame();
		const state = buildAiContext(game, "red").toCurrentStateUserMessage();
		for (const handle of itemEnum(game, "pick_up")) {
			expect(state).toContain(handle);
		}
	});

	it("resolves each handle to its own entity", () => {
		const game = twinKeysGame();
		const handles = itemEnum(game, "pick_up");
		const picked = handles.map((handle) => {
			const result = dispatchAiTurn(game, {
				aiId: "red",
				toolCall: { name: "pick_up", args: { item: handle } },
			});
			return result.game.world.entities.find((e) => e.holder === "red")?.id;
		});
		expect(new Set(picked)).toEqual(new Set(["key-a", "key-b"]));
	});

	it("keeps handles stable when one of the pair moves", () => {
		const game = twinKeysGame();
		const before = itemEnum(game, "pick_up").sort();
		const firstHandle = before[0] as string;
		const after = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: firstHandle } },
		}).game;
		expect(itemEnum(after, "put_down")).toEqual([firstHandle]);
		expect(itemEnum(after, "pick_up")).toEqual([before[1]]);
	});
});

describe("tool targets resolve exactly once", () => {
	it("does not re-resolve an id that is another entity's name", () => {
		const game = makeGame([
			makeEntity("key", "interesting_object", RED_CELL, { name: "brass key" }),
			makeEntity(
				"b1",
				"interesting_object",
				{ row: 4, col: 4 },
				{ name: "key" },
			),
		]);
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "brass key" } },
		});
		expect(result.records[0]?.kind).toBe("tool_success");
		expect(result.records[0]?.description).toContain("picked up the brass key");
		const holderOf = (id: string) =>
			result.game.world.entities.find((e) => e.id === id)?.holder;
		expect(holderOf("key")).toBe("red");
		expect(holderOf("b1")).toEqual({ row: 4, col: 4 });
	});
});

describe("tool targets with stray whitespace in their names", () => {
	it("offers and resolves a trimmed handle", () => {
		const game = makeGame([
			makeEntity("lamp-1", "interesting_object", RED_CELL, { name: "lamp " }),
		]);
		expect(itemEnum(game, "pick_up")).toEqual(["lamp"]);
		for (const handle of ["lamp", " Lamp", "lamp "]) {
			const result = dispatchAiTurn(game, {
				aiId: "red",
				toolCall: { name: "pick_up", args: { item: handle } },
			});
			expect(result.records[0]?.kind).toBe("tool_success");
			expect(
				result.game.world.entities.find((e) => e.id === "lamp-1")?.holder,
			).toBe("red");
		}
	});
});

describe("ordinal handles never collide with an existing name", () => {
	it("skips an ordinal another entity already uses as its name", () => {
		const game = makeGame([
			makeEntity("lamp-a", "interesting_object", RED_CELL, { name: "lamp" }),
			makeEntity("lamp-b", "interesting_object", RED_CELL, { name: "lamp" }),
			makeEntity("lamp-c", "interesting_object", RED_CELL, {
				name: "lamp #1",
			}),
		]);
		const handles = targetHandles(game.world.entities);
		expect(handles.get("lamp-c")).toBe("lamp #1");
		expect(handles.get("lamp-a")).toBe("lamp #2");
		expect(handles.get("lamp-b")).toBe("lamp #3");
		expect(new Set(itemEnum(game, "pick_up")).size).toBe(3);
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "lamp #1" } },
		});
		expect(result.game.world.entities.find((e) => e.holder === "red")?.id).toBe(
			"lamp-c",
		);
	});
});

describe("names that differ only in case share ordinal handles", () => {
	it("gives Lamp and lamp distinct #n handles, each resolving to its own entity", () => {
		const game = makeGame([
			makeEntity("lamp-upper", "interesting_object", RED_CELL, {
				name: "Lamp",
			}),
			makeEntity("lamp-lower", "interesting_object", RED_CELL, {
				name: "lamp",
			}),
		]);
		const handles = targetHandles(game.world.entities);
		expect(handles.get("lamp-upper")).toBe("Lamp #1");
		expect(handles.get("lamp-lower")).toBe("lamp #2");
		expect(new Set(itemEnum(game, "pick_up")).size).toBe(2);
		const result = dispatchAiTurn(game, {
			aiId: "red",
			toolCall: { name: "pick_up", args: { item: "lamp #2" } },
		});
		expect(result.game.world.entities.find((e) => e.holder === "red")?.id).toBe(
			"lamp-lower",
		);
	});
});

describe("rejections name a held-fast item's space by its handle", () => {
	it("uses the space's handle when two spaces share a name", () => {
		const game = makeGame([
			makeEntity("flashlight", "objective_object", NORTH_OF_RED, {
				name: "yellow flashlight",
				pairsWithSpaceId: "mount-b",
			}),
			makeEntity(
				"mount-a",
				"objective_space",
				{ row: 4, col: 0 },
				{
					name: "wall mount",
				},
			),
			makeEntity("mount-b", "objective_space", NORTH_OF_RED, {
				name: "wall mount",
			}),
		]);
		const mountHandle = targetHandles(game.world.entities).get("mount-b");
		expect(mountHandle).toMatch(/^wall mount #\d$/);
		for (const tool of ["pick_up", "use"] as const) {
			const validation = validateToolCall(game, "red", {
				name: tool,
				args: { item: "yellow flashlight" },
			});
			expect(validation.valid).toBe(false);
			expect(validation.reason).toContain(`set into the ${mountHandle} and`);
		}
	});
});
