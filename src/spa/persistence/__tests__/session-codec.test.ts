import { describe, expect, it } from "vitest";
import { PHASE_1_CONFIG } from "../../../content/index.js";
import { createGame, startPhase } from "../../game/engine.js";
import type {
	AiId,
	AiPersona,
	ConversationEntry,
	GameState,
	WorldEntity,
} from "../../game/types.js";
import { deobfuscate, obfuscate } from "../sealed-blob-codec.js";
import { deserializeSession, serializeSession } from "../session-codec.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		blurb: "You are hot-headed and zealous. Hold the flower at phase end.",
		typingQuirks: ["fragments", "ALL CAPS"],
		voiceExamples: ["Now.", "BURN IT.", "Soon, soon."],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		blurb: "You are intensely meticulous. Ensure items are evenly distributed.",
		typingQuirks: ["ellipses", "no contractions"],
		voiceExamples: [
			"I will count again...",
			"That is not balanced.",
			"One more sweep through the list.",
		],
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		blurb: "You are laconic and diffident. Hold the key at phase end.",
		typingQuirks: ["lowercase only", "fragments"],
		voiceExamples: ["sure.", "if you say so.", "fine."],
	},
};

function makeFreshGame(): GameState {
	const game = createGame(TEST_PERSONAS);
	return startPhase(game, PHASE_1_CONFIG, () => 0);
}

