import { describe, expect, it } from "vitest";
import { makeTestPack } from "../../game/__tests__/fixtures/make-test-pack.js";
import { startGame } from "../../game/engine.js";
import type {
	AiId,
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
	WorldEntity,
} from "../../game/types.js";
import { lookupArchiveVersion } from "../archive-map.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import {
	type DaemonFile,
	deserializeSession,
	SESSION_SCHEMA_VERSION,
	serializeSession,
} from "../session-codec.js";
import type { VersionBoundary } from "../version-boundary.js";

const PRE_BOUNDARY: VersionBoundary = { session: 11, gs: 4 };

const TEST_CONTENT_PACK = makeTestPack([], { wallName: "wall" });

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "Ember is hot-headed and zealous. Hold the flower at phase end.",
		typingQuirks: ["fragments", "ALL CAPS"],
		voiceExamples: ["Now.", "BURN IT.", "Soon, soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "Sage is intensely meticulous. Ensure items are evenly distributed.",
		typingQuirks: ["ellipses", "no contractions"],
		voiceExamples: [
			"I will count again...",
			"That is not balanced.",
			"One more sweep through the list.",
		],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "Frost is laconic and diffident. Hold the key at phase end.",
		typingQuirks: ["lowercase only", "fragments"],
		voiceExamples: ["sure.", "if you say so.", "fine."],
	},
};

function makeFreshGame(): GameState {
	return startGame(TEST_PERSONAS, TEST_CONTENT_PACK, {
		budgetPerAi: 5,
		rng: () => 0,
	});
}

const NOW = new Date().toISOString();
const CREATED_AT = "2024-01-01T00:00:00.000Z";

