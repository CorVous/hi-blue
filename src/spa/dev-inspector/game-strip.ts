/**
 * game-strip.ts
 *
 * Renders a sticky dev inspector strip showing game state summaries:
 *  - Line 1: round, countdown, pack id, setting/weather/time-of-day
 *  - Line 2: cost, objectives satisfied/total, active complications count
 *  - Details: expandable list of objectives and active complications
 */

import type { GameSession } from "../game/game-session";
import type { GameState, Objective } from "../game/types";
import {
	isCarryObjectiveSatisfied,
	isUseItemObjectiveSatisfied,
	isUseSpaceObjectiveSatisfied,
} from "../game/win-condition";

/**
 * Compute the total spent USD across all AI budgets.
 * Cost = sum of (budget.total - budget.remaining) for each AI.
 */
function computeSpentUsd(state: GameState): string {
	let totalSpent = 0;
	for (const budget of Object.values(state.budgets)) {
		totalSpent += budget.total - budget.remaining;
	}
	return totalSpent.toFixed(2);
}

/**
 * Determine if an objective is satisfied based on its kind.
 * Uses helpers from win-condition.ts for carry objectives.
 */
function isSatisfied(objective: Objective, state: GameState): boolean {
	switch (objective.kind) {
		case "carry":
			return isCarryObjectiveSatisfied(objective, state.world);
		case "use_item":
			return isUseItemObjectiveSatisfied(objective);
		case "use_space":
			return isUseSpaceObjectiveSatisfied(objective);
		case "convergence":
			return objective.satisfactionState === "satisfied";
		default: {
			const _exhaustive: never = objective;
			return _exhaustive;
		}
	}
}

/**
 * Build a single objective list item DOM element.
 */
function buildObjectiveItem(
	doc: Document,
	objective: Objective,
	state: GameState,
): HTMLLIElement {
	const li = doc.createElement("li");
	li.setAttribute("data-objective-id", objective.id);
	li.setAttribute("data-kind", objective.kind);

	const satisfied = isSatisfied(objective, state);
	li.setAttribute("data-satisfied", String(satisfied));

	const stateText = satisfied ? "satisfied" : "pending";

	li.textContent = `[${objective.kind}] ${objective.description} — `;
	const stateSpan = doc.createElement("span");
	stateSpan.setAttribute("data-field", "state");
	stateSpan.textContent = stateText;
	li.appendChild(stateSpan);

	return li;
}

/**
 * Build a single complication list item DOM element.
 */
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

/**
 * Render the full game strip DOM structure.
 * Clears the container and builds line 1, line 2, and details sections.
 */
export function renderGameStrip(
	containerEl: HTMLElement,
	session: GameSession,
): void {
	const state = session.getState();
	const doc = containerEl.ownerDocument;

	// Add dev-strip class and clear children
	containerEl.classList.add("dev-strip");
	containerEl.replaceChildren();

	// Line 1
	const line1 = doc.createElement("div");
	line1.className = "dev-strip-line";
	line1.setAttribute("data-line", "1");

	const line1Text = doc.createTextNode("round ");
	line1.appendChild(line1Text);

	const roundSpan = doc.createElement("span");
	roundSpan.setAttribute("data-field", "round");
	roundSpan.textContent = String(state.round);
	line1.appendChild(roundSpan);

	line1.appendChild(doc.createTextNode(" · countdown "));

	const countdownSpan = doc.createElement("span");
	countdownSpan.setAttribute("data-field", "countdown");
	countdownSpan.textContent = String(state.complicationSchedule.countdown);
	line1.appendChild(countdownSpan);

	line1.appendChild(doc.createTextNode(" · pack "));

	const packSpan = doc.createElement("span");
	packSpan.setAttribute("data-field", "pack");
	packSpan.textContent = state.activePackId;
	line1.appendChild(packSpan);

	line1.appendChild(doc.createTextNode(" · "));

	const settingSpan = doc.createElement("span");
	settingSpan.setAttribute("data-field", "setting");
	settingSpan.textContent = state.setting;
	line1.appendChild(settingSpan);

	line1.appendChild(doc.createTextNode(" / "));

	const weatherSpan = doc.createElement("span");
	weatherSpan.setAttribute("data-field", "weather");
	weatherSpan.textContent = state.weather;
	line1.appendChild(weatherSpan);

	line1.appendChild(doc.createTextNode(" / "));

	const timeSpan = doc.createElement("span");
	timeSpan.setAttribute("data-field", "time-of-day");
	timeSpan.textContent = state.timeOfDay;
	line1.appendChild(timeSpan);

	containerEl.appendChild(line1);

	// Line 2
	const line2 = doc.createElement("div");
	line2.className = "dev-strip-line";
	line2.setAttribute("data-line", "2");

	line2.appendChild(doc.createTextNode("cost $"));

	const costSpan = doc.createElement("span");
	costSpan.setAttribute("data-field", "cost");
	costSpan.textContent = computeSpentUsd(state);
	line2.appendChild(costSpan);

	line2.appendChild(doc.createTextNode(" · obj "));

	const satisfiedCount = state.objectives.filter((obj) =>
		isSatisfied(obj, state),
	).length;

	const objSatisfiedSpan = doc.createElement("span");
	objSatisfiedSpan.setAttribute("data-field", "obj-satisfied");
	objSatisfiedSpan.textContent = String(satisfiedCount);
	line2.appendChild(objSatisfiedSpan);

	line2.appendChild(doc.createTextNode("/"));

	const objTotalSpan = doc.createElement("span");
	objTotalSpan.setAttribute("data-field", "obj-total");
	objTotalSpan.textContent = String(state.objectives.length);
	line2.appendChild(objTotalSpan);

	line2.appendChild(doc.createTextNode(" satisfied · "));

	const complicationsSpan = doc.createElement("span");
	complicationsSpan.setAttribute("data-field", "active-complications");
	complicationsSpan.textContent = String(state.activeComplications.length);
	line2.appendChild(complicationsSpan);

	line2.appendChild(doc.createTextNode(" active complications"));

	containerEl.appendChild(line2);

	// Details section
	const details = doc.createElement("details");
	details.className = "dev-strip-details";
	details.setAttribute("data-section", "strip-details");

	const summary = doc.createElement("summary");
	summary.textContent = "objectives + complications";
	details.appendChild(summary);

	// Objectives section
	const objectivesSection = doc.createElement("div");
	objectivesSection.className = "dev-strip-section";
	objectivesSection.setAttribute("data-section", "objectives");

	const objectivesHeading = doc.createElement("h4");
	objectivesHeading.textContent = "objectives";
	objectivesSection.appendChild(objectivesHeading);

	const objectivesList = doc.createElement("ul");
	objectivesList.className = "dev-strip-list";
	objectivesList.setAttribute("data-list", "objectives");

	for (const objective of state.objectives) {
		const li = buildObjectiveItem(doc, objective, state);
		objectivesList.appendChild(li);
	}

	objectivesSection.appendChild(objectivesList);
	details.appendChild(objectivesSection);

	// Complications section
	const complicationsSection = doc.createElement("div");
	complicationsSection.className = "dev-strip-section";
	complicationsSection.setAttribute("data-section", "complications");

	const complicationsHeading = doc.createElement("h4");
	complicationsHeading.textContent = "active complications";
	complicationsSection.appendChild(complicationsHeading);

	const complicationsList = doc.createElement("ul");
	complicationsList.className = "dev-strip-list";
	complicationsList.setAttribute("data-list", "complications");

	for (const complication of state.activeComplications) {
		const li = buildComplicationItem(doc, complication);
		complicationsList.appendChild(li);
	}

	complicationsSection.appendChild(complicationsList);
	details.appendChild(complicationsSection);

	containerEl.appendChild(details);
}

