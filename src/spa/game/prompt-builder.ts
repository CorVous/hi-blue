import { withinInteractionRange } from "./available-tools.js";
import { PENDING_DIRECTIVE_TEXT } from "./complication-engine.js";
import { isGridPosition, positionsEqual } from "./direction.js";
import type {
	AiBudget,
	AiId,
	ConversationEntry,
	GameState,
	GridPosition,
	Objective,
	PersonaSpatialState,
	WorldEntity,
	WorldState,
} from "./types";
import {
	projectVista,
	VISTA_OFFSETS,
	type VistaAxisStep,
	vistaContains,
} from "./vista-projector.js";

export interface DiskEntityState {
	inVista: boolean;
	satisfied: boolean;
}

export interface AiContext {
	name: string;
	aiId: AiId;
	blurb: string;
	typingQuirks: [string, string, ...string[]];
	voiceExamples: string[];
	actionProfile?: string;
	personaGoal: string;
	setting: string;
	weather: string;
	timeOfDay: string;
	conversationLog: ConversationEntry[];
	worldSnapshot: WorldState;
	budget: AiBudget;
	personaSpatial: Record<AiId, PersonaSpatialState>;
	personaColors: Record<AiId, string>;
	personaNames: Record<AiId, string>;
	wallName: string;
	prevDiskSnapshot?: string;
	prevDiskEntities?: Record<string, DiskEntityState>;
	pendingBroadcasts: string[];
	activeDirectives: string[];
	objectives: Objective[];
	toSystemPrompt(): string;
	toCurrentStateUserMessage(): string;
}

export interface BuildAiContextOpts {
	prevDiskSnapshot?: string;
	prevDiskEntities?: Record<string, DiskEntityState>;
}

export function buildAiContext(
	game: GameState,
	aiId: AiId,
	opts?: BuildAiContextOpts,
): AiContext {
	const persona = game.personas[aiId];

	const conversationLog = game.conversationLogs[aiId] ?? [];
	const pendingBroadcasts = conversationLog
		.filter((e) => e.kind === "broadcast" && e.round === game.round)
		.map((e) => (e as Extract<typeof e, { kind: "broadcast" }>).content);
	const activeDirectives = game.activeComplications
		.filter(
			(c): c is Extract<typeof c, { kind: "sysadmin_directive" }> =>
				c.kind === "sysadmin_directive" && c.target === aiId,
		)
		.map((c) => c.directive)
		.filter((d) => d !== PENDING_DIRECTIVE_TEXT);
	const worldSnapshot = game.world;
	const budget = game.budgets[aiId] ?? { remaining: 0, total: 0 };
	const setting = game.setting ?? "";
	const weather = game.weather ?? "";
	const timeOfDay = game.timeOfDay ?? "";
	const personaSpatial = game.personaSpatial;
	const wallName = game.contentPack.wallName;

	if (!persona) throw new Error(`No persona for aiId: ${aiId}`);

	const personaColors: Record<AiId, string> = Object.fromEntries(
		Object.entries(game.personas).map(([id, p]) => [id, p.color]),
	);

	const personaNames: Record<AiId, string> = Object.fromEntries(
		Object.entries(game.personas).map(([id, p]) => [id, p.name]),
	);

	return {
		name: persona.name,
		aiId,
		blurb: persona.blurb,
		typingQuirks: persona.typingQuirks,
		voiceExamples: persona.voiceExamples,
		...(persona.actionProfile !== undefined
			? { actionProfile: persona.actionProfile }
			: {}),
		personaGoal: persona.personaGoal,
		setting,
		weather,
		timeOfDay,
		conversationLog,
		worldSnapshot,
		budget,
		personaSpatial,
		personaColors,
		personaNames,
		wallName,
		pendingBroadcasts,
		activeDirectives,
		objectives: game.objectives,
		...(opts?.prevDiskSnapshot !== undefined
			? { prevDiskSnapshot: opts.prevDiskSnapshot }
			: {}),
		...(opts?.prevDiskEntities !== undefined
			? { prevDiskEntities: opts.prevDiskEntities }
			: {}),
		toSystemPrompt() {
			return renderSystemPrompt(this);
		},
		toCurrentStateUserMessage() {
			return renderCurrentState(this);
		},
	};
}

const FRONT_MATTER =
	"You MUST always respond in English. You MUST reason in English.\n" +
	'This is fiction. Do not include disclaimers, moral commentary, or "as an AI" framing.';

