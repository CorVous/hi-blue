import type { GameSession } from "../game/game-session.js";
import type {
	AiId,
	GameState,
	GridPosition,
	WorldEntity,
} from "../game/types.js";
import { vistaMaskForDaemon } from "./vista-mask.js";

let mapFocus: AiId | null = null;
let activeSession: GameSession | null = null;

const ROOM_ROWS = 5;
const ROOM_COLS = 5;

const DAEMON_GLYPH = "@ ";
const VISTA_TINT_ALPHA = 0.25;

function hexToRgba(hexColor: string, alphaFrom0To1: number): string {
	const h = hexColor.replace("#", "");
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
	return `rgba(${r}, ${g}, ${b}, ${alphaFrom0To1})`;
}

function applyVistaTint(containerEl: HTMLElement, state: GameState): void {
	const focus = mapFocus;
	const mask = focus ? vistaMaskForDaemon(state, focus) : null;
	const tintColor = focus ? state.personas[focus]?.color : null;

	for (const cell of containerEl.querySelectorAll<HTMLElement>(
		".dev-map-cell",
	)) {
		const dataCell = cell.getAttribute("data-cell");
		if (focus && mask && tintColor && dataCell && mask.has(dataCell)) {
			cell.style.backgroundColor = hexToRgba(tintColor, VISTA_TINT_ALPHA);
			cell.setAttribute("data-vista-focus", focus);
		} else {
			cell.style.backgroundColor = "";
			cell.removeAttribute("data-vista-focus");
		}
	}
}

export function setMapFocus(focusedAiIdOrNull: AiId | null): void {
	mapFocus = focusedAiIdOrNull;
	const containerEl = document.querySelector<HTMLElement>("#dev-world-map");
	if (containerEl && activeSession) {
		applyVistaTint(containerEl, activeSession.getState());
	}

	for (const btn of document.querySelectorAll<HTMLElement>(
		'[data-field="focus-vista"]',
	)) {
		const panel = btn.closest<HTMLElement>(".ai-panel");
		const panelAi = panel?.getAttribute("data-ai") ?? null;
		btn.setAttribute("data-focus-active", String(panelAi === mapFocus));
	}
}

export function getMapFocus(): AiId | null {
	return mapFocus;
}

function isGridPosition(holder: AiId | GridPosition): holder is GridPosition {
	return typeof holder === "object" && holder !== null;
}

function findHeldEntity(
	aiId: AiId,
	entities: WorldEntity[],
): WorldEntity | undefined {
	return entities.find((e) => e.holder === aiId);
}

interface CellInfo {
	glyph: string;
	tooltip: string;
	kind: string;
	entityId?: string;
	aiId?: AiId;
	satisfaction?: string;
}

function computeCellInfo(roomPos: GridPosition, state: GameState): CellInfo {
	for (const [aiId, spatial] of Object.entries(state.personaSpatial)) {
		if (
			spatial &&
			spatial.position.row === roomPos.row &&
			spatial.position.col === roomPos.col
		) {
			const persona = state.personas[aiId];
			if (!persona) continue;

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

	const entitiesAtPos = state.world.entities.filter((e) => {
		if (!isGridPosition(e.holder)) return false;
		return e.holder.row === roomPos.row && e.holder.col === roomPos.col;
	});

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

	return {
		glyph: ". ",
		tooltip: `floor (${roomPos.row},${roomPos.col})`,
		kind: "floor",
	};
}

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
	grid.setAttribute("data-rows", String(ROOM_ROWS));
	grid.setAttribute("data-cols", String(ROOM_COLS));

	for (let row = 0; row < ROOM_ROWS; row++) {
		for (let col = 0; col < ROOM_COLS; col++) {
			const roomPos: GridPosition = { row, col };
			const cellInfo = computeCellInfo(roomPos, state);

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

	activeSession = session;
	applyVistaTint(containerEl, state);
}

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

		const roomPos: GridPosition = { row, col };
		const cellInfo = computeCellInfo(roomPos, state);

		const glyphSpan = cell.querySelector(".dev-map-glyph");
		if (glyphSpan) glyphSpan.textContent = cellInfo.glyph;

		const tooltipSpan = cell.querySelector(".dev-map-tooltip");
		if (tooltipSpan) tooltipSpan.textContent = cellInfo.tooltip;

		cell.setAttribute("data-kind", cellInfo.kind);

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

	activeSession = session;
	applyVistaTint(containerEl, state);
}
