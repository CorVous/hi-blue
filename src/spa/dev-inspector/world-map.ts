/**
 * world-map.ts
 *
 * Renders a 5×5 ASCII grid inspector with 7×7 visual layout (wall ring + 25 inner cells).
 * Displays daemon positions, held items, obstacles, objectives, and interesting objects.
 *
 * Two-function API:
 * - renderWorldMap: builds the DOM skeleton once
 * - updateWorldMap: mutates existing cell contents in-place
 */

import type { GameSession } from "../game/game-session.js";
import type {
	AiId,
	GameState,
	GridPosition,
	WorldEntity,
} from "../game/types.js";

const VISUAL_ROWS = 7;
const VISUAL_COLS = 7;

type CardinalDirection = "north" | "south" | "east" | "west";

function isGridPosition(holder: AiId | GridPosition): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

function facingArrow(facing: CardinalDirection): string {
	switch (facing) {
		case "north":
			return "^";
		case "south":
			return "v";
		case "east":
			return ">";
		case "west":
			return "<";
	}
}

function facingLetter(facing: CardinalDirection): string {
	switch (facing) {
		case "north":
			return "N";
		case "south":
			return "S";
		case "east":
			return "E";
		case "west":
			return "W";
	}
}

/**
 * Get the entity held by the given AI, or undefined.
 */
function findHeldEntity(
	aiId: AiId,
	entities: WorldEntity[],
): WorldEntity | undefined {
	return entities.find((e) => e.holder === aiId);
}

/**
 * Determine the glyph and tooltip for a single cell.
 * Precedence (highest → lowest):
 * 1. Daemon (@<arrow>)
 * 2. Obstacle (##)
 * 3. Objective object on paired space (**)
 * 4. Objective object alone (* )
 * 5. Objective space alone (+ )
 * 6. Interesting object (o )
 * 7. Floor (. )
 *
 * Returns { glyph, tooltip, kind, entityId?, aiId?, satisfaction? }.
 */
interface CellInfo {
	glyph: string;
	tooltip: string;
	kind: string;
	entityId?: string;
	aiId?: AiId;
	satisfaction?: string;
}

function computeCellInfo(visualPos: GridPosition, state: GameState): CellInfo {
	// Wall cells (outer ring)
	if (
		visualPos.row === 0 ||
		visualPos.row === VISUAL_ROWS - 1 ||
		visualPos.col === 0 ||
		visualPos.col === VISUAL_COLS - 1
	) {
		return {
			glyph: "##",
			tooltip: "wall (out of bounds)",
			kind: "wall",
		};
	}

	const innerPos: GridPosition = {
		row: visualPos.row - 1,
		col: visualPos.col - 1,
	};

	// Check for daemon at this position
	for (const [aiId, spatial] of Object.entries(state.personaSpatial)) {
		if (
			spatial &&
			spatial.position.row === innerPos.row &&
			spatial.position.col === innerPos.col
		) {
			const persona = state.personas[aiId];
			if (!persona) continue; // Skip if persona is missing

			const heldEntity = findHeldEntity(aiId, state.world.entities);
			const arrow = facingArrow(spatial.facing);
			const facing = facingLetter(spatial.facing);
			const holdText = heldEntity
				? `${heldEntity.name} (${heldEntity.id})`
				: "nothing";

			return {
				glyph: `@${arrow}`,
				tooltip: `*${persona.name} — facing ${facing} — holds: ${holdText}`,
				kind: "daemon",
				aiId,
			};
		}
	}

	// Collect all entities at this position (not held by an AI)
	const entitiesAtPos = state.world.entities.filter((e) => {
		if (!isGridPosition(e.holder)) return false;
		return e.holder.row === innerPos.row && e.holder.col === innerPos.col;
	});

	// Check for obstacle
	const obstacle = entitiesAtPos.find((e) => e.kind === "obstacle");
	if (obstacle) {
		const satisfaction = obstacle.satisfactionState ?? "pending";
		return {
			glyph: "##",
			tooltip: `${obstacle.name} · ${obstacle.id} · obstacle`,
			kind: "obstacle",
			entityId: obstacle.id,
			satisfaction,
		};
	}

	// Check for objective object on its paired space
	const objObj = entitiesAtPos.find((e) => e.kind === "objective_object");
	const objSpace = entitiesAtPos.find((e) => e.kind === "objective_space");

	if (objObj && objSpace && objObj.pairsWithSpaceId === objSpace.id) {
		const objSatisfaction = objObj.satisfactionState ?? "pending";
		const spaceSatisfaction = objSpace.satisfactionState ?? "pending";
		return {
			glyph: "**",
			tooltip: `${objObj.name} on ${objSpace.name} · ${objObj.id}+${objSpace.id} · ${objSatisfaction}/${spaceSatisfaction}`,
			kind: "objective-object-on-space",
			entityId: objObj.id,
			satisfaction: objSatisfaction,
		};
	}

	// Objective object alone
	if (objObj) {
		const satisfaction = objObj.satisfactionState ?? "pending";
		const holderPersona = isGridPosition(objObj.holder)
			? null
			: state.personas[objObj.holder];
		const holder = !holderPersona ? "(none)" : `*${holderPersona.name}`;
		return {
			glyph: "* ",
			tooltip: `${objObj.name} · ${objObj.id} · ${satisfaction} · ${holder}`,
			kind: "objective-object",
			entityId: objObj.id,
			satisfaction,
		};
	}

	// Objective space alone
	if (objSpace) {
		const satisfaction = objSpace.satisfactionState ?? "pending";
		return {
			glyph: "+ ",
			tooltip: `${objSpace.name} · ${objSpace.id} · ${satisfaction} · (none)`,
			kind: "objective-space",
			entityId: objSpace.id,
			satisfaction,
		};
	}

	// Interesting object
	const interesting = entitiesAtPos.find(
		(e) => e.kind === "interesting_object",
	);
	if (interesting) {
		const satisfaction = interesting.satisfactionState ?? "pending";
		const holderPersona = isGridPosition(interesting.holder)
			? null
			: state.personas[interesting.holder];
		const holder = !holderPersona ? "(none)" : `*${holderPersona.name}`;
		return {
			glyph: "o ",
			tooltip: `${interesting.name} · ${interesting.id} · ${satisfaction} · ${holder}`,
			kind: "interesting-object",
			entityId: interesting.id,
			satisfaction,
		};
	}

	// Floor
	return {
		glyph: ". ",
		tooltip: `floor (${innerPos.row},${innerPos.col})`,
		kind: "floor",
	};
}