const NOW = new Date().toISOString();
const CREATED_AT = "2024-01-01T00:00:00.000Z";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("serializeSession / deserializeSession", () => {
	it("round-trips a fresh phase-1 game (ok)", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.currentPhase).toBe(1);
			expect(result.state.phases).toHaveLength(1);
			expect(result.state.isComplete).toBe(false);
			expect(result.createdAt).toBe(CREATED_AT);
			expect(result.lastSavedAt).toBe(NOW);
		}
	});

	it("daemon shape: top-level aiId/persona/phases, all three phases present", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const daemonJson = files.daemons.red;
		expect(daemonJson).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: toBeDefined() guards this
		const daemon = JSON.parse(daemonJson!);
		expect(daemon).toHaveProperty("aiId", "red");
		expect(daemon).toHaveProperty("persona");
		expect(daemon).toHaveProperty("phases");
		expect(daemon.phases).toHaveProperty("1");
		expect(daemon.phases).toHaveProperty("2");
		expect(daemon.phases).toHaveProperty("3");
	});

	it("unstarted phases have empty conversationLog and phaseGoal", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		// biome-ignore lint/style/noNonNullAssertion: daemons.red always exists for this fixture
		const daemon = JSON.parse(files.daemons.red!);
		// Phase 2 and 3 have not started
		// biome-ignore lint/suspicious/noExplicitAny: daemon is dynamically parsed JSON
		expect((daemon as any).phases["2"].conversationLog).toEqual([]);
		// biome-ignore lint/suspicious/noExplicitAny: daemon is dynamically parsed JSON
		expect((daemon as any).phases["2"].phaseGoal).toBe("");
		// biome-ignore lint/suspicious/noExplicitAny: daemon is dynamically parsed JSON
		expect((daemon as any).phases["3"].conversationLog).toEqual([]);
		// biome-ignore lint/suspicious/noExplicitAny: daemon is dynamically parsed JSON
		expect((daemon as any).phases["3"].phaseGoal).toBe("");
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

	it("meta has createdAt/lastSavedAt/phase/round/personaOrder", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const meta = JSON.parse(files.meta);
		expect(meta).toHaveProperty("createdAt", CREATED_AT);
		expect(meta).toHaveProperty("lastSavedAt", NOW);
		expect(meta).toHaveProperty("phase", 1);
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

	it("round-trips lockedOut Set and chatLockouts Map", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modified: GameState = {
			...game,
			phases: [
				{
					...phase,
					lockedOut: new Set<AiId>(["red"]),
					chatLockouts: new Map<AiId, number>([["green", 5]]),
				},
			],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const rp = result.state.phases[0];
			expect(rp?.lockedOut).toBeInstanceOf(Set);
			expect(rp?.lockedOut.has("red")).toBe(true);
			expect(rp?.chatLockouts).toBeInstanceOf(Map);
			expect(rp?.chatLockouts.get("green")).toBe(5);
		}
	});

	it("round-trips conversation logs", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modified: GameState = {
			...game,
			phases: [
				{
					...phase,
					conversationLogs: {
						red: [
							{ kind: "chat", role: "player", content: "hello red", round: 0 },
						],
						green: [
							{ kind: "chat", role: "ai", content: "green reply", round: 0 },
						],
						blue: [],
					},
				},
			],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const rp = result.state.phases[0];
			expect(rp?.conversationLogs.red).toEqual([
				{ kind: "chat", role: "player", content: "hello red", round: 0 },
			]);
			expect(rp?.conversationLogs.green).toEqual([
				{ kind: "chat", role: "ai", content: "green reply", round: 0 },
			]);
		}
	});

	it("round-trips whisper and witnessed-event entries via per-Daemon conversationLog (fixes v1 amnesia)", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const whisperEntry: ConversationEntry = {
			kind: "whisper",
			round: 1,
			from: "red" as AiId,
			to: "blue" as AiId,
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
			phases: [
				{
					...phase,
					conversationLogs: {
						...phase.conversationLogs,
						blue: [whisperEntry],
						green: [witnessedEntry],
					},
				},
			],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const rp = result.state.phases[0];
			// whisper entry round-trips in blue's log
			expect(rp?.conversationLogs.blue?.[0]).toEqual(whisperEntry);
			// witnessed-event round-trips in green's log
			expect(rp?.conversationLogs.green?.[0]).toEqual(witnessedEntry);
			// No physicalLog or whispers fields on phase (regression guards)
			expect("physicalLog" in (rp ?? {})).toBe(false);
			expect("whispers" in (rp ?? {})).toBe(false);
		}
	});

	it("round-trips world entities", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const entity: WorldEntity = {
			id: "key",
			kind: "interesting_object",
			name: "The Key",
			examineDescription: "A key",
			holder: { row: 2, col: 3 },
		};
		const modified: GameState = {
			...game,
			phases: [{ ...phase, world: { entities: [entity] } }],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.phases[0]?.world.entities[0]).toMatchObject({
				id: "key",
				name: "The Key",
				holder: { row: 2, col: 3 },
			});
		}
	});

	it("round-trips budgets", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modified: GameState = {
			...game,
			phases: [
				{
					...phase,
					budgets: {
						red: { remaining: 0.03, total: 0.05 },
						green: { remaining: 0.05, total: 0.05 },
						blue: { remaining: 0.04, total: 0.05 },
					},
				},
			],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.phases[0]?.budgets.red).toEqual({
				remaining: 0.03,
				total: 0.05,
			});
		}
	});

	it("round-trips personaSpatial", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
		const modified: GameState = {
			...game,
			phases: [
				{
					...phase,
					personaSpatial: {
						red: { position: { row: 2, col: 3 }, facing: "east" as const },
						green: { position: { row: 1, col: 1 }, facing: "south" as const },
						blue: { position: { row: 4, col: 4 }, facing: "west" as const },
					},
				},
			],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(result.state.phases[0]?.personaSpatial.red).toEqual({
				position: { row: 2, col: 3 },
				facing: "east",
			});
		}
	});

	it("round-trips obstacle entities", () => {
		const game = makeFreshGame();
		const phase = game.phases[0];
		if (!phase) throw new Error("no phase");
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
			phases: [
				{
					...phase,
					world: { entities: [...phase.world.entities, ...obstacles] },
				},
			],
		};
		const files = serializeSession(modified, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const obstacleEntities = result.state.phases[0]?.world.entities.filter(
				(e) => e.kind === "obstacle",
			);
			expect(obstacleEntities?.some((e) => e.id === "wall_a")).toBe(true);
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
		sealed.schemaVersion = 999;
		const tampered = obfuscate(JSON.stringify(sealed));
		const result = deserializeSession({ ...files, engine: tampered });
		expect(result.kind).toBe("version-mismatch");
	});

	it("re-attaches nextPhaseConfig and winCondition from canonical phase chain", () => {
		const game = makeFreshGame();
		const files = serializeSession(game, NOW, CREATED_AT);
		const result = deserializeSession(files);
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			const phase = result.state.phases[0];
			// PHASE_1_CONFIG has nextPhaseConfig (PHASE_2_CONFIG)
			expect(phase?.nextPhaseConfig).toBeDefined();
			expect(phase?.nextPhaseConfig?.phaseNumber).toBe(2);
			// winCondition should be re-attached
			expect(typeof phase?.winCondition).toBe("function");
		}
	});
});
