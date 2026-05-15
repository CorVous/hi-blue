import { describe, expect, it } from "vitest";
import { DEFAULT_LANDMARKS } from "../../game/direction.js";
import { startGame } from "../../game/engine.js";
import type {
	AiId,
	AiPersona,
	ContentPack,
	ConversationEntry,
	GameState,
	WorldEntity,
} from "../../game/types.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import {
	type DaemonFile,
	deserializeSession,
	serializeSession,
} from "../session-codec.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_CONTENT_PACK: ContentPack = {
	setting: "",
	weather: "",
	timeOfDay: "",
	objectivePairs: [],
	interestingObjects: [],
	obstacles: [],
	landmarks: DEFAULT_LANDMARKS,
	aiStarts: {},
};

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

// ── Tests ─────────────────────────────────────────────────────────────────────

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

	it("pretty-printed with 2-space indent", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const metaLines = files.meta.split("\n");
		// Second line should start with two spaces
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
		// Must preserve insertion order of state.personas
		expect(meta.personaOrder).toEqual(Object.keys(game.personas));
	});

	it("deserializeSession honours personaOrder from meta (panel ordering preserved)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			// The key order of restored personas must match the original.
			expect(Object.keys(result.state.personas)).toEqual(
				Object.keys(game.personas),
			);
		}
	});

	it("deserializeSession honours meta.personaOrder when daemon-file key order differs", () => {
		const game = makeFreshGame();
		// Capture the canonical order from the original state.
		const canonicalOrder = Object.keys(game.personas);
		expect(canonicalOrder.length).toBeGreaterThanOrEqual(2); // sanity: ≥2 personas

		const files = serializeSession(game, NOW, CREATED_AT);

		// Reconstruct daemons in REVERSED key order — this is the scenario localStorage produces.
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

		// The fix should restore canonical order regardless of daemon-file key order.
		expect(Object.keys(result.state.personas)).toEqual(canonicalOrder);
	});

	it("deserializeSession falls back to daemon-file key order when personaOrder is absent (legacy meta)", () => {
		const game = makeFreshGame();
		const canonicalOrder = Object.keys(game.personas);

		const files = serializeSession(game, NOW, CREATED_AT);

		// Strip personaOrder from meta (simulates a hand-edited or pre-personaOrder save).
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

		// Falls back to daemon-file key order (which equals canonicalOrder in this fixture).
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
			// message entry round-trips in cyan's log
			expect(result.state.conversationLogs.cyan?.[0]).toEqual(messageEntry);
			// witnessed-event round-trips in green's log
			expect(result.state.conversationLogs.green?.[0]).toEqual(witnessedEntry);
			// No physicalLog or whispers fields on state (regression guards)
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
			// Peer logs should remain empty
			expect(result.state.conversationLogs.green ?? []).toHaveLength(0);
			expect(result.state.conversationLogs.cyan ?? []).toHaveLength(0);
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
				red: { position: { row: 2, col: 3 }, facing: "east" as const },
				green: { position: { row: 1, col: 1 }, facing: "south" as const },
				cyan: { position: { row: 4, col: 4 }, facing: "west" as const },
			},
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.personaSpatial.red).toEqual({
				position: { row: 2, col: 3 },
				facing: "east",
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
		// Deobfuscate, modify schemaVersion, re-obfuscate
		if (!files.engine) throw new Error("engine should not be null");
		const rawJson = deobfuscate(files.engine);
		const sealed = JSON.parse(rawJson);
		sealed.schemaVersion = 5;
		const tampered = obfuscate(JSON.stringify(sealed));
		const result = deserializeSession({ ...files, engine: tampered });
		expect(result.kind).toBe("version-mismatch");
	});

	it("v8 save with multi-entry contentPacksA/B is migrated to v9 by truncating to first entry", () => {
		// Create a v8-style sealed engine with 3 content packs each
		const testPack: ContentPack = {
			setting: "test setting",
			weather: "sunny",
			timeOfDay: "morning",
			objectivePairs: [],
			interestingObjects: [],
			obstacles: [],
			landmarks: DEFAULT_LANDMARKS,
			aiStarts: {},
		};
		const testPackVariant2: ContentPack = {
			...testPack,
			setting: "test setting 2",
		};
		const testPackVariant3: ContentPack = {
			...testPack,
			setting: "test setting 3",
		};

		const game = makeFreshGame();
		const v8SealedPayload = {
			schemaVersion: 8,
			world: game.world,
			budgets: game.budgets,
			lockedOut: Array.from(game.lockedOut),
			personaSpatial: game.personaSpatial,
			// v8 had 3 packs per side
			contentPacksA: [testPack, testPackVariant2, testPackVariant3],
			contentPacksB: [testPack, testPackVariant2, testPackVariant3],
			activePackId: "A" as const,
			weather: game.weather,
			objectives: game.objectives,
			complicationSchedule: game.complicationSchedule,
			activeComplications: game.activeComplications,
			isComplete: game.isComplete,
		};

		const engine = obfuscate(JSON.stringify(v8SealedPayload, null, 2));
		const meta = JSON.stringify({
			createdAt: CREATED_AT,
			lastSavedAt: NOW,
			epoch: 1,
			round: 0,
			personaOrder: Object.keys(game.personas),
		});

		// Reconstruct daemon files from game
		const daemons: Record<AiId, string> = {};
		for (const [aiId, persona] of Object.entries(game.personas)) {
			const daemonFile: DaemonFile = {
				aiId,
				persona: {
					id: persona.id,
					name: persona.name,
					color: persona.color,
					temperaments: persona.temperaments,
					personaGoal: persona.personaGoal,
					blurb: persona.blurb,
					typingQuirks: persona.typingQuirks,
					voiceExamples: persona.voiceExamples,
				},
				conversationLog: [],
			};
			daemons[aiId] = JSON.stringify(daemonFile, null, 2);
		}

		const result = deserializeSession({ meta, daemons, engine });
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			// v8 packs (3 entries each) should be migrated to v9 by truncating to 1 entry
			expect(result.state.contentPacksA).toHaveLength(1);
			expect(result.state.contentPacksB).toHaveLength(1);
			// The remaining entries should be the original first pack
			expect(result.state.contentPacksA[0]?.setting).toBe(testPack.setting);
			expect(result.state.contentPacksB[0]?.setting).toBe(testPack.setting);
		}
	});

	it("round-trips correctly with flat state (no phase config re-attachment needed)", () => {
		// In the flat model (#295), there are no nextPhaseConfig / winCondition
		// fields to re-attach. The round-trip should still succeed.
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			// Flat state: no phase chain — just verify basic fields survived round-trip
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
			// Broadcast entry round-trips in all three daemon logs
			expect(result.state.conversationLogs.red?.[0]).toEqual(broadcastEntry);
			expect(result.state.conversationLogs.green?.[0]).toEqual(broadcastEntry);
			expect(result.state.conversationLogs.cyan?.[0]).toEqual(broadcastEntry);
			// Ensure broadcast has no from/to fields
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
