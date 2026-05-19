import { beforeEach, describe, expect, it } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import type { WorldEntity } from "../../game/types";
import { renderWorldMap, updateWorldMap } from "../world-map";

describe("world-map", () => {
	beforeEach(() => {
		document.body.innerHTML = '<div id="dev-world-map"></div>';
	});

	it("renders a 7×7 grid (49 cells)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const cells = containerEl.querySelectorAll(".dev-map-cell");
		expect(cells.length).toBe(49);
	});

	it("has exactly 24 wall cells (outer ring)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const wallCells = containerEl.querySelectorAll(
			'.dev-map-cell[data-kind="wall"]',
		);
		expect(wallCells.length).toBe(24);
	});

	it("wall cells display tooltip 'wall (out of bounds)'", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const wallCells = containerEl.querySelectorAll(
			'.dev-map-cell[data-kind="wall"]',
		);
		for (const cell of wallCells) {
			const tooltip = cell.querySelector(".dev-map-tooltip");
			expect(tooltip?.textContent).toBe("wall (out of bounds)");
		}
	});

	it("each inner cell has data-cell with r,c in [0..4]", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const innerCells = containerEl.querySelectorAll(
			'.dev-map-cell:not([data-kind="wall"])',
		);
		expect(innerCells.length).toBe(25);

		for (const cell of innerCells) {
			const cellStr = cell.getAttribute("data-cell");
			expect(cellStr).toBeTruthy();
			if (!cellStr) continue;
			const [rowStr, colStr] = cellStr.split(",");
			const row = Number(rowStr);
			const col = Number(colStr);
			expect(row).toBeGreaterThanOrEqual(1);
			expect(row).toBeLessThanOrEqual(5);
			expect(col).toBeGreaterThanOrEqual(1);
			expect(col).toBeLessThanOrEqual(5);
		}
	});

	it("daemon cell renders <arrow> with persona color and data-ai", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// Red daemon starts at (0,0) = visual (1,1)
		const daemonCell = containerEl.querySelector(
			'.dev-map-cell[data-ai="red"]',
		);
		expect(daemonCell).toBeTruthy();

		const glyph = daemonCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toMatch(/^[<>^v] $/);

		// Color is set; browsers convert hex to rgb, so just check it's not empty
		if (daemonCell instanceof HTMLElement) {
			expect(daemonCell.style.color).toBeTruthy();
		}
	});

	it("facing-arrow mapping: north→^, south→v, east→>, west→<", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Red faces north initially
		const redSpatial = state.personaSpatial.red;
		expect(redSpatial).toBeTruthy();
		if (!redSpatial) throw new Error("Red spatial state missing");
		expect(redSpatial.facing).toBe("north");

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const glyph = redCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("^ ");
	});

	it("daemon tooltip format: *<name> — facing <N|S|E|W> — holds: <item> (<id>)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const tooltip = redCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toMatch(
			/^\*Ember — facing N — holds: nothing$/,
		);
	});

	it("daemon tooltip 'holds: nothing' when no held entity", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// All daemons start without holding anything
		const daemonCells = containerEl.querySelectorAll(".dev-map-cell[data-ai]");
		for (const cell of daemonCells) {
			const tooltip = cell.querySelector(".dev-map-tooltip");
			expect(tooltip?.textContent).toContain("holds: nothing");
		}
	});

	it("obstacle cell renders ## with data-kind and data-entity-id", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Add an obstacle at (1,1)
		const obstacle: WorldEntity = {
			id: "test_obstacle",
			kind: "obstacle",
			name: "Test Block",
			examineDescription: "A test block",
			holder: { row: 1, col: 1 },
		};
		state.world.entities.push(obstacle);

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		const obstacleCell = containerEl.querySelector(
			'.dev-map-cell[data-entity-id="test_obstacle"]',
		);
		expect(obstacleCell).toBeTruthy();
		expect(obstacleCell?.getAttribute("data-kind")).toBe("obstacle");

		const glyph = obstacleCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("##");
	});

	it("objective_object alone renders '* ' with data-kind='objective-object'", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Move the objective object away from its space
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 2, col: 2 };
		}

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		const objCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-object"]',
		);
		expect(objCell).toBeTruthy();

		const glyph = objCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("* ");
	});

	it("objective_space alone renders '+ ' with data-kind='objective-space'", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Move the objective object away from its space
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 2, col: 2 };
		}

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		const spaceCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-space"]',
		);
		expect(spaceCell).toBeTruthy();

		const glyph = spaceCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("+ ");
	});

	it("objective object on paired space renders '**' with data-kind='objective-object-on-space'", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Both object and space start at their default positions which form a pair
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		const spaceEntity = state.world.entities.find(
			(e) => e.kind === "objective_space",
		);

		// Put them at the same location
		if (objEntity && spaceEntity) {
			objEntity.holder = { row: 3, col: 3 };
			spaceEntity.holder = { row: 3, col: 3 };
		}

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		const pairCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-object-on-space"]',
		);
		expect(pairCell).toBeTruthy();

		const glyph = pairCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("**");
	});

	it("interesting_object renders 'o ' with data-kind='interesting-object'", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Add an interesting object
		const interesting: WorldEntity = {
			id: "test_interesting",
			kind: "interesting_object",
			name: "Shiny Thing",
			examineDescription: "A shiny thing",
			holder: { row: 2, col: 2 },
		};
		state.world.entities.push(interesting);

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		const interestingCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="interesting-object"]',
		);
		expect(interestingCell).toBeTruthy();

		const glyph = interestingCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("o ");
	});

	it("floor cell renders '. ' with tooltip 'floor (r,c)'", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

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
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Place obstacle at red daemon's position
		const obstacle: WorldEntity = {
			id: "test_obstacle",
			kind: "obstacle",
			name: "Test Block",
			examineDescription: "A test block",
			holder: { row: 0, col: 0 },
		};
		state.world.entities.push(obstacle);

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		// Should show daemon, not obstacle
		const cell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		expect(cell).toBeTruthy();

		const glyph = cell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toMatch(/^[<>^v] $/);
	});

	it("obstacle glyph beats objective object on same cell", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Get objective object and move it to (1,1)
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 1, col: 1 };
		}

		// Add obstacle at same location
		const obstacle: WorldEntity = {
			id: "test_obstacle",
			kind: "obstacle",
			name: "Test Block",
			examineDescription: "A test block",
			holder: { row: 1, col: 1 },
		};
		state.world.entities.push(obstacle);

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		// Should show obstacle, not objective object
		const cell = containerEl.querySelector(
			'.dev-map-cell[data-kind="obstacle"]',
		);
		expect(cell).toBeTruthy();

		const glyph = cell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("##");
	});

	it("objective object held by daemon does not render on floor; appears in daemon tooltip", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();

		// Make red daemon hold the objective object
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = "red";
		}

		const containerEl = document.getElementById("dev-world-map") as HTMLElement;
		renderWorldMap(containerEl, session);

		// Objective object should not have a floor cell
		const objCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="objective-object"]',
		);
		expect(objCell).toBeFalsy();

		// But it should appear in red daemon's tooltip
		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const tooltip = redCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toContain("cracked lantern");
	});

	it("updateWorldMap preserves cell span identity (no re-creation)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// Get the first cell's identity
		const firstCell = containerEl.querySelector(".dev-map-cell");
		const firstCellIdentity = firstCell;

		// Update the map
		updateWorldMap(containerEl, session);

		// First cell should be the same object
		const firstCellAfter = containerEl.querySelector(".dev-map-cell");
		expect(firstCellAfter).toBe(firstCellIdentity);
	});

	it("updateWorldMap does not modify wall spans", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// Get wall cell contents before update
		const wallCell = containerEl.querySelector(
			'.dev-map-cell[data-kind="wall"]',
		);
		const wallGlyphBefore =
			wallCell?.querySelector(".dev-map-glyph")?.textContent;
		const wallTooltipBefore =
			wallCell?.querySelector(".dev-map-tooltip")?.textContent;

		// Update
		updateWorldMap(containerEl, session);

		// Wall cells should be unchanged
		const wallGlyphAfter =
			wallCell?.querySelector(".dev-map-glyph")?.textContent;
		const wallTooltipAfter =
			wallCell?.querySelector(".dev-map-tooltip")?.textContent;

		expect(wallGlyphAfter).toBe(wallGlyphBefore);
		expect(wallTooltipAfter).toBe(wallTooltipBefore);
	});

	it("updateWorldMap reflects new daemon position after mutation", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// Move red daemon to (2,2)
		const redSpatial = state.personaSpatial.red;
		if (!redSpatial) throw new Error("Red spatial state missing");
		redSpatial.position = { row: 2, col: 2 };

		// Update
		updateWorldMap(containerEl, session);

		// Visual position should be (3,3) = data-cell="3,3"
		const redCellAfter = containerEl.querySelector(
			'.dev-map-cell[data-cell="3,3"]',
		);
		expect(redCellAfter?.getAttribute("data-ai")).toBe("red");
	});

	it("updateWorldMap reflects facing-only changes", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// Change red daemon facing from north to east
		const redSpatial = state.personaSpatial.red;
		if (!redSpatial) throw new Error("Red spatial state missing");
		redSpatial.facing = "east";

		// Update
		updateWorldMap(containerEl, session);

		// Glyph should now be >
		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const glyph = redCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("> ");
	});

	it("updateWorldMap reflects satisfaction state change in data-satisfaction and tooltip", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		// Find objective object and move it away from space first
		const objEntity = state.world.entities.find(
			(e) => e.kind === "objective_object",
		);
		if (objEntity) {
			objEntity.holder = { row: 1, col: 1 };
		}

		renderWorldMap(containerEl, session);

		// Verify it was rendered with initial satisfaction state
		const objCellBefore = containerEl.querySelector(
			'.dev-map-cell[data-cell="2,2"]',
		);
		expect(objCellBefore?.getAttribute("data-kind")).toBe("objective-object");

		// Change its satisfaction
		if (objEntity) {
			objEntity.satisfactionState = "satisfied";
		}

		// Update
		updateWorldMap(containerEl, session);

		// Check that the cell has the updated satisfaction
		const objCell = containerEl.querySelector('.dev-map-cell[data-cell="2,2"]');
		expect(objCell?.getAttribute("data-satisfaction")).toBe("satisfied");

		const tooltip = objCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toContain("satisfied");
	});

	it("tooltip is a child span, not a native title attribute", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// No cells should have [title] attribute
		const cellsWithTitle = containerEl.querySelectorAll(".dev-map-cell[title]");
		expect(cellsWithTitle.length).toBe(0);

		// All cells should have a .dev-map-tooltip child
		const cells = containerEl.querySelectorAll(".dev-map-cell");
		for (const cell of cells) {
			const tooltip = cell.querySelector(".dev-map-tooltip");
			expect(tooltip).toBeTruthy();
		}
	});

	it("renderWorldMap is idempotent — second call leaves exactly one .dev-map-grid child", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);
		const firstGrids = containerEl.querySelectorAll(".dev-map-grid");
		expect(firstGrids.length).toBe(1);

		// Call renderWorldMap again
		renderWorldMap(containerEl, session);
		const secondGrids = containerEl.querySelectorAll(".dev-map-grid");
		expect(secondGrids.length).toBe(1);
	});
});