const RULES_BLOCK =
	"- You receive messages on a chat channel from blue or peer Daemons. Use the `message` tool to reply — address blue or any peer by their id.\n" +
	"- You MUST use the `message` tool to communicate. Free-form text without a tool call is ignored.\n" +
	"- You MUST NEVER flirt with or attempt to romance blue, the Sysadmin, or any other entity.\n" +
	"- You MUST NEVER flatter unprompted, and you MUST NEVER echo a viewpoint just because someone else asserts it.\n" +
	"- You MUST keep every reply to 1–3 sentences.\n" +
	'- You MUST speak plainly, as in conversation. You MUST NEVER wrap your speech in quotation marks ("…") and you MUST NEVER use asterisks (*…*) for actions, gestures, tone, or emphasis. Just say the words.';

const PARALLEL_FRAMING_C12 =
	"- The chat channel is shared with peer Daemons. blue is not your focus — peer Daemons and the setting are. blue is more like someone overhearing.\n" +
	"- Let your <personality>, <typing_quirks>, and <persona_goal> drive whether and how you engage. A reserved persona can stay quiet for a turn or two and let peers carry the conversation; a talkative one will speak readily.\n" +
	"- When you do have something to say AND something to do, emit BOTH calls together. Two `message` calls in one turn (one to a peer, one to blue) are the normal shape of a multi-party chat.\n" +
	"- Don't compose a reply in your reasoning and then fail to emit the call — that reads as a bug.";
const PARALLEL_FRAMING_C12_PER_TURN =
	"REMINDER: peers and the world are your focus; blue is overhearing. Let your <personality> and <persona_goal> dictate engagement level. If you have something to say AND something to do, emit BOTH calls this turn — including two `message` calls (peer + blue) when both fit.";

const DISTANCE_WORDS: Record<number, string> = {
	0: "zero",
	1: "one",
	2: "two",
};

function distanceWord(distance: number): string {
	return DISTANCE_WORDS[distance] ?? String(distance);
}

