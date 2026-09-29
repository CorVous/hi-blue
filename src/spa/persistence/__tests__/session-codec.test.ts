import { describe, expect, it } from "vitest";
import type {
	ActiveComplication,
	AiId,
	ContentPack,
	ConversationEntry,
	GameState,
	Objective,
	WorldEntity,
} from "../../game/types.js";
import { lookupArchiveVersion, SCHEMA_ARCHIVE_MAP } from "../archive-map.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import {
	type DaemonFile,
	type DeserializeResult,
	deserializeSession,
	LAST_SCHEMA_BEFORE_ARCHIVE_ONLY_BUMPS,
	SESSION_SCHEMA_VERSION,
	type SerializedSessionFiles,
	serializeSession,
} from "../session-codec.js";
import type { VersionBoundary } from "../version-boundary.js";
import { makeFreshGame } from "./make-fresh-game.js";

const PRE_BOUNDARY: VersionBoundary = { session: 11, gs: 4 };

const NOW = new Date().toISOString();
const CREATED_AT = "2024-01-01T00:00:00.000Z";

function serializeFresh(): SerializedSessionFiles {
	return serializeSession(makeFreshGame(), NOW, CREATED_AT);
}

function roundTrip(
	state: GameState,
	epoch?: number,
): Extract<DeserializeResult, { kind: "ok" }> {
	const result = deserializeSession(
		serializeSession(state, NOW, CREATED_AT, epoch),
	);
	if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
	return result;
}

function redDaemon(files: SerializedSessionFiles) {
	const daemonJson = files.daemons.red;
	if (!daemonJson) throw new Error("daemons.red should exist");
	return JSON.parse(daemonJson);
}

function unsealEngine(files: SerializedSessionFiles) {
	if (!files.engine) throw new Error("engine should not be null");
	return JSON.parse(deobfuscate(files.engine));
}

function withSealedSchemaVersion(
	files: SerializedSessionFiles,
	schemaVersion: unknown,
): SerializedSessionFiles {
	const sealed = unsealEngine(files);
	sealed.schemaVersion = schemaVersion;
	return { ...files, engine: obfuscate(JSON.stringify(sealed)) };
}

