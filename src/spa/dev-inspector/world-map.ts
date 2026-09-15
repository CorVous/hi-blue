/**
 * world-map.ts
 *
 * Renders a 5×5 ASCII grid inspector with 7×7 visual layout (wall ring + 25 inner cells).
 * Displays daemon positions, held items, obstacles, objectives, and interesting objects.
 *
 * Two-function API:
 * - renderWorldMap: builds the DOM skeleton once
 * - updateWorldMap: mutates existing cell contents in-place
 *
 * Vista-focus feature:
 * - setMapFocus(aiId): tint the cells of a daemon's Vista with persona color
 * - getMapFocus(): check if focus is active
 *
 * Daemon markers show identity and position only: their identifying color,
 * their `data-ai` attribute, and the `*name` tooltip label. They carry no
 * direction arrow, direction letter, or last-movement marker (ADR 0015).
 */

import type { GameSession } from "../game/game-session.js";
import type {
	AiId,
	GameState,
	GridPosition,
	WorldEntity,
} from "../game/types.js";
import { vistaMaskForDaemon } from "./vista-mask.js";

// Module-level state for Vista focus
let mapFocus: AiId | null = null;
let activeSession: GameSession | null = null;

const VISUAL_ROWS = 7;
const VISUAL_COLS = 7;

/**
 * The identity marker drawn on a Daemon's cell. Position-only: colour,
 * `data-ai`, and the tooltip carry identity, so the glyph itself is the same
 * for every Daemon and direction-independent.
 */
const DAEMON_GLYPH = "@ ";

/**
 * Convert hex color to rgba with given alpha.
 * @param hex Color in hex format (e.g., "#e07a5f")
 * @param alpha Alpha value in range [0, 1]
 * @returns CSS rgba string
 */
function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace("#", "");
	const expanded =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h;
	const r = parseInt(expanded.substring(0, 2), 16);
	const g = parseInt(expanded.substring(2, 4), 16);
	const b = parseInt(expanded.substring(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply Vista tint to world map cells based on active focus.
 * Tints the focused daemon's in-bounds Vista cells with persona color at
 * 0.25 alpha. The mask is position-only, so the tint follows the daemon as
 * it moves.
 * @param containerEl The map container element
 * @param state The current game state
 */
function applyVistaTint(containerEl: HTMLElement, state: GameState): void {
	const focus = mapFocus;
	const mask = focus ? vistaMaskForDaemon(state, focus) : null;
	const tintColor = focus ? state.personas[focus]?.color : null;

	for (const cell of containerEl.querySelectorAll<HTMLElement>(
		".dev-map-cell",
	)) {
		const dataCell = cell.getAttribute("data-cell");
		if (focus && mask && tintColor && dataCell && mask.has(dataCell)) {
			cell.style.backgroundColor = hexToRgba(tintColor, 0.25);
			cell.setAttribute("data-vista-focus", focus);
		} else {
			cell.style.backgroundColor = "";
			cell.removeAttribute("data-vista-focus");
		}
	}
}

/**
 * Set the active focus daemon and update tint on the map.
 * @param aiId The daemon to focus, or null to clear focus
 */
export function setMapFocus(aiId: AiId | null): void {
	mapFocus = aiId;
	const containerEl = document.querySelector<HTMLElement>("#dev-world-map");
	if (containerEl && activeSession) {
		applyVistaTint(containerEl, activeSession.getState());
	}

	// Sweep all focus-Vista buttons to update data-focus-active
	for (const btn of document.querySelectorAll<HTMLElement>(
		'[data-field="focus-vista"]',
	)) {
		const panel = btn.closest<HTMLElement>(".ai-panel");
		const panelAi = panel?.getAttribute("data-ai") ?? null;
		btn.setAttribute("data-focus-active", String(panelAi === mapFocus));
	}
}

/**
 * Get the currently focused daemon, or null if no focus is active.
 * @returns The focused AiId, or null
 */
export function getMapFocus(): AiId | null {
	return mapFocus;
}

function isGridPosition(holder: AiId | GridPosition): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
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
 * 1. Daemon (@ )
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
			const holdText = heldEntity
				? `${heldEntity.name} (${heldEntity.id})`
				: "nothing";

			return {
				glyph: DAEMON_GLYPH,
				tooltip: `*${persona.name} — holds: ${holdText}`,
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

	// Update active session and apply the Vista tint
	activeSession = session;
	applyVistaTint(containerEl, state);
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

	// Update active session and re-apply the Vista tint so the highlight
	// follows the focused Daemon's current position
	activeSession = session;
	applyVistaTint(containerEl, state);
}