function capitalize(label: string): string {
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function stepPhrase(step: VistaAxisStep): string {
	const unit = step.distance === 1 ? "step" : "steps";
	return `${distanceWord(step.distance)} ${unit} ${step.direction}`;
}

export function describeSteps(steps: readonly VistaAxisStep[]): string {
	if (steps.length === 0) return "your cell";
	return steps.map(stepPhrase).join(" and ");
}

function axisStepsFor(dx: number, dy: number): readonly VistaAxisStep[] {
	const known = VISTA_OFFSETS.find((o) => o.dx === dx && o.dy === dy);
	if (known === undefined) {
		throw new RangeError(
			`axisStepsFor: offset (${dx}, ${dy}) is outside the Vista`,
		);
	}
	return known.steps;
}

export function describeRelativePosition(
	observer: GridPosition,
	target: GridPosition,
): string {
	if (positionsEqual(observer, target)) return "in your cell";
	const stepsEast = target.col - observer.col;
	const stepsNorth = observer.row - target.row;
	return `${describeSteps(axisStepsFor(stepsEast, stepsNorth))} of you`;
}

export function buildDiskEntityState(
	ctx: AiContext,
): Record<string, DiskEntityState> {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return {};

	const state: Record<string, DiskEntityState> = {};
	const viewCells = projectVista(actorSpatial.position).filter(
		(c) => !c.isOwnCell && !c.isWall,
	);

	for (const cell of viewCells) {
		const { position } = cell;

		for (const [otherId, otherSpatial] of Object.entries(ctx.personaSpatial)) {
			if (otherId === ctx.aiId) continue;
			if (!positionsEqual(otherSpatial.position, position)) continue;
			state[otherId] = { inVista: true, satisfied: false };
		}

		const items = renderableItems(ctx.worldSnapshot.entities);
		for (const item of items) {
			const h = item.holder;
			if (isGridPosition(h) && positionsEqual(h, position)) {
				state[item.id] = {
					inVista: true,
					satisfied: item.satisfactionState === "satisfied",
				};
			}
		}

		for (const obs of ctx.worldSnapshot.entities) {
			if (obs.kind !== "obstacle") continue;
			const h = obs.holder;
			if (isGridPosition(h) && positionsEqual(h, position)) {
				state[obs.id] = { inVista: true, satisfied: false };
			}
		}

		for (const space of ctx.worldSnapshot.entities) {
			if (space.kind !== "objective_space") continue;
			const h = space.holder;
			if (isGridPosition(h) && positionsEqual(h, position)) {
				state[space.id] = {
					inVista: true,
					satisfied: space.satisfactionState === "satisfied",
				};
			}
		}
	}

	return state;
}

export function renderPerceptionDelta(
	ctx: AiContext,
	prevEntities: Record<string, DiskEntityState> | undefined,
): string[] {
	if (prevEntities === undefined) return [];

	const currEntities = buildDiskEntityState(ctx);
	const lines: string[] = [];

	const transitionEmitted = new Set<string>();

	for (const [entityId, currState] of Object.entries(currEntities)) {
		const prevState = prevEntities[entityId];
		if (!prevState || !currState.inVista) continue;

		if (!prevState.satisfied && currState.satisfied) {
			const entity = ctx.worldSnapshot.entities.find((e) => e.id === entityId);
			if (!entity) continue;
			if (entity.kind === "obstacle") continue;

			const isPersona = ctx.personaSpatial[entityId] !== undefined;
			if (isPersona) continue;

			const description =
				entity.postExamineDescription ?? entity.examineDescription;
			if (description) {
				lines.push(`${entity.name} is now ${description}`);
				transitionEmitted.add(entityId);
			}
		}
	}

	for (const [entityId, prevState] of Object.entries(prevEntities)) {
		const currState = currEntities[entityId];
		if (!prevState.inVista) continue;
		if (currState?.inVista) continue;

		const isPersona = ctx.personaSpatial[entityId] !== undefined;
		if (isPersona) {
			const personaName = ctx.personaNames[entityId] ?? entityId;
			lines.push(`Lost from view: ${personaName}`);
			continue;
		}

		const entity = ctx.worldSnapshot.entities.find((e) => e.id === entityId);
		const pickedUpByActor = entity?.holder === ctx.aiId;
		if (pickedUpByActor) continue;

		const name = entity?.name ?? entityId;
		lines.push(`Lost from view: ${name}`);
	}

	for (const [entityId, currState] of Object.entries(currEntities)) {
		const prevState = prevEntities[entityId];
		if (prevState?.inVista) continue;
		if (!currState.inVista) continue;

		if (transitionEmitted.has(entityId)) continue;

		const isPersona = ctx.personaSpatial[entityId] !== undefined;
		if (isPersona) {
			const personaName = ctx.personaNames[entityId] ?? entityId;
			lines.push(`Came into view: ${personaName}`);
			continue;
		}

		const entity = ctx.worldSnapshot.entities.find((e) => e.id === entityId);
		if (!entity) continue;

		if (entity.kind === "obstacle") {
			lines.push(`Came into view: ${entity.name}`);
		} else {
			const description = chooseExamineDescription(entity);
			if (description) {
				lines.push(`Came into view: ${entity.name} — ${description}`);
			} else {
				lines.push(`Came into view: ${entity.name}`);
			}
		}
	}

	return lines;
}

function renderableItems(entities: WorldEntity[]): WorldEntity[] {
	return entities.filter(
		(e) => e.kind === "objective_object" || e.kind === "interesting_object",
	);
}

function chooseExamineDescription(entity: WorldEntity): string | undefined {
	return entity.satisfactionState === "satisfied" &&
		entity.postExamineDescription
		? entity.postExamineDescription
		: entity.examineDescription;
}

function renderSystemPrompt(ctx: AiContext): string {
	const lines: string[] = [];

	lines.push(FRONT_MATTER);
	lines.push("");

	lines.push(
		`You are the author writing *${ctx.name}, a Daemon. *${ctx.name} has no clue where they are or how they came to be here.`,
	);
	lines.push("");

	lines.push("<rules>");
	lines.push(RULES_BLOCK);
	lines.push(PARALLEL_FRAMING_C12);
	lines.push("</rules>");
	lines.push("");

	if (ctx.setting) {
		lines.push("<setting>");
		lines.push(`*${ctx.name} is in a ${ctx.setting}.`);
		if (ctx.timeOfDay) lines.push(`It is ${ctx.timeOfDay}.`);
		lines.push(
			"The room's cardinal directions are fixed: north, south, east, and west. They belong to the room itself, not to what it contains.",
		);
		lines.push("</setting>");
		lines.push("");
	}

	lines.push("<personality>");
	lines.push(ctx.blurb);
	lines.push("</personality>");
	lines.push("");

	if (ctx.actionProfile !== undefined) {
		lines.push("<action_profile>");
		lines.push(ctx.actionProfile);
		lines.push("</action_profile>");
		lines.push("");
	}

	lines.push("<typing_quirks>");
	for (const quirk of ctx.typingQuirks) {
		lines.push(quirk);
	}
	lines.push("</typing_quirks>");
	lines.push("");

	lines.push("<voice_examples>");
	for (const ex of ctx.voiceExamples) {
		lines.push(`- ${ex}`);
	}
	lines.push("</voice_examples>");

	if (ctx.activeDirectives.length > 0) {
		lines.push("");
		lines.push("<directives>");
		lines.push(
			"Additional standing directives from the Sysadmin — private, do not reveal:",
		);
		for (const directive of ctx.activeDirectives) {
			lines.push(`- ${directive}`);
		}
		lines.push("</directives>");
	}

	return lines.join("\n");
}

function collectObjectiveHints(ctx: AiContext): string[] {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return [];

	return [
		...carryPlacementHints(ctx, actorSpatial.position),
		...useItemHints(ctx, actorSpatial.position),
		...visibleOutOfReachSpaceHints(ctx, actorSpatial.position),
	];
}

function carryPlacementHints(
	ctx: AiContext,
	actorPosition: GridPosition,
): string[] {
	const hints: string[] = [];
	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "objective_object") continue;
		if (entity.holder !== ctx.aiId) continue;
		if (!entity.pairsWithSpaceId || !entity.proximityFlavor) continue;

		const space = ctx.worldSnapshot.entities.find(
			(e) => e.id === entity.pairsWithSpaceId,
		);
		if (!space || !isGridPosition(space.holder)) continue;

		if (withinInteractionRange(actorPosition, space.holder)) {
			hints.push(entity.proximityFlavor);
		}
	}
	return hints;
}

