import type { GameSession } from "../game/game-session";
import type { GameState, Objective } from "../game/types";
import { isObjectiveSatisfied } from "../game/win-condition";

function computeSpentUsd(state: GameState): string {
	let totalSpent = 0;
	for (const budget of Object.values(state.budgets)) {
		totalSpent += budget.total - budget.remaining;
	}
	return totalSpent.toFixed(2);
}

function buildObjectiveItem(
	doc: Document,
	objective: Objective,
	state: GameState,
): HTMLLIElement {
	const li = doc.createElement("li");
	li.setAttribute("data-objective-id", objective.id);
	li.setAttribute("data-kind", objective.kind);

	const satisfied = isObjectiveSatisfied(objective, state.world);
	li.setAttribute("data-satisfied", String(satisfied));

	const stateText = satisfied ? "satisfied" : "pending";

	li.textContent = `[${objective.kind}] ${objective.description} — `;
	const stateSpan = doc.createElement("span");
	stateSpan.setAttribute("data-field", "state");
	stateSpan.textContent = stateText;
	li.appendChild(stateSpan);

	return li;
}

function buildComplicationItem(
	doc: Document,
	complication: GameState["activeComplications"][number],
): HTMLLIElement {
	const li = doc.createElement("li");
	li.setAttribute("data-complication-kind", complication.kind);

	const parts: string[] = [complication.kind];
	parts.push(`target *${complication.target}`);
	parts.push(`resolves round ${complication.resolveAtRound}`);

	if (complication.kind === "sysadmin_directive") {
		parts.push(`directive "${complication.directive}"`);
	} else if (complication.kind === "tool_disable") {
		parts.push(`tool ${complication.tool}`);
	}

	li.textContent = parts.join(" · ");
	return li;
}

type StripField = readonly [field: string, value: (state: GameState) => string];
type StripSegment = string | StripField;

function countSatisfied(state: GameState): number {
	return state.objectives.filter((obj) =>
		isObjectiveSatisfied(obj, state.world),
	).length;
}

const STRIP_LINES: readonly (readonly StripSegment[])[] = [
	[
		"round ",
		["round", (state) => String(state.round)],
		" · countdown ",
		["countdown", (state) => String(state.complicationSchedule.countdown)],
		" · pack ",
		["pack", (state) => state.activePackId],
		" · ",
		["setting", (state) => state.setting],
		" / ",
		["weather", (state) => state.weather],
		" / ",
		["time-of-day", (state) => state.timeOfDay],
	],
	[
		"cost $",
		["cost", computeSpentUsd],
		" · obj ",
		["obj-satisfied", (state) => String(countSatisfied(state))],
		"/",
		["obj-total", (state) => String(state.objectives.length)],
		" satisfied · ",
		[
			"active-complications",
			(state) => String(state.activeComplications.length),
		],
		" active complications",
	],
];

function buildStripSection(
	doc: Document,
	section: string,
	heading: string,
): HTMLDivElement {
	const sectionEl = doc.createElement("div");
	sectionEl.className = "dev-strip-section";
	sectionEl.setAttribute("data-section", section);

	const headingEl = doc.createElement("h4");
	headingEl.textContent = heading;
	sectionEl.appendChild(headingEl);

	const list = doc.createElement("ul");
	list.className = "dev-strip-list";
	list.setAttribute("data-list", section);
	sectionEl.appendChild(list);

	return sectionEl;
}

export function renderGameStrip(
	containerEl: HTMLElement,
	session: GameSession,
): void {
	const doc = containerEl.ownerDocument;

	containerEl.classList.add("dev-strip");
	containerEl.replaceChildren();

	STRIP_LINES.forEach((segments, index) => {
		const line = doc.createElement("div");
		line.className = "dev-strip-line";
		line.setAttribute("data-line", String(index + 1));
		for (const segment of segments) {
			if (typeof segment === "string") {
				line.appendChild(doc.createTextNode(segment));
				continue;
			}
			const span = doc.createElement("span");
			span.setAttribute("data-field", segment[0]);
			line.appendChild(span);
		}
		containerEl.appendChild(line);
	});

	const details = doc.createElement("details");
	details.className = "dev-strip-details";
	details.setAttribute("data-section", "strip-details");

	const summary = doc.createElement("summary");
	summary.textContent = "objectives + complications";
	details.appendChild(summary);

	details.appendChild(buildStripSection(doc, "objectives", "objectives"));
	details.appendChild(
		buildStripSection(doc, "complications", "active complications"),
	);

	containerEl.appendChild(details);

	updateGameStripSummary(containerEl, session);
}

export function updateGameStripSummary(
	containerEl: HTMLElement,
	session: GameSession,
): void {
	const state = session.getState();
	const doc = containerEl.ownerDocument;

	STRIP_LINES.forEach((segments, index) => {
		const line = containerEl.querySelector(`[data-line="${index + 1}"]`);
		if (!line) return;
		for (const segment of segments) {
			if (typeof segment === "string") continue;
			const [field, value] = segment;
			const span = line.querySelector(`[data-field="${field}"]`);
			if (span) span.textContent = value(state);
		}
	});

	const objectivesList = containerEl.querySelector('[data-list="objectives"]');
	if (objectivesList) {
		const newObjectiveItems = state.objectives.map((obj) =>
			buildObjectiveItem(doc, obj, state),
		);
		objectivesList.replaceChildren(...newObjectiveItems);
	}

	const complicationsList = containerEl.querySelector(
		'[data-list="complications"]',
	);
	if (complicationsList) {
		const newComplicationItems = state.activeComplications.map((comp) =>
			buildComplicationItem(doc, comp),
		);
		complicationsList.replaceChildren(...newComplicationItems);
	}
}