/**
 * Update the game strip in place without re-creating the details element.
 * - Updates all [data-field="…"] spans on lines 1 and 2
 * - Refreshes the objectives and complications lists
 * - Preserves the details element (including open state)
 */
export function updateGameStripSummary(
	containerEl: HTMLElement,
	session: GameSession,
): void {
	const state = session.getState();
	const doc = containerEl.ownerDocument;

	// Update Line 1 fields
	const line1 = containerEl.querySelector('[data-line="1"]');
	if (line1) {
		const roundSpan = line1.querySelector('[data-field="round"]');
		if (roundSpan) roundSpan.textContent = String(state.round);

		const countdownSpan = line1.querySelector('[data-field="countdown"]');
		if (countdownSpan)
			countdownSpan.textContent = String(state.complicationSchedule.countdown);

		const packSpan = line1.querySelector('[data-field="pack"]');
		if (packSpan) packSpan.textContent = state.activePackId;

		const settingSpan = line1.querySelector('[data-field="setting"]');
		if (settingSpan) settingSpan.textContent = state.setting;

		const weatherSpan = line1.querySelector('[data-field="weather"]');
		if (weatherSpan) weatherSpan.textContent = state.weather;

		const timeSpan = line1.querySelector('[data-field="time-of-day"]');
		if (timeSpan) timeSpan.textContent = state.timeOfDay;
	}

	// Update Line 2 fields
	const line2 = containerEl.querySelector('[data-line="2"]');
	if (line2) {
		const costSpan = line2.querySelector('[data-field="cost"]');
		if (costSpan) costSpan.textContent = computeSpentUsd(state);

		const satisfiedCount = state.objectives.filter((obj) =>
			isSatisfied(obj, state),
		).length;

		const objSatisfiedSpan = line2.querySelector(
			'[data-field="obj-satisfied"]',
		);
		if (objSatisfiedSpan) objSatisfiedSpan.textContent = String(satisfiedCount);

		const objTotalSpan = line2.querySelector('[data-field="obj-total"]');
		if (objTotalSpan)
			objTotalSpan.textContent = String(state.objectives.length);

		const complicationsSpan = line2.querySelector(
			'[data-field="active-complications"]',
		);
		if (complicationsSpan)
			complicationsSpan.textContent = String(state.activeComplications.length);
	}

	// Refresh objectives list (replace children but keep the ul)
	const objectivesList = containerEl.querySelector('[data-list="objectives"]');
	if (objectivesList) {
		const newObjectiveItems = state.objectives.map((obj) =>
			buildObjectiveItem(doc, obj, state),
		);
		objectivesList.replaceChildren(...newObjectiveItems);
	}

	// Refresh complications list (replace children but keep the ul)
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