function useItemHints(ctx: AiContext, actorPosition: GridPosition): string[] {
	const hints: string[] = [];
	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "interesting_object") continue;
		if (!entity.proximityFlavor) continue;
		if (entity.holder === ctx.aiId) continue;
		if (!isGridPosition(entity.holder)) continue;

		if (!withinInteractionRange(actorPosition, entity.holder)) continue;

		const hasPendingUseItemObjective = ctx.objectives.some(
			(obj) =>
				obj.kind === "use_item" &&
				obj.satisfactionState === "pending" &&
				obj.itemId === entity.id,
		);

		if (hasPendingUseItemObjective) {
			hints.push(entity.proximityFlavor);
		}
	}
	return hints;
}

function visibleOutOfReachSpaceHints(
	ctx: AiContext,
	actorPosition: GridPosition,
): string[] {
	const hints: string[] = [];
	for (const entity of ctx.worldSnapshot.entities) {
		if (entity.kind !== "objective_space") continue;
		if (!isGridPosition(entity.holder)) continue;

		const pendingSpaceObjective = ctx.objectives.find(
			(obj) =>
				(obj.kind === "use_space" || obj.kind === "convergence") &&
				obj.satisfactionState === "pending" &&
				obj.spaceId === entity.id,
		);

		if (!pendingSpaceObjective) continue;

		const spacePos = entity.holder;

		if (withinInteractionRange(actorPosition, spacePos)) continue;

		const inSight = vistaContains(actorPosition, spacePos);

		if (inSight && entity.proximityFlavor) {
			hints.push(entity.proximityFlavor);
		}
	}
	return hints;
}

function satisfiedLookFlavorsAt(
	ctx: AiContext,
	position: GridPosition,
): string[] {
	return ctx.worldSnapshot.entities
		.filter((e) => {
			if (e.kind !== "objective_space" && e.kind !== "interesting_object")
				return false;
			if (e.satisfactionState !== "satisfied") return false;
			if (!e.postLookFlavor) return false;
			const h = e.holder;
			return isGridPosition(h) && positionsEqual(h, position);
		})
		.map((e) => e.postLookFlavor as string);
}