describe("serializeSession / deserializeSession", () => {
	it("round-trips a fresh game (ok) without reviving physicalLog or whispers", () => {
		const result = roundTrip(makeFreshGame());
		expect(result.state.isComplete).toBe(false);
		expect(result.state.round).toBe(0);
		expect(result.createdAt).toBe(CREATED_AT);
		expect(result.lastSavedAt).toBe(NOW);
		expect("physicalLog" in result.state).toBe(false);
		expect("whispers" in result.state).toBe(false);
	});

	it("daemon shape: top-level aiId/persona/conversationLog", () => {
		const daemon = redDaemon(serializeFresh());
		expect(daemon).toHaveProperty("aiId", "red");
		expect(daemon).toHaveProperty("persona");
		expect(daemon).toHaveProperty("conversationLog");
		expect(Array.isArray(daemon.conversationLog)).toBe(true);
		expect(daemon).not.toHaveProperty("phases");
	});

	it("persona block keys are exactly the editable AiPersona surface (no budgetPerPhase, no unset actionProfile)", () => {
		const daemon = redDaemon(serializeFresh());
		expect(Object.keys(daemon.persona).sort()).toEqual(
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

	it("round-trips actionProfile when a persona has one", () => {
		const game = makeFreshGame();
		const red = game.personas.red;
		expect(red).toBeDefined();
		if (red) red.actionProfile = "*red leans toward `go`, `use`.";
		const files = serializeSession(game, NOW, CREATED_AT);
		expect(redDaemon(files).persona.actionProfile).toBe(
			"*red leans toward `go`, `use`.",
		);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.personas.red?.actionProfile).toBe(
				"*red leans toward `go`, `use`.",
			);
		}
	});

	it("pretty-printed with 2-space indent", () => {
		const metaLines = serializeFresh().meta.split("\n");
		expect(metaLines[1]).toMatch(/^ {2}/);
	});

	it("meta has createdAt/lastSavedAt/epoch/round/personaOrder", () => {
		const game = makeFreshGame();
		const meta = JSON.parse(serializeSession(game, NOW, CREATED_AT).meta);
		expect(meta).toHaveProperty("createdAt", CREATED_AT);
		expect(meta).toHaveProperty("lastSavedAt", NOW);
		expect(meta).toHaveProperty("epoch", 1);
		expect(meta).toHaveProperty("round", 0);
		expect(meta.personaOrder).toEqual(Object.keys(game.personas));
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

		const result = deserializeSession({ ...files, daemons: reversedDaemons });
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

		const result = deserializeSession({
			...files,
			meta: JSON.stringify(metaParsed, null, 2),
		});
		if (result.kind !== "ok") {
			throw new Error(`expected ok, got ${result.kind}`);
		}

		expect(Object.keys(result.state.personas)).toEqual(canonicalOrder);
	});

	it("no whispers.txt file in serialized output (whispers live in daemon conversationLog)", () => {
		expect("whispers" in serializeFresh()).toBe(false);
	});

	it("engine field is base64-printable", () => {
		expect(serializeFresh().engine).toMatch(/^[A-Za-z0-9+/=]*$/);
	});

	it("round-trips the exhausted Set", () => {
		const result = roundTrip({
			...makeFreshGame(),
			exhausted: new Set<AiId>(["red"]),
		});
		expect(result.state.exhausted).toBeInstanceOf(Set);
		expect(result.state.exhausted.has("red")).toBe(true);
	});

	it("keeps the on-disk key for exhausted Daemons as lockedOut", () => {
		const files = serializeSession(
			{ ...makeFreshGame(), exhausted: new Set<AiId>(["green"]) },
			NOW,
			CREATED_AT,
		);
		const sealed = unsealEngine(files);
		expect(sealed.lockedOut).toEqual(["green"]);
		expect("exhausted" in sealed).toBe(false);
	});

	it("does not persist outcome and leaves it unset on an unfinished game", () => {
		const files = serializeSession(
			{ ...makeFreshGame(), outcome: "win" },
			NOW,
			CREATED_AT,
		);
		expect("outcome" in unsealEngine(files)).toBe(false);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.outcome).toBeUndefined();
		}
	});

	it("restores outcome win for a completed game whose budgets are not all exhausted", () => {
		const result = roundTrip({
			...makeFreshGame(),
			isComplete: true,
			outcome: "win",
		});
		expect(result.state.isComplete).toBe(true);
		expect(result.state.outcome).toBe("win");
	});

	it("restores outcome lose for a completed game where every budget is exhausted", () => {
		const game = makeFreshGame();
		const result = roundTrip({
			...game,
			objectives: [
				{
					id: "use-space-0",
					kind: "use_space",
					description: "Activate the space.",
					spaceId: "nowhere",
					satisfactionState: "pending",
				},
			],
			isComplete: true,
			outcome: "lose",
			exhausted: new Set<AiId>(Object.keys(game.personas)),
		});
		expect(result.state.outcome).toBe("lose");
	});

	const messageToCyan: ConversationEntry = {
		kind: "message",
		round: 1,
		from: "red",
		to: "cyan",
		content: "psst",
	};
	const witnessedPickUp: ConversationEntry = {
		kind: "witnessed-event",
		round: 2,
		actor: "red",
		actionKind: "pick_up",
		item: "flower",
	};
	const broadcastEntry: ConversationEntry = {
		kind: "broadcast",
		round: 2,
		content: "The weather has changed to Heavy rain is falling.",
	};

	it.each<[string, Record<AiId, ConversationEntry[]>]>([
		[
			"message",
			{
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
		],
		[
			"message and witnessed-event",
			{ red: [], green: [witnessedPickUp], cyan: [messageToCyan] },
		],
		[
			"action-failure",
			{
				red: [
					{
						kind: "action-failure",
						round: 3,
						tool: "go",
						reason: "That cell is blocked by an obstacle",
					},
				],
				green: [],
				cyan: [],
			},
		],
		[
			"tool-call with diskDelta (#376)",
			{
				red: [
					{
						kind: "tool-call",
						round: 4,
						aiId: "red",
						toolCallId: "go_call_1",
						toolArgumentsJson: '{"direction":"north"}',
						toolName: "go",
						result: "Ember walks north.",
						success: true,
						diskDelta: "+ at one step north and one step east: *green",
					},
				],
				green: [],
				cyan: [],
			},
		],
		[
			"pre-#376 tool-call (no diskDelta field)",
			{
				red: [
					{
						kind: "tool-call",
						round: 2,
						aiId: "red",
						toolCallId: "old_call_1",
						toolArgumentsJson: '{"item":"flower"}',
						toolName: "pick_up",
						result: "Ember picked up the flower.",
						success: true,
					},
				],
				green: [],
				cyan: [],
			},
		],
		[
			"broadcast (no from/to)",
			{
				red: [broadcastEntry],
				green: [broadcastEntry],
				cyan: [broadcastEntry],
			},
		],
		[
			"witnessed-convergence with audience tag (#336)",
			{
				red: [
					{
						kind: "witnessed-convergence",
						round: 3,
						spaceId: "ent-shrine",
						tier: 1,
						flavor:
							"You linger at the shrine; the place feels poised for company.",
						audience: "actor",
					},
				],
				green: [
					{
						kind: "witnessed-convergence",
						round: 3,
						spaceId: "ent-shrine",
						tier: 2,
						flavor: "Two figures converge at the shrine.",
						audience: "witness",
					},
				],
				cyan: [],
			},
		],
	])("round-trips %s entries in per-Daemon conversationLogs exactly", (_label, conversationLogs) => {
		const result = roundTrip({ ...makeFreshGame(), conversationLogs });
		expect(result.state.conversationLogs).toStrictEqual(conversationLogs);
	});

	it.each<[string, WorldEntity]>([
		[
			"an interesting_object",
			{
				id: "key",
				kind: "interesting_object",
				name: "The Key",
				examineDescription: "A key",
				holder: { row: 2, col: 3 },
			},
		],
		[
			"interesting_object Use-Item flavor fields (issue #334)",
			{
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
			},
		],
		[
			"objective_space activationFlavor (issue #335)",
			{
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
			},
		],
		[
			"an obstacle",
			{
				id: "wall_a",
				kind: "obstacle",
				name: "wall",
				examineDescription: "A solid wall",
				holder: { row: 0, col: 0 },
			},
		],
		[
			"objective_space convergence actor flavors (#336)",
			{
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
			},
		],
	])("round-trips %s world entity unchanged", (_label, entity) => {
		const game = makeFreshGame();
		const result = roundTrip({
			...game,
			world: { entities: [...game.world.entities, entity] },
		});
		expect(
			result.state.world.entities.find((e) => e.id === entity.id),
		).toStrictEqual(entity);
	});

	it("round-trips budgets", () => {
		const result = roundTrip({
			...makeFreshGame(),
			budgets: {
				red: { remaining: 0.03, total: 0.05 },
				green: { remaining: 0.05, total: 0.05 },
				cyan: { remaining: 0.04, total: 0.05 },
			},
		});
		expect(result.state.budgets.red).toEqual({
			remaining: 0.03,
			total: 0.05,
		});
	});

	it("round-trips personaSpatial", () => {
		const result = roundTrip({
			...makeFreshGame(),
			personaSpatial: {
				red: { position: { row: 2, col: 3 } },
				green: { position: { row: 1, col: 1 } },
				cyan: { position: { row: 4, col: 4 } },
			},
		});
		expect(result.state.personaSpatial.red).toEqual({
			position: { row: 2, col: 3 },
		});
	});

	it.each<[string, (files: SerializedSessionFiles) => SerializedSessionFiles]>([
		["engine null", (files) => ({ ...files, engine: null })],
		[
			"corrupt engine blob",
			(files) => ({ ...files, engine: "not-valid-base64$$$" }),
		],
		[
			"meta JSON parse failure",
			(files) => ({ ...files, meta: "invalid json{{" }),
		],
		[
			"daemon JSON parse failure",
			(files) => ({ ...files, daemons: { ...files.daemons, red: "bad json" } }),
		],
		[
			"non-numeric schemaVersion (NaN guard)",
			(files) => withSealedSchemaVersion(files, "not-a-number"),
		],
	])("broken: %s", (_label, corrupt) => {
		expect(deserializeSession(corrupt(serializeFresh())).kind).toBe("broken");
	});

	it.each([
		["missing", { aiId: "red", conversationLog: [] }],
		["null", { aiId: "red", persona: null, conversationLog: [] }],
		["a string", { aiId: "red", persona: "Ember", conversationLog: [] }],
		["an array", { aiId: "red", persona: [], conversationLog: [] }],
	])("broken: daemon file parses but its persona is %s", (_label, daemon) => {
		const files = serializeFresh();
		const result = deserializeSession({
			...files,
			daemons: { ...files.daemons, red: JSON.stringify(daemon) },
		});
		expect(result.kind).toBe("broken");
	});

	it("version-mismatch: stale schemaVersion in sealed engine", () => {
		const result = deserializeSession(
			withSealedSchemaVersion(serializeFresh(), 5),
		);
		expect(result.kind).toBe("version-mismatch");
		if (result.kind === "version-mismatch") {
			expect(result.schemaVersion).toBe(5);
		}
	});

	it("a v11 save is current at the pre-boundary and a version-mismatch at the live v12 boundary", () => {
		const v11 = withSealedSchemaVersion(serializeFresh(), 11);

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

		const result = roundTrip(modified, 3);

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
		const files = serializeFresh();
		expect(unsealEngine(files).schemaVersion).toBe(12);
		expect(SESSION_SCHEMA_VERSION).toBe(12);

		const allBytes = [
			files.meta,
			...Object.values(files.daemons),
			deobfuscate(files.engine as string),
		].join("\n");
		expect(allBytes).not.toMatch(/facing/i);
		expect(allBytes).not.toMatch(/landmark/i);
	});

	it("the legacy-schema clamp target has an archived build in SCHEMA_ARCHIVE_MAP", () => {
		expect(
			SCHEMA_ARCHIVE_MAP[LAST_SCHEMA_BEFORE_ARCHIVE_ONLY_BUMPS],
		).toBeDefined();
		expect(LAST_SCHEMA_BEFORE_ARCHIVE_ONLY_BUMPS).toBeLessThan(
			SESSION_SCHEMA_VERSION,
		);
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
				lockedOut: Array.from(game.exhausted),
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
		const result = roundTrip({
			...makeFreshGame(),
			contentPacksA: [flatPack],
			contentPacksB: [flatPack],
			contentPack: flatPack,
		});
		expect(result.state.contentPacksA[0]?.entities.map((e) => e.id)).toEqual([
			"carry-0-obj",
			"carry-0-space",
		]);
	});

	it("round-trips objectives unchanged", () => {
		const objectives: Objective[] = [
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

		const result = roundTrip({ ...makeFreshGame(), objectives });

		expect(result.state.objectives).toEqual(objectives);
	});

	it("round-trips complicationSchedule and activeComplications unchanged", () => {
		const complicationSchedule = { countdown: 7, settingShiftFired: true };
		const activeComplications: ActiveComplication[] = [
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

		const result = roundTrip({
			...makeFreshGame(),
			complicationSchedule,
			activeComplications,
		});

		expect(result.state.complicationSchedule).toEqual(complicationSchedule);
		expect(result.state.activeComplications).toEqual(activeComplications);
	});
});
