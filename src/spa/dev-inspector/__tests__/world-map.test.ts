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

	it("renders a room-only 5×5 grid (25 cells)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const cells = containerEl.querySelectorAll(".dev-map-cell");
		expect(cells.length).toBe(25);

		const grid = containerEl.querySelector(".dev-map-grid");
		expect(grid?.getAttribute("data-rows")).toBe("5");
		expect(grid?.getAttribute("data-cols")).toBe("5");
	});

	it("renders no wall cells and no out-of-bounds tooltip", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

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

	it("every cell is a room cell: data-cell (r,c) is the room (r,c) in [0..4]", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const seen = new Set<string>();
		for (const cell of containerEl.querySelectorAll(".dev-map-cell")) {
			const cellStr = cell.getAttribute("data-cell");
			expect(cellStr).toBeTruthy();
			if (!cellStr) continue;
			const [rowStr, colStr] = cellStr.split(",");
			const row = Number(rowStr);
			const col = Number(colStr);
			expect(row).toBeGreaterThanOrEqual(0);
			expect(row).toBeLessThanOrEqual(4);
			expect(col).toBeGreaterThanOrEqual(0);
			expect(col).toBeLessThanOrEqual(4);
			seen.add(cellStr);
		}
		expect(seen.size).toBe(25);
	});

	it("daemon cell renders the identity marker with persona color and data-ai", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		// Red daemon starts at (0,0) = cell "0,0"
		const daemonCell = containerEl.querySelector(
			'.dev-map-cell[data-ai="red"]',
		);
		expect(daemonCell).toBeTruthy();

		const glyph = daemonCell?.querySelector(".dev-map-glyph");
		expect(glyph?.textContent).toBe("@ ");

		// Color is set; browsers convert hex to rgb, so just check it's not empty
		if (daemonCell instanceof HTMLElement) {
			expect(daemonCell.style.color).toBeTruthy();
		}
	});

	it("daemon markers show identity and position only — no arrow glyph, no direction text", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const daemonCells = containerEl.querySelectorAll(".dev-map-cell[data-ai]");
		expect(daemonCells.length).toBe(3);

		for (const cell of daemonCells) {
			const glyph = cell.querySelector(".dev-map-glyph")?.textContent;
			expect(glyph).toBe("@ ");
			expect(glyph).not.toMatch(/[<>^v]/);

			// Exact tooltip: identity label plus held item, nothing else.
			const tooltip = cell.querySelector(".dev-map-tooltip")?.textContent;
			expect(tooltip).toMatch(/^\*[A-Za-z]+ — holds: .+$/);

			// The whole marker text is glyph + tooltip; exact match rules out
			// any direction arrow, direction letter, or direction wording.
			expect(cell.textContent).toMatch(/^@ \*[A-Za-z]+ — holds: .+$/);
		}
	});

	it("daemon tooltip format: *<name> — holds: <item> (<id>)", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const redCell = containerEl.querySelector('.dev-map-cell[data-ai="red"]');
		const tooltip = redCell?.querySelector(".dev-map-tooltip");
		expect(tooltip?.textContent).toMatch(/^\*Ember — holds: nothing$/);
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
		expect(glyph?.textContent).toBe("@ ");
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

	it("updateWorldMap does not create or remove cells", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const cellsBefore = [...containerEl.querySelectorAll(".dev-map-cell")];

		updateWorldMap(containerEl, session);

		const cellsAfter = [...containerEl.querySelectorAll(".dev-map-cell")];
		expect(cellsAfter.length).toBe(25);
		// Same nodes, same order, same coordinates: nothing re-created.
		expect(cellsAfter).toEqual(cellsBefore);
		for (const [index, cell] of cellsAfter.entries()) {
			expect(cell.getAttribute("data-cell")).toBe(
				cellsBefore[index]?.getAttribute("data-cell"),
			);
		}
		expect(
			containerEl.querySelectorAll('.dev-map-cell[data-kind="wall"]').length,
		).toBe(0);
	});

	it("updateWorldMap reflects new daemon position after mutation", () => {
		const contentPack = STATIC_CONTENT_PACKS[0];
		if (!contentPack) throw new Error("Content pack missing");
		const session = new GameSession(contentPack, STATIC_PERSONAS);
		const state = session.getState();
		const containerEl = document.getElementById("dev-world-map") as HTMLElement;

		renderWorldMap(containerEl, session);

		const tooltipBefore = containerEl
			.querySelector('.dev-map-cell[data-ai="red"] .dev-map-tooltip')
			?.textContent.trim();

		// Move red daemon to (2,2)
		const redSpatial = state.personaSpatial.red;
		if (!redSpatial) throw new Error("Red spatial state missing");
		redSpatial.position = { row: 2, col: 2 };

		// Update
		updateWorldMap(containerEl, session);

		// Room position (2,2) is display cell "2,2" in the room-only grid
		const redCellAfter = containerEl.querySelector(
			'.dev-map-cell[data-cell="2,2"]',
		);
		expect(redCellAfter?.getAttribute("data-ai")).toBe("red");

		// The identity marker moved with the daemon, unchanged in content.
		expect(redCellAfter?.querySelector(".dev-map-glyph")?.textContent).toBe(
			"@ ",
		);
		expect(
			redCellAfter?.querySelector(".dev-map-tooltip")?.textContent.trim(),
		).toBe(tooltipBefore);

		// The old cell no longer carries the marker.
		const oldCell = containerEl.querySelector('.dev-map-cell[data-cell="0,0"]');
		expect(oldCell?.getAttribute("data-ai")).toBeNull();
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
			'.dev-map-cell[data-cell="1,1"]',
		);
		expect(objCellBefore?.getAttribute("data-kind")).toBe("objective-object");

		// Change its satisfaction
		if (objEntity) {
			objEntity.satisfactionState = "satisfied";
		}

		// Update
		updateWorldMap(containerEl, session);

		// Check that the cell has the updated satisfaction
		const objCell = containerEl.querySelector('.dev-map-cell[data-cell="1,1"]');
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