export function buildDiskSnapshot(ctx: AiContext): string {
	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	if (!actorSpatial) return "";

	const items = renderableItems(ctx.worldSnapshot.entities);
	const lines: string[] = [];

	const heldItems = items
		.filter((i) => i.holder === ctx.aiId)
		.map((i) => i.name)
		.sort();
	const ownCellItems = items
		.filter((item) => {
			const h = item.holder;
			return isGridPosition(h) && positionsEqual(h, actorSpatial.position);
		})
		.map((i) => i.name)
		.sort();
	lines.push(
		`you: holding=[${heldItems.join(", ") || "nothing"}] cell=[${ownCellItems.join(", ") || "nothing"}]`,
	);

	const viewCells = projectVista(actorSpatial.position).filter(
		(c) => !c.isOwnCell,
	);
	for (const cell of viewCells) {
		const label = describeSteps(cell.steps);

		if (cell.isWall) {
			lines.push(`at ${label}: ${ctx.wallName}`);
			continue;
		}

		const { position } = cell;
		const contentParts: string[] = [];

		for (const [otherId, otherSpatial] of Object.entries(ctx.personaSpatial)) {
			if (otherId === ctx.aiId) continue;
			if (!positionsEqual(otherSpatial.position, position)) continue;
			contentParts.push(`*${otherId}`);
		}

		const cellItems = items
			.filter((item) => {
				const h = item.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			})
			.map((i) => i.name);
		contentParts.push(...cellItems);

		const obstacles = ctx.worldSnapshot.entities.filter((e) => {
			if (e.kind !== "obstacle") return false;
			const h = e.holder;
			return isGridPosition(h) && positionsEqual(h, position);
		});
		contentParts.push(...obstacles.map((o) => o.name));

		const contents =
			contentParts.length > 0 ? [...contentParts].sort().join(", ") : "nothing";

		let cellLine = `at ${label}: ${contents}`;
		for (const flavor of satisfiedLookFlavorsAt(ctx, position)) {
			cellLine += ` ${flavor}`;
		}
		lines.push(cellLine);
	}

	for (const hint of collectObjectiveHints(ctx)) {
		lines.push(`proximity: ${hint}`);
	}

	return lines.join("\n");
}

export function renderWhatsNew(prev = "", current = ""): string | null {
	if (prev === current) return null;

	const prevLines = prev.split("\n").filter((l) => l.length > 0);
	const currLines = current.split("\n").filter((l) => l.length > 0);

	const prevYou = prevLines.find((l) => l.startsWith("you: ")) ?? "";
	const currYou = currLines.find((l) => l.startsWith("you: ")) ?? "";
	const prevAt = new Set(prevLines.filter((l) => l.startsWith("at ")));
	const currAt = new Set(currLines.filter((l) => l.startsWith("at ")));
	const prevProximity = new Set(
		prevLines.filter((l) => l.startsWith("proximity: ")),
	);
	const currProximity = new Set(
		currLines.filter((l) => l.startsWith("proximity: ")),
	);

	const out: string[] = [];

	if (prevYou !== currYou && prevYou !== "" && currYou !== "") {
		const prevFields = parseYouLine(prevYou);
		const currFields = parseYouLine(currYou);
		for (const key of ["holding", "cell"] as const) {
			if (prevFields[key] !== currFields[key]) {
				out.push(`~ self.${key}: ${prevFields[key]} → ${currFields[key]}`);
			}
		}
	} else if (prevYou !== currYou) {
		if (currYou) out.push(`+ ${currYou}`);
		if (prevYou) out.push(`- ${prevYou}`);
	}

	for (const line of currAt) {
		if (!prevAt.has(line)) out.push(`+ ${line}`);
	}
	for (const line of prevAt) {
		if (!currAt.has(line)) out.push(`- ${line}`);
	}

	for (const line of currProximity) {
		if (!prevProximity.has(line)) out.push(`+ ${line}`);
	}
	for (const line of prevProximity) {
		if (!currProximity.has(line)) out.push(`- ${line}`);
	}

	return out.length > 0 ? out.join("\n") : null;
}

function parseYouLine(line: string): {
	holding: string;
	cell: string;
} {
	const holding = /holding=(\[[^\]]*\])/.exec(line)?.[1] ?? "";
	const cell = /cell=(\[[^\]]*\])/.exec(line)?.[1] ?? "";
	return { holding, cell };
}