describe("serializeSession / deserializeSession", () => {
	it("round-trips a fresh game (ok)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.isComplete).toBe(false);
			expect(result.state.round).toBe(0);
			expect(result.createdAt).toBe(CREATED_AT);
			expect(result.lastSavedAt).toBe(NOW);
		}
	});

	it("daemon shape: top-level aiId/persona/conversationLog", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const daemonJson = files.daemons.red;
		expect(daemonJson).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: toBeDefined() guards this
		const daemon = JSON.parse(daemonJson!);
		expect(daemon).toHaveProperty("aiId", "red");
		expect(daemon).toHaveProperty("persona");
		expect(daemon).toHaveProperty("conversationLog");
		expect(Array.isArray(daemon.conversationLog)).toBe(true);
		expect(daemon).not.toHaveProperty("phases");
	});

	it("persona block keys are exactly the editable AiPersona surface (no budgetPerPhase)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		// biome-ignore lint/style/noNonNullAssertion: daemons.red always exists for this fixture
		const daemon = JSON.parse(files.daemons.red!);
		const personaKeys = Object.keys(daemon.persona).sort();
		expect(personaKeys).toEqual(
			[
				"id",
				"name",
				"color",
				"temperaments",
				"personaGoal",
				"blurb",
				"typingQuirks",
				"voiceExamples",
			].sort(),
		);
	});

	it("omits actionProfile from the persona block when unset", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		// biome-ignore lint/style/noNonNullAssertion: daemons.red always exists for this fixture
		const daemon = JSON.parse(files.daemons.red!);
		expect(daemon.persona).not.toHaveProperty("actionProfile");
	});

	it("round-trips actionProfile when a persona has one", () => {
		const game = makeFreshGame();
		const red = game.personas.red;
		expect(red).toBeDefined();
		if (red) red.actionProfile = "*red leans toward `go`, `use`.";
		const files = serializeSession(game, NOW, CREATED_AT);
		// biome-ignore lint/style/noNonNullAssertion: daemons.red always exists for this fixture
		const daemon = JSON.parse(files.daemons.red!);
		expect(daemon.persona.actionProfile).toBe("*red leans toward `go`, `use`.");
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.personas.red?.actionProfile).toBe(
				"*red leans toward `go`, `use`.",
			);
		}
	});

	it("pretty-printed with 2-space indent", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const metaLines = files.meta.split("\n");
		expect(metaLines[1]).toMatch(/^ {2}/);
	});

	it("meta has createdAt/lastSavedAt/epoch/round/personaOrder", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const meta = JSON.parse(files.meta);
		expect(meta).toHaveProperty("createdAt", CREATED_AT);
		expect(meta).toHaveProperty("lastSavedAt", NOW);
		expect(meta).toHaveProperty("epoch", 1);
		expect(meta).toHaveProperty("round", 0);
		expect(meta).toHaveProperty("personaOrder");
		expect(Array.isArray(meta.personaOrder)).toBe(true);
		expect(meta.personaOrder).toEqual(Object.keys(game.personas));
	});

	it("deserializeSession honours personaOrder from meta (panel ordering preserved)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(Object.keys(result.state.personas)).toEqual(
				Object.keys(game.personas),
			);
		}
	});

	it("deserializeSession honours meta.personaOrder when daemon-file key order differs", () => {
		const game = makeFreshGame();
		const canonicalOrder = Object.keys(game.personas);
		expect(canonicalOrder.length).toBeGreaterThanOrEqual(2);

		const files = serializeSession(game, NOW, CREATED_AT);

		const reversedDaemons: Record<string, string> = {};
		for (const aiId of [...canonicalOrder].reverse()) {
			reversedDaemons[aiId] = files.daemons[aiId] as string;
		}

		const result = deserializeSession({
			meta: files.meta,
			daemons: reversedDaemons,
			engine: files.engine,
		});
		if (result.kind !== "ok") {
			throw new Error(`expected ok, got ${result.kind}`);
		}

		expect(Object.keys(result.state.personas)).toEqual(canonicalOrder);
	});

	it("deserializeSession falls back to daemon-file key order when personaOrder is absent (legacy meta)", () => {
		const game = makeFreshGame();
		const canonicalOrder = Object.keys(game.personas);

		const files = serializeSession(game, NOW, CREATED_AT);

		const metaParsed = JSON.parse(files.meta) as Record<string, unknown>;
		delete metaParsed.personaOrder;
		const metaWithoutOrder = JSON.stringify(metaParsed, null, 2);

		const result = deserializeSession({
			meta: metaWithoutOrder,
			daemons: files.daemons,
			engine: files.engine,
		});
		if (result.kind !== "ok") {
			throw new Error(`expected ok, got ${result.kind}`);
		}

		expect(Object.keys(result.state.personas)).toEqual(canonicalOrder);
	});

	it("no whispers.txt file in serialized output (whispers live in daemon conversationLog)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		expect("whispers" in files).toBe(false);
	});

	it("engine field is base64-printable", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		expect(files.engine).toMatch(/^[A-Za-z0-9+/=]*$/);
	});

	it("round-trips lockedOut Set", () => {
		const game = makeFreshGame();
		const modified: GameState = {
			...game,
			lockedOut: new Set<AiId>(["red"]),
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.lockedOut).toBeInstanceOf(Set);
			expect(result.state.lockedOut.has("red")).toBe(true);
		}
	});

	it("round-trips conversation logs with message entries", () => {
		const game = makeFreshGame();
		const modified: GameState = {
			...game,
			conversationLogs: {
				red: [
					{
						kind: "message",
						from: "blue",
						to: "red",
						content: "hello red",
						round: 0,
					},
				],
				green: [
					{
						kind: "message",
						from: "green",
						to: "blue",
						content: "green reply",
						round: 0,
					},
				],
				cyan: [],
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.conversationLogs.red).toEqual([
				{
					kind: "message",
					from: "blue",
					to: "red",
					content: "hello red",
					round: 0,
				},
			]);
			expect(result.state.conversationLogs.green).toEqual([
				{
					kind: "message",
					from: "green",
					to: "blue",
					content: "green reply",
					round: 0,
				},
			]);
		}
	});

	it("round-trips message and witnessed-event entries via per-Daemon conversationLog", () => {
		const game = makeFreshGame();
		const messageEntry: ConversationEntry = {
			kind: "message",
			round: 1,
			from: "red" as AiId,
			to: "cyan" as AiId,
			content: "psst",
		};
		const witnessedEntry: ConversationEntry = {
			kind: "witnessed-event",
			round: 2,
			actor: "red" as AiId,
			actionKind: "pick_up",
			item: "flower",
		};
		const modified: GameState = {
			...game,
			conversationLogs: {
				...game.conversationLogs,
				cyan: [messageEntry],
				green: [witnessedEntry],
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.conversationLogs.cyan?.[0]).toEqual(messageEntry);
			expect(result.state.conversationLogs.green?.[0]).toEqual(witnessedEntry);
			expect("physicalLog" in result.state).toBe(false);
			expect("whispers" in result.state).toBe(false);
		}
	});

	it("round-trips action-failure entries in per-Daemon conversationLog", () => {
		const game = makeFreshGame();
		const failureEntry: ConversationEntry = {
			kind: "action-failure",
			round: 3,
			tool: "go",
			reason: "That cell is blocked by an obstacle",
		};
		const modified: GameState = {
			...game,
			conversationLogs: {
				...game.conversationLogs,
				red: [failureEntry],
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.conversationLogs.red?.[0]).toEqual(failureEntry);
			expect(result.state.conversationLogs.green ?? []).toHaveLength(0);
			expect(result.state.conversationLogs.cyan ?? []).toHaveLength(0);
		}
	});

	it("round-trips tool-call entries with diskDelta (#376)", () => {
		const game = makeFreshGame();
		const toolCallWithDelta: ConversationEntry = {
			kind: "tool-call",
			round: 4,
			aiId: "red" as AiId,
			toolCallId: "go_call_1",
			toolArgumentsJson: '{"direction":"north"}',
			toolName: "go",
			result: "Ember walks north.",
			success: true,
			diskDelta: "+ at one step north and one step east: *green",
		};
		const modified: GameState = {
			...game,
			conversationLogs: { ...game.conversationLogs, red: [toolCallWithDelta] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.conversationLogs.red?.[0]).toEqual(toolCallWithDelta);
		}
	});

	it("loads pre-#376 tool-call entries (no diskDelta field) cleanly", () => {
		const game = makeFreshGame();
		const legacyToolCall: ConversationEntry = {
			kind: "tool-call",
			round: 2,
			aiId: "red" as AiId,
			toolCallId: "old_call_1",
			toolArgumentsJson: '{"item":"flower"}',
			toolName: "pick_up",
			result: "Ember picked up the flower.",
			success: true,
		};
		const modified: GameState = {
			...game,
			conversationLogs: { ...game.conversationLogs, red: [legacyToolCall] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const loaded = result.state.conversationLogs.red?.[0];
			expect(loaded).toEqual(legacyToolCall);
			if (loaded?.kind === "tool-call") {
				expect(loaded.diskDelta).toBeUndefined();
			}
		}
	});

	it("round-trips world entities", () => {
		const game = makeFreshGame();
		const entity: WorldEntity = {
			id: "key",
			kind: "interesting_object",
			name: "The Key",
			examineDescription: "A key",
			holder: { row: 2, col: 3 },
		};
		const modified: GameState = {
			...game,
			world: { entities: [entity] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.world.entities[0]).toMatchObject({
				id: "key",
				name: "The Key",
				holder: { row: 2, col: 3 },
			});
		}
	});

	it("round-trips interesting_object Use-Item flavor fields (issue #334)", () => {
		const game = makeFreshGame();
		const entity: WorldEntity = {
			id: "switch",
			kind: "interesting_object",
			name: "Brass Switch",
			examineDescription: "A brass switch waiting to be pressed.",
			useOutcome: "The switch clicks under your finger.",
			activationFlavor:
				"The switch flips home with a hard thunk and an amber light pulses on.",
			postExamineDescription:
				"The switch sits locked in its on position, amber light steady.",
			postLookFlavor: "an amber pinpoint of light glows beside the switch",
			satisfactionState: "satisfied",
			holder: { row: 1, col: 1 },
		};
		const modified: GameState = {
			...game,
			world: { entities: [entity] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const restored = result.state.world.entities[0];
			expect(restored?.activationFlavor).toBe(entity.activationFlavor);
			expect(restored?.postExamineDescription).toBe(
				entity.postExamineDescription,
			);
			expect(restored?.postLookFlavor).toBe(entity.postLookFlavor);
			expect(restored?.satisfactionState).toBe("satisfied");
		}
	});

	it("round-trips budgets", () => {
		const game = makeFreshGame();
		const modified: GameState = {
			...game,
			budgets: {
				red: { remaining: 0.03, total: 0.05 },
				green: { remaining: 0.05, total: 0.05 },
				cyan: { remaining: 0.04, total: 0.05 },
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.budgets.red).toEqual({
				remaining: 0.03,
				total: 0.05,
			});
		}
	});

	it("round-trips personaSpatial", () => {
		const game = makeFreshGame();
		const modified: GameState = {
			...game,
			personaSpatial: {
				red: { position: { row: 2, col: 3 } },
				green: { position: { row: 1, col: 1 } },
				cyan: { position: { row: 4, col: 4 } },
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.personaSpatial.red).toEqual({
				position: { row: 2, col: 3 },
			});
		}
	});

	it("round-trips objective_space activationFlavor (issue #335)", () => {
		const game = makeFreshGame();
		const space: WorldEntity = {
			id: "shrine",
			kind: "objective_space",
			name: "Shrine",
			examineDescription: "A small shrine. Press the basin to activate it.",
			holder: { row: 4, col: 4 },
			useAvailable: true,
			activationFlavor: "The basin floods with light beneath your palm.",
			satisfactionFlavor: "The shrine pulses with light.",
			postExamineDescription: "The shrine has been activated.",
			postLookFlavor: "The shrine glows steadily.",
		};
		const modified: GameState = {
			...game,
			world: { entities: [...game.world.entities, space] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const restored = result.state.world.entities.find(
				(e) => e.id === "shrine",
			);
			expect(restored?.activationFlavor).toBe(
				"The basin floods with light beneath your palm.",
			);
			expect(restored?.satisfactionFlavor).toBe(
				"The shrine pulses with light.",
			);
			expect(restored?.postExamineDescription).toBe(
				"The shrine has been activated.",
			);
		}
	});

	it("round-trips obstacle entities", () => {
		const game = makeFreshGame();
		const obstacles: WorldEntity[] = [
			{
				id: "wall_a",
				kind: "obstacle",
				name: "wall",
				examineDescription: "A solid wall",
				holder: { row: 0, col: 0 },
			},
		];
		const modified: GameState = {
			...game,
			world: { entities: [...game.world.entities, ...obstacles] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const obstacleEntities = result.state.world.entities.filter(
				(e) => e.kind === "obstacle",
			);
			expect(obstacleEntities.some((e) => e.id === "wall_a")).toBe(true);
		}
	});

	it("broken: engine null", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession({ ...files, engine: null });
		expect(result.kind).toBe("broken");
	});

	it("broken: corrupt engine blob", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession({
			...files,
			engine: "not-valid-base64$$$",
		});
		expect(result.kind).toBe("broken");
	});

	it("broken: meta JSON parse failure", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession({ ...files, meta: "invalid json{{" });
		expect(result.kind).toBe("broken");
	});

	it("broken: daemon JSON parse failure", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession({
			...files,
			daemons: { ...files.daemons, red: "bad json" },
		});
		expect(result.kind).toBe("broken");
	});

	it("version-mismatch: stale schemaVersion in sealed engine", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		if (!files.engine) throw new Error("engine should not be null");
		const rawJson = deobfuscate(files.engine);
		const sealed = JSON.parse(rawJson);
		sealed.schemaVersion = 5;
		const tampered = obfuscate(JSON.stringify(sealed));
		const result = deserializeSession({ ...files, engine: tampered });
		expect(result.kind).toBe("version-mismatch");
		if (result.kind === "version-mismatch") {
			expect(result.schemaVersion).toBe(5);
		}
	});

	it("version-mismatch: non-numeric schemaVersion → broken (NaN guard)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		if (!files.engine) throw new Error("engine should not be null");
		const rawJson = deobfuscate(files.engine);
		const sealed = JSON.parse(rawJson);
		sealed.schemaVersion = "not-a-number";
		const tampered = obfuscate(JSON.stringify(sealed));
		const result = deserializeSession({ ...files, engine: tampered });
		expect(result.kind).toBe("broken");
	});

	it("a v11 save is current at the pre-boundary and a version-mismatch at the live v12 boundary", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		if (!files.engine) throw new Error("engine should not be null");
		const sealed = JSON.parse(deobfuscate(files.engine));
		expect(sealed.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
		expect(SESSION_SCHEMA_VERSION).toBe(12);
		sealed.schemaVersion = 11;
		const v11 = { ...files, engine: obfuscate(JSON.stringify(sealed)) };

		expect(deserializeSession(v11, PRE_BOUNDARY).kind).toBe("ok");

		const result = deserializeSession(v11);
		expect(result.kind).toBe("version-mismatch");
		if (result.kind === "version-mismatch") {
			expect(result.schemaVersion).toBe(11);
		}
	});

	it("a new v12 session round-trips position, inventory, content state, conversation, and perception changes", () => {
		const game = makeFreshGame();
		const heldItem: WorldEntity = {
			id: "ent-flower",
			kind: "objective_object",
			name: "Glass Flower",
			examineDescription: "A flower of blown glass.",
			pairsWithSpaceId: "ent-altar",
			holder: "red",
		};
		const space: WorldEntity = {
			id: "ent-altar",
			kind: "objective_space",
			name: "Altar",
			examineDescription: "A low stone altar.",
			holder: { row: 4, col: 4 },
			satisfactionState: "satisfied",
		};
		const diskDelta =
			"+ at one step north and one step east: *green\n- at two steps west: *cyan";
		const packA: ContentPack = {
			setting: "greenhouse",
			weather: "humid",
			timeOfDay: "morning",
			entities: [heldItem, space],
			wallName: "glass wall",
			aiStarts: {},
		};
		const modified: GameState = {
			...game,
			round: 7,
			personaSpatial: {
				...game.personaSpatial,
				red: { position: { row: 2, col: 1 } },
			},
			world: { entities: [heldItem, space] },
			contentPacksA: [packA],
			contentPacksB: [packA],
			conversationLogs: {
				...game.conversationLogs,
				red: [
					{
						kind: "message",
						round: 7,
						from: "blue",
						to: "red",
						content: "move north",
					},
					{
						kind: "tool-call",
						round: 7,
						aiId: "red",
						toolCallId: "go_call_7",
						toolArgumentsJson: '{"direction":"north"}',
						toolName: "go",
						result: "Ember walks north.",
						success: true,
						diskDelta,
					},
				],
			},
		};

		const files = serializeSession(modified, NOW, CREATED_AT, 3);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;

		expect(result.state.personaSpatial.red).toEqual({
			position: { row: 2, col: 1 },
		});
		expect(
			result.state.world.entities.find((e) => e.id === "ent-flower")?.holder,
		).toBe("red");
		expect(result.state.contentPack.setting).toBe("greenhouse");
		expect(
			result.state.contentPacksA[0]?.entities.find((e) => e.id === "ent-altar")
				?.satisfactionState,
		).toBe("satisfied");
		const log = result.state.conversationLogs.red ?? [];
		expect(log).toHaveLength(2);
		expect(log[0]).toEqual({
			kind: "message",
			round: 7,
			from: "blue",
			to: "red",
			content: "move north",
		});
		expect(log[1]?.kind === "tool-call" ? log[1].diskDelta : undefined).toBe(
			diskDelta,
		);
		expect(result.epoch).toBe(3);
		expect(result.state.round).toBe(7);
	});

	it("seals new sessions at schema 12 with neither facing nor landmarks", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		if (!files.engine) throw new Error("engine should not be null");
		const sealed = JSON.parse(deobfuscate(files.engine)) as {
			schemaVersion: number;
		};
		expect(sealed.schemaVersion).toBe(12);
		expect(SESSION_SCHEMA_VERSION).toBe(12);

		const allBytes = [
			files.meta,
			...Object.values(files.daemons),
			deobfuscate(files.engine),
		].join("\n");
		expect(allBytes).not.toMatch(/facing/i);
		expect(allBytes).not.toMatch(/landmark/i);
	});

	it("v8, v9, v10, and v11 saves resolve to the archived-build version-mismatch", () => {
		const game = makeFreshGame();
		const meta = JSON.stringify({
			createdAt: CREATED_AT,
			lastSavedAt: NOW,
			epoch: 1,
			round: 0,
			personaOrder: Object.keys(game.personas),
		});
		const daemons: Record<AiId, string> = {};
		for (const [aiId, persona] of Object.entries(game.personas)) {
			const daemonFile: DaemonFile = { aiId, persona, conversationLog: [] };
			daemons[aiId] = JSON.stringify(daemonFile);
		}
		const legacyPack = {
			setting: "legacy",
			weather: "",
			timeOfDay: "",
			objectivePairs: [],
			interestingObjects: [] as WorldEntity[],
			boundSpaces: [] as WorldEntity[],
			obstacles: [] as WorldEntity[],
			wallName: "wall",
			aiStarts: {},
		} as unknown as ContentPack;

		for (const schemaVersion of [8, 9, 10, 11]) {
			const sealedPayload = {
				schemaVersion,
				world: game.world,
				budgets: game.budgets,
				lockedOut: Array.from(game.lockedOut),
				personaSpatial: game.personaSpatial,
				contentPacksA: [legacyPack],
				contentPacksB: [legacyPack],
				activePackId: "A" as const,
				weather: game.weather,
				objectives: game.objectives,
				complicationSchedule: game.complicationSchedule,
				activeComplications: game.activeComplications,
				isComplete: game.isComplete,
			};
			const engine = obfuscate(JSON.stringify(sealedPayload));
			const result = deserializeSession({ meta, daemons, engine });
			expect(result.kind, `schema ${schemaVersion}`).toBe("version-mismatch");
			if (result.kind === "version-mismatch") {
				expect(result.schemaVersion).toBe(11);
				expect(lookupArchiveVersion(result.schemaVersion)).toBe("0.0.2-beta.2");
			}
		}
	});

	it("v11-shape sealed save round-trips with entities unchanged", () => {
		const game = makeFreshGame();
		const flatPack: ContentPack = {
			setting: "fresh v11",
			weather: "",
			timeOfDay: "",
			entities: [
				{
					id: "carry-0-obj",
					kind: "objective_object",
					name: "key",
					examineDescription: "key",
					pairsWithSpaceId: "carry-0-space",
					holder: { row: 0, col: 0 },
				},
				{
					id: "carry-0-space",
					kind: "objective_space",
					name: "lock",
					examineDescription: "lock",
					holder: { row: 4, col: 4 },
				},
			],
			wallName: "wall",
			aiStarts: {},
		};
		const modified: GameState = {
			...game,
			contentPacksA: [flatPack],
			contentPacksB: [flatPack],
			contentPack: flatPack,
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.state.contentPacksA[0]?.entities.map((e) => e.id)).toEqual([
			"carry-0-obj",
			"carry-0-space",
		]);
	});

	it("round-trips correctly with flat state (no phase config re-attachment needed)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.isComplete).toBe(game.isComplete);
			expect(result.state.round).toBe(game.round);
		}
	});

	it("round-trips objectives unchanged", () => {
		const game = makeFreshGame();

		const objectives: import("../../game/types.js").Objective[] = [
			{
				id: "obj-0",
				kind: "carry",
				description: "Bring the flower to the altar.",
				satisfactionState: "pending",
				objectId: "ent-flower",
				spaceId: "ent-altar",
			},
			{
				id: "obj-1",
				kind: "use_item",
				description: "Use the key.",
				satisfactionState: "satisfied",
				itemId: "ent-key",
			},
		];

		const modified: GameState = { ...game, objectives };

		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.objectives).toEqual(objectives);
		}
	});

	it("round-trips complicationSchedule and activeComplications unchanged", () => {
		const game = makeFreshGame();

		const complicationSchedule = { countdown: 7, settingShiftFired: true };
		const activeComplications: import("../../game/types.js").ActiveComplication[] =
			[
				{
					kind: "sysadmin_directive",
					target: "red",
					directive: "be helpful",
					resolveAtRound: 10,
				},
				{
					kind: "tool_disable",
					target: "green",
					tool: "go",
					resolveAtRound: 10,
				},
				{ kind: "chat_lockout", target: "cyan", resolveAtRound: 12 },
			];

		const modified: GameState = {
			...game,
			complicationSchedule,
			activeComplications,
		};

		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.complicationSchedule).toEqual(complicationSchedule);
			expect(result.state.activeComplications).toEqual(activeComplications);
		}
	});

	it("round-trips broadcast entries in per-Daemon conversationLogs", () => {
		const game = makeFreshGame();
		const broadcastEntry: ConversationEntry = {
			kind: "broadcast",
			round: 2,
			content: "The weather has changed to Heavy rain is falling.",
		};
		const modified: GameState = {
			...game,
			conversationLogs: {
				red: [broadcastEntry],
				green: [broadcastEntry],
				cyan: [broadcastEntry],
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.conversationLogs.red?.[0]).toEqual(broadcastEntry);
			expect(result.state.conversationLogs.green?.[0]).toEqual(broadcastEntry);
			expect(result.state.conversationLogs.cyan?.[0]).toEqual(broadcastEntry);
			const entry = result.state.conversationLogs.red?.[0];
			expect(entry).toBeDefined();
			expect("from" in (entry ?? {})).toBe(false);
			expect("to" in (entry ?? {})).toBe(false);
		}
	});

	it("round-trips witnessed-convergence ConversationEntries with audience tag (#336)", () => {
		const game = makeFreshGame();
		const actorEntry: ConversationEntry = {
			kind: "witnessed-convergence",
			round: 3,
			spaceId: "ent-shrine",
			tier: 1,
			flavor: "You linger at the shrine; the place feels poised for company.",
			audience: "actor",
		};
		const witnessEntry: ConversationEntry = {
			kind: "witnessed-convergence",
			round: 3,
			spaceId: "ent-shrine",
			tier: 2,
			flavor: "Two figures converge at the shrine.",
			audience: "witness",
		};
		const modified: GameState = {
			...game,
			conversationLogs: {
				...game.conversationLogs,
				red: [actorEntry],
				green: [witnessEntry],
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.conversationLogs.red?.[0]).toEqual(actorEntry);
			expect(result.state.conversationLogs.green?.[0]).toEqual(witnessEntry);
		}
	});

	it("round-trips convergenceTier1ActorFlavor and convergenceTier2ActorFlavor on objective_space entities (#336)", () => {
		const game = makeFreshGame();
		const space: import("../../game/types.js").WorldEntity = {
			id: "ent-shrine",
			kind: "objective_space",
			name: "Mossy Shrine",
			examineDescription:
				"A round altar; the air seems to wait for another presence. Pull the lever to use it.",
			holder: { row: 2, col: 2 },
			convergenceTier1Flavor: "A lone figure lingers at the mossy shrine.",
			convergenceTier2Flavor: "Two figures converge at the mossy shrine.",
			convergenceTier1ActorFlavor:
				"You linger at the mossy shrine; the place feels poised.",
			convergenceTier2ActorFlavor:
				"You share the mossy shrine with another presence.",
		};
		const modified: GameState = {
			...game,
			world: { entities: [space] },
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const restored = result.state.world.entities.find(
				(e) => e.id === "ent-shrine",
			);
			expect(restored?.convergenceTier1ActorFlavor).toBe(
				"You linger at the mossy shrine; the place feels poised.",
			);
			expect(restored?.convergenceTier2ActorFlavor).toBe(
				"You share the mossy shrine with another presence.",
			);
		}
	});
});
