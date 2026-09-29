import { beforeEach, describe, expect, it } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import type { GameState, WorldEntity } from "../../game/types";
import { renderWorldMap, updateWorldMap } from "../world-map";

describe("world-map", () => {
	let session: GameSession;
	let state: GameState;
	let containerEl: HTMLElement;

	beforeEach(() => {
		document.body.innerHTML = '<div id="dev-world-map"></div>';
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		session = new GameSession(contentPack, STATIC_PERSONAS);
		state = session.getState();
		containerEl = document.getElementById("dev-world-map") as HTMLElement;
	});

	it("renders a room-only 5×5 grid: 25 distinct room cells (r,c) in [0..4]", () => {
		renderWorldMap(containerEl, session);

		const cells = containerEl.querySelectorAll(".dev-map-cell");
		expect(cells.length).toBe(25);
		const seen = new Set<string>();
		for (const cell of cells) {
			const cellStr = cell.getAttribute("data-cell");
			expect(cellStr).toBeTruthy();
			if (!cellStr) continue;
			const [row, col] = cellStr.split(",").map(Number);
			expect(row).toBeGreaterThanOrEqual(0);
			expect(row).toBeLessThanOrEqual(4);
			expect(col).toBeGreaterThanOrEqual(0);
			expect(col).toBeLessThanOrEqual(4);
			seen.add(cellStr);
		}
		expect(seen.size).toBe(25);

		const grid = containerEl.querySelector(".dev-map-grid");
		expect(grid?.getAttribute("data-rows")).toBe("5");
		expect(grid?.getAttribute("data-cols")).toBe("5");
	});

	it("renders no wall cells and no out-of-bounds tooltip", () => {
		renderWorldMap(containerEl, session);

		expect(
			containerEl.querySelectorAll('.dev-map-cell[data-kind="wall"]').length,
		).toBe(0);

		const tooltips = [...containerEl.querySelectorAll(".dev-map-tooltip")];
		expect(tooltips.length).toBe(25);
		for (const tooltip of tooltips) {
			expect(tooltip.textContent).not.toContain("wall (out of bounds)");
		}
	});

	it("daemon cell renders the identity marker with persona color and data-ai", () => {
		renderWorldMap(containerEl, session);

		const daemonCell = containerEl.querySelector(
			'.dev-map-cell[data-ai="red"]',
		);
		expect(daemonCell).toBeTruthy();

		const glyph = daemonCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("@ ");

		if (daemonCell instanceof HTMLElement) {
			expect(daemonCell.style.color).toBeTruthy();
		}
	});

	it("daemon glyph is direction-independent: same '@ ' however the Daemon moved", () => {
		renderWorldMap(containerEl, session);

		const snapshot = Object.values(state.personaSpatial).map((spatial) => ({
			spatial,
			position: spatial.position,
		}));

		const glyphs = new Set<string>();
		const routes: Array<[string, { row: number; col: number }]> = [
			["red", { row: 4, col: 0 }],
			["green", { row: 0, col: 4 }],
			["cyan", { row: 2, col: 2 }],
		];
		for (const [aiId, position] of routes) {
			const spatial = state.personaSpatial[aiId];
			if (!spatial) throw new Error(`Spatial state missing for ${aiId}`);
			spatial.position = position;
		}

		updateWorldMap(containerEl, session);

		for (const [aiId, position] of routes) {
			const cell = containerEl.querySelector<HTMLElement>(
				`.dev-map-cell[data-ai="${aiId}"]`,
			);
			expect(cell).toBeTruthy();
			expect(cell?.getAttribute("data-cell")).toBe(
				`${position.row},${position.col}`,
			);

			const glyph = cell?.querySelector(".dev-map-glyph")?.textContent;
			expect(glyph).toBe("@ ");
			glyphs.add(glyph ?? "");
		}

		expect([...glyphs]).toEqual(["@ "]);

		for (const entry of snapshot) {
			entry.spatial.position = entry.position;
		}
	});

	it("daemon markers show identity and position only: no direction arrow, letter, or last-movement marker", () => {
		renderWorldMap(containerEl, session);

		const daemonCells = containerEl.querySelectorAll<HTMLElement>(
			".dev-map-cell[data-ai]",
		);
		expect(daemonCells.length).toBe(3);
		for (const cell of daemonCells) {
			expect(cell.querySelector(".dev-map-glyph")?.textContent).toBe("@ ");
			expect(cell.textContent).toMatch(/^@ \*[A-Za-z]+ — holds: .+$/);

			expect(cell.textContent).not.toMatch(/[<^>v↑↓←→↖↗↘↙]/);
			expect(cell.getAttributeNames()).not.toContain("data-direction");
			expect(cell.getAttributeNames()).not.toContain("data-facing");
			expect(cell.querySelector('[data-field="direction"]')).toBeNull();
			for (const attr of cell.getAttributeNames()) {
				expect(attr).not.toMatch(/direction|facing|last-move/);
			}
		}
	});

	it("daemon tooltip format: *<name> — holds: nothing when no held entity", () => {
		renderWorldMap(containerEl, session);

		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const tooltip = redCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toMatch(/^\*Ember — holds: nothing$/);

		const daemonCells = containerEl.querySelectorAll(".dev-map-cell[data-ai]");
		for (const cell of daemonCells) {
			const tooltip = cell.querySelector(".dev-map-tooltip");
			expect(tooltip?.textContent).toContain("holds: nothing");
		}
	});

	it("obstacle cell renders ## with data-kind and data-entity-id", () => {
		const obstacle: WorldEntity = {
			id: "test_obstacle",
			kind: "obstacle",
			name: "Test Block",
			examineDescription: "A test block",
			holder: { row: 1, col: 1 },
		};
		state.world.entities.push(obstacle);

		renderWorldMap(containerEl, session);

		const obstacleCell = containerEl.querySelector(
			'.dev-map-cell[data-entity-id="test_obstacle"]',
		);
		expect(obstacleCell).toBeTruthy();
		expect(obstacleCell?.getAttribute("data-kind")).toBe("obstacle");

		const glyph = obstacleCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("##");
	});

	it("objective_object and objective_space apart render '* ' and '+ ' with their data-kind", () => {
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 2, col: 2 };
		}

		renderWorldMap(containerEl, session);

		const objCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-object"]',
		);
		expect(objCell).toBeTruthy();
		expect(objCell?.querySelector(".dev-map-glyph")?.textContent).toBe("* ");

		const spaceCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-space"]',
		);
		expect(spaceCell).toBeTruthy();
		expect(spaceCell?.querySelector(".dev-map-glyph")?.textContent).toBe("+ ");
	});

	it("objective object on paired space renders '**' with data-kind='objective-object-on-space'", () => {
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		const spaceEntity = state.world.entities.find(
			(e) => e.kind === "objective_space",
		);

		if (objEntity && spaceEntity) {
			objEntity.holder = { row: 3, col: 3 };
			spaceEntity.holder = { row: 3, col: 3 };
		}

		renderWorldMap(containerEl, session);

		const pairCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-object-on-space"]',
		);
		expect(pairCell).toBeTruthy();

		const glyph = pairCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("**");
	});

	it("interesting_object renders 'o ' with data-kind='interesting-object'", () => {
		const interesting: WorldEntity = {
			id: "test_interesting",
			kind: "interesting_object",
			name: "Shiny Thing",
			examineDescription: "A shiny thing",
			holder: { row: 2, col: 2 },
		};
		state.world.entities.push(interesting);

		renderWorldMap(containerEl, session);

		const interestingCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="interesting-object"]',
		);
		expect(interestingCell).toBeTruthy();

		const glyph = interestingCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("o ");
	});

	it("floor cell renders '. ' with tooltip 'floor (r,c)'", () => {
		renderWorldMap(containerEl, session);

		const floorCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="floor"]',
		);
		expect(floorCell).toBeTruthy();

		const glyph = floorCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe(". ");

		const tooltip = floorCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toMatch(/^floor \(\d,\d\)$/);
	});

	it("daemon glyph beats obstacle on same cell (precedence)", () => {
		const obstacle: WorldEntity = {
			id: "test_obstacle",
			kind: "obstacle",
			name: "Test Block",
			examineDescription: "A test block",
			holder: { row: 0, col: 0 },
		};
		state.world.entities.push(obstacle);

		renderWorldMap(containerEl, session);

		const cell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		expect(cell).toBeTruthy();

		const glyph = cell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("@ ");
	});

	it("obstacle glyph beats objective object on same cell", () => {
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 1, col: 1 };
		}

		const obstacle: WorldEntity = {
			id: "test_obstacle",
			kind: "obstacle",
			name: "Test Block",
			examineDescription: "A test block",
			holder: { row: 1, col: 1 },
		};
		state.world.entities.push(obstacle);

		renderWorldMap(containerEl, session);

		const cell = containerEl.querySelector(
			'.dev-map-cell[data-kind="obstacle"]',
		);
		expect(cell).toBeTruthy();

		const glyph = cell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("##");
	});

	it("objective object held by daemon does not render on floor; appears in daemon tooltip", () => {
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = "red";
		}

		renderWorldMap(containerEl, session);

		const objCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-object"]',
		);
		expect(objCell).toBeFalsy();

		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const tooltip = redCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toContain("cracked lantern");
	});

	it("updateWorldMap keeps every cell span (no creation, removal or re-creation)", () => {
		renderWorldMap(containerEl, session);

		const cellsBefore = [...containerEl.querySelectorAll(".dev-map-cell")];

		updateWorldMap(containerEl, session);

		const cellsAfter = [...containerEl.querySelectorAll(".dev-map-cell")];
		expect(cellsAfter.length).toBe(25);
		for (const [index, cell] of cellsAfter.entries()) {
			expect(cell).toBe(cellsBefore[index]);
		}
		expect(
			containerEl.querySelectorAll('.dev-map-cell[data-kind="wall"]').length,
		).toBe(0);
	});

	it("updateWorldMap reflects new daemon position after mutation", () => {
		renderWorldMap(containerEl, session);

		const tooltipBefore = containerEl
			.querySelector('.dev-map-cell[data-ai="red"] .dev-map-tooltip')
			?.textContent.trim();

		const redSpatial = state.personaSpatial.red;
		if (!redSpatial) throw new Error("Red spatial state missing");
		redSpatial.position = { row: 2, col: 2 };

		updateWorldMap(containerEl, session);

		const redCellAfter = containerEl.querySelector(
			'.dev-map-cell[data-cell="2,2"]',
		);
		expect(redCellAfter?.getAttribute("data-ai")).toBe("red");

		expect(redCellAfter?.querySelector(".dev-map-glyph")?.textContent).toBe(
			"@ ",
		);
		expect(
			redCellAfter?.querySelector(".dev-map-tooltip")?.textContent.trim(),
		).toBe(tooltipBefore);

		const oldCell = containerEl.querySelector('.dev-map-cell[data-cell="0,0"]');
		expect(oldCell?.getAttribute("data-ai")).toBeNull();
	});

	it("updateWorldMap reflects satisfaction state change in data-satisfaction and tooltip", () => {
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 1, col: 1 };
		}

		renderWorldMap(containerEl, session);

		const objCellBefore = containerEl.querySelector(
			'.dev-map-cell[data-cell="1,1"]',
		);
		expect(objCellBefore?.getAttribute("data-kind")).toBe("objective-object");

		if (objEntity) {
			objEntity.satisfactionState = "satisfied";
		}

		updateWorldMap(containerEl, session);

		const objCell = containerEl.querySelector('.dev-map-cell[data-cell="1,1"]');
		expect(objCell?.getAttribute("data-satisfaction")).toBe("satisfied");

		const tooltip = objCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toContain("satisfied");
	});

	it("tooltip is a child span, not a native title attribute", () => {
		renderWorldMap(containerEl, session);

		const cellsWithTitle = containerEl.querySelectorAll(".dev-map-cell[title]");
		expect(cellsWithTitle.length).toBe(0);

		const cells = containerEl.querySelectorAll(".dev-map-cell");
		for (const cell of cells) {
			const tooltip = cell.querySelector(".dev-map-tooltip");
			expect(tooltip).toBeTruthy();
		}
	});

	it("renderWorldMap is idempotent — second call leaves exactly one .dev-map-grid child", () => {
		renderWorldMap(containerEl, session);
		const firstGrids = containerEl.querySelectorAll(".dev-map-grid");
		expect(firstGrids.length).toBe(1);

		renderWorldMap(containerEl, session);
		const secondGrids = containerEl.querySelectorAll(".dev-map-grid");
		expect(secondGrids.length).toBe(1);
	});
});