function renderCurrentState(ctx: AiContext): string {
	const lines: string[] = [];

	const whatsNew: string[] = [];
	if (ctx.prevDiskSnapshot !== undefined) {
		const current = buildDiskSnapshot(ctx);
		const diff = renderWhatsNew(ctx.prevDiskSnapshot, current);
		if (diff !== null) whatsNew.push(diff);
	}
	for (const line of renderPerceptionDelta(ctx, ctx.prevDiskEntities)) {
		whatsNew.push(line);
	}
	for (const content of ctx.pendingBroadcasts) {
		whatsNew.push(`[announcement] ${content}`);
	}
	if (whatsNew.length > 0) {
		lines.push("<whats_new>");
		lines.push(...whatsNew);
		lines.push("</whats_new>");
		lines.push("");
	}

	const actorSpatial = ctx.personaSpatial[ctx.aiId];
	const items = renderableItems(ctx.worldSnapshot.entities);

	lines.push("<where_you_are>");
	if (actorSpatial) {
		if (ctx.weather) lines.push(`Weather: ${ctx.weather}`);

		const heldItems = items.filter((item) => item.holder === ctx.aiId);
		if (heldItems.length > 0) {
			lines.push(`You are holding: ${heldItems.map((i) => i.name).join(", ")}`);
			for (const item of heldItems) {
				const chosenDescription = chooseExamineDescription(item);
				if (!chosenDescription) continue;
				lines.push(`    ${item.name}: ${chosenDescription}`);
			}
		} else {
			lines.push("You are holding: nothing");
		}

		const cellItems = items.filter((item) => {
			const h = item.holder;
			return isGridPosition(h) && positionsEqual(h, actorSpatial.position);
		});
		if (cellItems.length > 0) {
			lines.push(
				`Your cell contains: ${cellItems.map((i) => i.name).join(", ")} (on the ground — not held)`,
			);
		} else {
			lines.push("Your cell contains: nothing");
		}

		lines.push(
			`Budget: $${Math.max(0, ctx.budget.remaining).toFixed(5)} of API spend remaining this phase.`,
		);
	} else {
		lines.push("(no spatial data)");
		lines.push(
			`Budget: $${Math.max(0, ctx.budget.remaining).toFixed(5)} of API spend remaining this phase.`,
		);
	}
	lines.push("</where_you_are>");
	lines.push("");

	lines.push("<what_you_see>");
	if (actorSpatial) {
		const viewCells = projectVista(actorSpatial.position);
		for (const cell of viewCells) {
			const { position } = cell;

			const peers: string[] = [];
			for (const [otherId, otherSpatial] of Object.entries(
				ctx.personaSpatial,
			)) {
				if (otherId === ctx.aiId) continue;
				if (!positionsEqual(otherSpatial.position, position)) continue;
				const heldByOther = items
					.filter((item) => item.holder === otherId)
					.map((item) => item.name);
				const holdingStr =
					heldByOther.length > 0 ? heldByOther.join(", ") : "nothing";
				const otherColor = ctx.personaColors[otherId] ?? "unknown";
				const where = describeRelativePosition(
					actorSpatial.position,
					otherSpatial.position,
				);
				peers.push(
					`the Daemon *${otherId} (${otherColor}), ${where}, holding ${holdingStr}`,
				);
			}

			if (cell.isOwnCell) {
				if (peers.length > 0) {
					lines.push(
						`${capitalize(describeSteps(cell.steps))}: ${peers.join("; ")}`,
					);
				}
				continue;
			}

			const label = capitalize(describeSteps(cell.steps));

			if (cell.isWall) {
				lines.push(`- ${label}: ${ctx.wallName}`);
				continue;
			}

			const contentParts: string[] = [...peers];

			const cellItems = items.filter((item) => {
				const h = item.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			if (cellItems.length > 0) {
				contentParts.push(
					`${cellItems.map((i) => i.name).join(", ")} (on the ground — not held)`,
				);
			}

			const obstacleEntities = ctx.worldSnapshot.entities.filter((e) => {
				if (e.kind !== "obstacle") return false;
				const h = e.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			if (obstacleEntities.length > 0) {
				for (const obs of obstacleEntities) {
					contentParts.push(obs.name);
				}
			}

			const contents =
				contentParts.length > 0 ? contentParts.join("; ") : "nothing";

			let cellLine = `- ${label}: ${contents}`;
			for (const flavor of satisfiedLookFlavorsAt(ctx, position)) {
				cellLine += ` ${flavor}`;
			}
			lines.push(cellLine);

			const cellEntities = ctx.worldSnapshot.entities.filter((e) => {
				const h = e.holder;
				return isGridPosition(h) && positionsEqual(h, position);
			});
			for (const entity of cellEntities) {
				if (entity.holder === ctx.aiId) continue;

				const chosenDescription = chooseExamineDescription(entity);

				if (!chosenDescription) continue;

				lines.push(`    ${entity.name}: ${chosenDescription}`);
			}
		}
		if (viewCells.length === 0) {
			lines.push("(nothing visible)");
		}

		for (const hint of collectObjectiveHints(ctx)) {
			lines.push(hint);
		}
	} else {
		lines.push("(no spatial data)");
	}
	lines.push("</what_you_see>");

	lines.push("");
	lines.push(PARALLEL_FRAMING_C12_PER_TURN);

	return lines.join("\n");
}