/**
 * Render the full world map DOM structure.
 * Builds a 7×7 grid of cells with nested glyph and tooltip spans.
 */
export function renderWorldMap(
	containerEl: HTMLElement,
	session: GameSession,
): void {
	const state = session.getState();
	const doc = containerEl.ownerDocument;

	containerEl.classList.add("dev-map");
	containerEl.replaceChildren();

	const grid = doc.createElement("div");
	grid.className = "dev-map-grid";
	grid.setAttribute("data-rows", String(VISUAL_ROWS));
	grid.setAttribute("data-cols", String(VISUAL_COLS));

	for (let row = 0; row < VISUAL_ROWS; row++) {
		for (let col = 0; col < VISUAL_COLS; col++) {
			const visualPos: GridPosition = { row, col };
			const cellInfo = computeCellInfo(visualPos, state);

			const cell = doc.createElement("span");
			cell.className = "dev-map-cell";
			cell.setAttribute("data-cell", `${row},${col}`);
			cell.setAttribute("data-kind", cellInfo.kind);

			if (cellInfo.entityId) {
				cell.setAttribute("data-entity-id", cellInfo.entityId);
			}
			if (cellInfo.aiId) {
				cell.setAttribute("data-ai", cellInfo.aiId);
				const persona = state.personas[cellInfo.aiId];
				if (persona?.color) {
					cell.style.color = persona.color;
				}
			}
			if (cellInfo.satisfaction) {
				cell.setAttribute("data-satisfaction", cellInfo.satisfaction);
			}

			const glyphSpan = doc.createElement("span");
			glyphSpan.className = "dev-map-glyph";
			glyphSpan.textContent = cellInfo.glyph;
			cell.appendChild(glyphSpan);

			const tooltipSpan = doc.createElement("span");
			tooltipSpan.className = "dev-map-tooltip";
			tooltipSpan.textContent = cellInfo.tooltip;
			cell.appendChild(tooltipSpan);

			grid.appendChild(cell);
		}
	}

	containerEl.appendChild(grid);
}

/**
 * Update the world map in place without recreating the grid.
 * Mutates cell contents and attributes only (no node creation/removal).
 */
export function updateWorldMap(
	containerEl: HTMLElement,
	session: GameSession,
): void {
	const state = session.getState();

	const grid = containerEl.querySelector(".dev-map-grid");
	if (!grid) return;

	const cells = grid.querySelectorAll<HTMLElement>(".dev-map-cell");
	cells.forEach((cell) => {
		const cellStr = cell.getAttribute("data-cell");
		if (!cellStr) return;

		const [rowStr, colStr] = cellStr.split(",");
		const row = Number(rowStr);
		const col = Number(colStr);

		if (Number.isNaN(row) || Number.isNaN(col)) return;

		const visualPos: GridPosition = { row, col };
		const cellInfo = computeCellInfo(visualPos, state);

		// Update glyph and tooltip
		const glyphSpan = cell.querySelector(".dev-map-glyph");
		if (glyphSpan) glyphSpan.textContent = cellInfo.glyph;

		const tooltipSpan = cell.querySelector(".dev-map-tooltip");
		if (tooltipSpan) tooltipSpan.textContent = cellInfo.tooltip;

		// Update data attributes
		cell.setAttribute("data-kind", cellInfo.kind);

		// Remove entity-id, ai, satisfaction if not present; re-add if present
		if (cellInfo.entityId) {
			cell.setAttribute("data-entity-id", cellInfo.entityId);
		} else {
			cell.removeAttribute("data-entity-id");
		}

		if (cellInfo.aiId) {
			cell.setAttribute("data-ai", cellInfo.aiId);
			const persona = state.personas[cellInfo.aiId];
			if (persona?.color) {
				cell.style.color = persona.color;
			}
		} else {
			cell.removeAttribute("data-ai");
			cell.style.color = "";
		}

		if (cellInfo.satisfaction) {
			cell.setAttribute("data-satisfaction", cellInfo.satisfaction);
		} else {
			cell.removeAttribute("data-satisfaction");
		}
	});
}
