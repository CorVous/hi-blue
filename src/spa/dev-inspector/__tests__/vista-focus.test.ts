import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { inBounds } from "../../game/direction";
import { GameSession } from "../../game/game-session";
import type { GridPosition, PersonaSpatialState } from "../../game/types";
import { inVista, VISTA_OFFSETS } from "../../game/vista-projector";
import { __resetInspectorForTests, renderInspector } from "../index";
import { vistaMaskForDaemon, vistaMaskForPosition } from "../vista-mask";
import {
	getMapFocus,
	renderWorldMap,
	setMapFocus,
	updateWorldMap,
} from "../world-map";

function expectedVistaMask(position: GridPosition): Set<string> {
	const expected = new Set<string>();
	for (const offset of VISTA_OFFSETS) {
		const cell: GridPosition = {
			row: position.row - offset.dy,
			col: position.col + offset.dx,
		};
		if (!inBounds(cell)) continue;
		expected.add(`${cell.row},${cell.col}`);
	}
	return expected;
}

function highlightedCells(containerEl: HTMLElement, aiId: string): Set<string> {
	const highlighted = new Set<string>();
	for (const cell of containerEl.querySelectorAll<HTMLElement>(
		".dev-map-cell",
	)) {
		if (cell.getAttribute("data-vista-focus") !== aiId) continue;
		const dataCell = cell.getAttribute("data-cell");
		if (dataCell) highlighted.add(dataCell);
	}
	return highlighted;
}

function activeFocusButtons(): string[] {
	const active: string[] = [];
	for (const btn of document.querySelectorAll<HTMLElement>(
		'[data-field="focus-vista"]',
	)) {
		if (btn.getAttribute("data-focus-active") !== "true") continue;
		const panel = btn.closest<HTMLElement>(".ai-panel");
		active.push(panel?.getAttribute("data-ai") ?? "(unknown)");
	}
	return active;
}

function focusedCellIds(containerEl: HTMLElement): string[] {
	return [...containerEl.querySelectorAll<HTMLElement>(".dev-map-cell")]
		.filter((cell) => cell.hasAttribute("data-vista-focus"))
		.map((cell) => cell.getAttribute("data-cell") ?? "(none)");
}

function normaliseColor(color: string | undefined): string {
	const probe = document.createElement("span");
	probe.style.color = color ?? "";
	return probe.style.color;
}

function sorted(values: Set<string>): string[] {
	return [...values].sort();
}

describe("vista-focus", () => {
	let session: GameSession;
	let spatialSnapshot: Array<{
		spatial: PersonaSpatialState;
		position: GridPosition;
	}> = [];
	const contentPack = STATIC_CONTENT_PACKS[0];

	beforeEach(() => {
		document.body.innerHTML = `
      <div id="dev-game-strip"></div>
      <div id="dev-world-map"></div>
      <article class="ai-panel" data-ai="red">
        <div class="dev-daemon-footer"></div>
      </article>
      <article class="ai-panel" data-ai="green">
        <div class="dev-daemon-footer"></div>
      </article>
      <article class="ai-panel" data-ai="cyan">
        <div class="dev-daemon-footer"></div>
      </article>
    `;

		if (!contentPack) throw new Error("Content pack missing");
		session = new GameSession(contentPack, STATIC_PERSONAS);

		spatialSnapshot = Object.values(session.getState().personaSpatial).map(
			(spatial) => ({
				spatial,
				position: spatial.position,
			}),
		);

		__resetInspectorForTests();
	});

	afterEach(() => {
		for (const snapshot of spatialSnapshot) {
			snapshot.spatial.position = snapshot.position;
		}
		spatialSnapshot = [];
	});

	describe("mask computation", () => {
		it("the shared Vista table is the 13-cell disk", () => {
			expect(VISTA_OFFSETS.length).toBe(13);
			for (const offset of VISTA_OFFSETS) {
				expect(inVista(offset.dx, offset.dy)).toBe(true);
			}
			expect(inVista(2, 1)).toBe(false);
			expect(inVista(2, 2)).toBe(false);
		});

		it("mask equals the in-bounds Vista cells for every position", () => {
			for (let row = 0; row < 5; row++) {
				for (let col = 0; col < 5; col++) {
					const position: GridPosition = { row, col };
					expect(sorted(vistaMaskForPosition(position))).toEqual(
						sorted(expectedVistaMask(position)),
					);
				}
			}
		});

		it("mask equals the ADR's dx² + dy² ≤ 4 disk clipped to the room, for all 25 positions", () => {
			const RADIUS_SQUARED = 4;
			for (let row = 0; row < 5; row++) {
				for (let col = 0; col < 5; col++) {
					const position: GridPosition = { row, col };
					const expected = new Set<string>();
					for (let r = 0; r < 5; r++) {
						for (let c = 0; c < 5; c++) {
							const dx = c - col;
							const dy = r - row;
							if (dx * dx + dy * dy <= RADIUS_SQUARED) {
								expected.add(`${r},${c}`);
							}
						}
					}

					expect(sorted(vistaMaskForPosition(position))).toEqual(
						sorted(expected),
					);
				}
			}
		});

		it("a centred Daemon highlights all 13 Vista cells at radius 2", () => {
			const mask = vistaMaskForPosition({ row: 2, col: 2 });

			expect(mask.size).toBe(13);
			expect(mask.has("2,2")).toBe(true);
			for (const cell of ["0,2", "4,2", "2,0", "2,4"]) {
				expect(mask.has(cell)).toBe(true);
			}
			for (const cell of ["1,1", "1,3", "3,1", "3,3"]) {
				expect(mask.has(cell)).toBe(true);
			}
			expect(mask.has("0,3")).toBe(false);
			expect(mask.has("4,3")).toBe(false);
		});

		it("mask omits OOB walls — corner daemon keeps only its in-bounds cells", () => {
			const mask = vistaMaskForPosition({ row: 0, col: 0 });

			expect(mask).toEqual(expectedVistaMask({ row: 0, col: 0 }));
			expect(mask.has("0,0")).toBe(true);
			expect(mask.size).toBe(6);

			for (const cellStr of mask) {
				const [rowStr, colStr] = cellStr.split(",");
				const row = Number(rowStr);
				const col = Number(colStr);
				expect(row).toBeGreaterThanOrEqual(0);
				expect(row).toBeLessThanOrEqual(4);
				expect(col).toBeGreaterThanOrEqual(0);
				expect(col).toBeLessThanOrEqual(4);
			}
		});

		it("highlight depends only on position: Daemons in the same cell share a mask", () => {
			const state = session.getState();
			const redSpatial = state.personaSpatial.red;
			const greenSpatial = state.personaSpatial.green;
			if (!redSpatial || !greenSpatial) {
				throw new Error("Spatial state missing");
			}

			redSpatial.position = { row: 2, col: 2 };
			greenSpatial.position = { row: 2, col: 2 };

			const redMask = vistaMaskForDaemon(state, "red");
			const greenMask = vistaMaskForDaemon(state, "green");

			expect(sorted(redMask)).toEqual(sorted(greenMask));
			expect(sorted(redMask)).toEqual(
				sorted(expectedVistaMask({ row: 2, col: 2 })),
			);
		});

		it("mask empty when daemon missing", () => {
			const state = session.getState();
			const mask = vistaMaskForDaemon(state, "nonexistent");
			expect(mask.size).toBe(0);
		});
	});

	describe("focus state management", () => {
		it("setMapFocus toggles getMapFocus: null → red → null", () => {
			expect(getMapFocus()).toBe(null);

			setMapFocus("red");
			expect(getMapFocus()).toBe("red");

			setMapFocus(null);
			expect(getMapFocus()).toBe(null);
		});

		it("switching focus targets: red → green removes red tint, applies green tint", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");
			expect(highlightedCells(containerEl, "red").size).toBeGreaterThan(0);

			setMapFocus("green");

			expect(highlightedCells(containerEl, "green").size).toBeGreaterThan(0);
			expect(highlightedCells(containerEl, "red").size).toBe(0);
		});
	});

	describe("visual tinting", () => {
		it("setMapFocus tints exactly the in-bounds Vista cells with persona color", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");

			const state = session.getState();
			const redSpatial = state.personaSpatial.red;
			if (!redSpatial) throw new Error("Red spatial state missing");
			const mask = expectedVistaMask(redSpatial.position);
			const redColor = state.personas.red?.color;

			expect(redColor).toBeTruthy();
			expect(mask.size).toBeGreaterThan(0);

			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				const dataCell = cell.getAttribute("data-cell");
				if (dataCell !== null && mask.has(dataCell)) {
					expect(cell.style.backgroundColor).toBeTruthy();
					expect(cell.getAttribute("data-vista-focus")).toBe("red");
				} else {
					expect(cell.style.backgroundColor).toBe("");
					expect(cell.getAttribute("data-vista-focus")).toBeNull();
				}
			}

			expect(sorted(highlightedCells(containerEl, "red"))).toEqual(
				sorted(mask),
			);
		});

		it("setMapFocus(null) clears tint: all cells revert", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");
			setMapFocus(null);

			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				expect(cell.style.backgroundColor).toBe("");
				expect(cell.getAttribute("data-vista-focus")).toBeNull();
			}
		});

		it("highlight preserves the identity marker", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");

			const redCell = containerEl.querySelector(
				'[data-ai="red"]',
			) as HTMLElement;
			expect(redCell).toBeTruthy();

			const glyph = redCell.querySelector(".dev-map-glyph");
			expect(glyph?.textContent).toBe("@ ");
			expect(redCell.getAttribute("data-ai")).toBe("red");
			expect(redCell.style.color).toBeTruthy();
			expect(redCell.querySelector(".dev-map-tooltip")?.textContent).toMatch(
				/^\*Ember — holds: nothing$/,
			);

			expect(redCell.style.color).toBe(
				normaliseColor(session.getState().personas.red?.color),
			);
			expect(redCell.style.backgroundColor).toBeTruthy();
		});

		it("a Daemon inside the focused Vista keeps its own marker, colour and tooltip", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			const state = session.getState();
			const redSpatial = state.personaSpatial.red;
			if (!redSpatial) throw new Error("Red spatial state missing");
			const redMask = expectedVistaMask(redSpatial.position);

			setMapFocus("red");

			for (const aiId of ["green", "cyan"]) {
				const neighbour = containerEl.querySelector<HTMLElement>(
					`.dev-map-cell[data-ai="${aiId}"]`,
				);
				expect(neighbour).toBeTruthy();
				if (!neighbour) continue;

				const dataCell = neighbour.getAttribute("data-cell");
				expect(dataCell).toBeTruthy();
				if (dataCell) expect(redMask.has(dataCell)).toBe(true);

				expect(neighbour.getAttribute("data-vista-focus")).toBe("red");
				expect(neighbour.style.backgroundColor).toBeTruthy();

				const persona = state.personas[aiId];
				expect(neighbour.style.color).toBe(normaliseColor(persona?.color));
				expect(neighbour.style.color).not.toBe(
					normaliseColor(state.personas.red?.color),
				);
				expect(neighbour.getAttribute("data-ai")).toBe(aiId);
				expect(neighbour.querySelector(".dev-map-glyph")?.textContent).toBe(
					"@ ",
				);
				expect(neighbour.querySelector(".dev-map-tooltip")?.textContent).toBe(
					`*${persona?.name} — holds: nothing`,
				);
			}
		});

		it("clearing focus restores clean cells while identity markers stay intact", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			const state = session.getState();

			setMapFocus("red");
			expect(focusedCellIds(containerEl).length).toBeGreaterThan(0);

			setMapFocus(null);

			expect(focusedCellIds(containerEl)).toEqual([]);
			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				expect(cell.style.backgroundColor).toBe("");
				expect(cell.getAttribute("data-vista-focus")).toBeNull();
			}

			for (const aiId of ["red", "green", "cyan"]) {
				const cell = containerEl.querySelector<HTMLElement>(
					`.dev-map-cell[data-ai="${aiId}"]`,
				);
				expect(cell).toBeTruthy();
				expect(cell?.style.color).toBe(
					normaliseColor(state.personas[aiId]?.color),
				);
				expect(cell?.querySelector(".dev-map-glyph")?.textContent).toBe("@ ");
			}
		});

		it("updateWorldMap follows the focused Daemon as it moves", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;

			const state = session.getState();
			const redSpatial = state.personaSpatial.red;
			if (!redSpatial) throw new Error("Red spatial state missing");
			redSpatial.position = { row: 0, col: 0 };

			renderWorldMap(containerEl, session);

			setMapFocus("red");
			const before = highlightedCells(containerEl, "red");
			expect(sorted(before)).toEqual(
				sorted(expectedVistaMask({ row: 0, col: 0 })),
			);

			redSpatial.position = { row: 2, col: 2 };

			updateWorldMap(containerEl, session);

			const after = highlightedCells(containerEl, "red");
			expect(sorted(after)).toEqual(
				sorted(expectedVistaMask({ row: 2, col: 2 })),
			);
			expect(after.size).toBe(13);
			expect(after.has("2,2")).toBe(true);
			expect(after.has("0,0")).toBe(false);

			const movedCell =
				containerEl.querySelector<HTMLElement>('[data-ai="red"]');
			expect(movedCell?.getAttribute("data-cell")).toBe("2,2");
			expect(movedCell?.getAttribute("data-vista-focus")).toBe("red");
			expect(movedCell?.querySelector(".dev-map-glyph")?.textContent).toBe(
				"@ ",
			);
			expect(movedCell?.style.color).toBe(
				normaliseColor(state.personas.red?.color),
			);

			const vacated = containerEl.querySelector<HTMLElement>(
				'.dev-map-cell[data-cell="0,0"]',
			);
			expect(vacated?.hasAttribute("data-vista-focus")).toBe(false);
			expect(vacated?.style.backgroundColor).toBe("");
			expect(vacated?.hasAttribute("data-ai")).toBe(false);

			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell[data-vista-focus]",
			)) {
				expect(cell.getAttribute("data-vista-focus")).toBe("red");
			}
			expect(focusedCellIds(containerEl).length).toBe(13);
		});

		it("updateWorldMap re-applies active tint after mutation", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");
			const state1 = session.getState();
			const mask1 = vistaMaskForDaemon(state1, "red");

			const tintedBefore = highlightedCells(containerEl, "red").size;
			expect(tintedBefore).toBeGreaterThan(0);

			updateWorldMap(containerEl, session);

			const state2 = session.getState();
			const mask2 = vistaMaskForDaemon(state2, "red");

			expect(mask1.size).toBe(mask2.size);
			expect(highlightedCells(containerEl, "red").size).toBeGreaterThan(0);
		});
	});

	describe("focus button", () => {
		it("button rendered in footer", () => {
			const root = document.body;
			renderInspector(root, { session });

			const focusBtn = document.querySelector(
				'[data-field="focus-vista"]',
			) as HTMLButtonElement;
			expect(focusBtn).toBeTruthy();
			expect(focusBtn.textContent).toBe("[ focus vista ]");
		});

		it("button click sets focus", () => {
			const root = document.body;
			renderInspector(root, { session });

			const focusBtn = document.querySelector(
				'[data-field="focus-vista"]',
			) as HTMLButtonElement;
			expect(focusBtn).toBeTruthy();

			focusBtn.click();

			const panel = focusBtn.closest(".ai-panel") as HTMLElement;
			const aiId = panel?.getAttribute("data-ai");
			expect(getMapFocus()).toBe(aiId);
		});

		it("repeat click on the focused control clears focus", () => {
			const root = document.body;
			renderInspector(root, { session });

			const redPanel = document.querySelector(
				'.ai-panel[data-ai="red"]',
			) as HTMLElement;
			expect(redPanel).toBeTruthy();
			const focusBtn = redPanel.querySelector(
				'[data-field="focus-vista"]',
			) as HTMLButtonElement;
			expect(focusBtn).toBeTruthy();

			focusBtn.click();
			expect(getMapFocus()).toBe("red");

			focusBtn.click();
			expect(getMapFocus()).toBeNull();
		});

		it("switching between two Daemons leaves exactly one button active and one tint owner", () => {
			const root = document.body;
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderInspector(root, { session });
			renderWorldMap(containerEl, session);

			const btnFor = (aiId: string): HTMLButtonElement => {
				const btn = document
					.querySelector(`.ai-panel[data-ai="${aiId}"]`)
					?.querySelector('[data-field="focus-vista"]');
				expect(btn).toBeTruthy();
				return btn as HTMLButtonElement;
			};

			btnFor("red").click();

			expect(activeFocusButtons()).toEqual(["red"]);
			expect(focusedCellIds(containerEl).length).toBeGreaterThan(0);
			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell[data-vista-focus]",
			)) {
				expect(cell.getAttribute("data-vista-focus")).toBe("red");
			}

			btnFor("green").click();

			expect(activeFocusButtons()).toEqual(["green"]);
			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				expect(cell.getAttribute("data-vista-focus")).not.toBe("red");
			}
			expect(highlightedCells(containerEl, "red").size).toBe(0);
			expect(highlightedCells(containerEl, "green").size).toBeGreaterThan(0);

			const greenSpatial = session.getState().personaSpatial.green;
			if (!greenSpatial) throw new Error("Green spatial state missing");
			expect(sorted(highlightedCells(containerEl, "green"))).toEqual(
				sorted(expectedVistaMask(greenSpatial.position)),
			);

			btnFor("red").click();
			expect(activeFocusButtons()).toEqual(["red"]);
			expect(highlightedCells(containerEl, "green").size).toBe(0);
		});

		it("repeat click clears tint, focus attributes and every button", () => {
			const root = document.body;
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderInspector(root, { session });
			renderWorldMap(containerEl, session);

			const redBtn = document
				.querySelector('.ai-panel[data-ai="red"]')
				?.querySelector('[data-field="focus-vista"]') as HTMLButtonElement;
			expect(redBtn).toBeTruthy();

			redBtn.click();
			expect(focusedCellIds(containerEl).length).toBeGreaterThan(0);
			expect(activeFocusButtons()).toEqual(["red"]);

			redBtn.click();

			expect(focusedCellIds(containerEl)).toEqual([]);
			expect(activeFocusButtons()).toEqual([]);
			for (const btn of document.querySelectorAll<HTMLElement>(
				'[data-field="focus-vista"]',
			)) {
				expect(btn.getAttribute("data-focus-active")).toBe("false");
			}
			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				expect(cell.style.backgroundColor).toBe("");
			}
		});

		it("clicking another Daemon's control switches focus", () => {
			const root = document.body;
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderInspector(root, { session });
			renderWorldMap(containerEl, session);

			const redBtn = document
				.querySelector('.ai-panel[data-ai="red"]')
				?.querySelector('[data-field="focus-vista"]') as HTMLButtonElement;
			const greenBtn = document
				.querySelector('.ai-panel[data-ai="green"]')
				?.querySelector('[data-field="focus-vista"]') as HTMLButtonElement;
			expect(redBtn).toBeTruthy();
			expect(greenBtn).toBeTruthy();

			redBtn.click();
			expect(getMapFocus()).toBe("red");
			expect(highlightedCells(containerEl, "red").size).toBeGreaterThan(0);

			greenBtn.click();
			expect(getMapFocus()).toBe("green");
			expect(highlightedCells(containerEl, "red").size).toBe(0);
			expect(highlightedCells(containerEl, "green").size).toBeGreaterThan(0);
		});

		it("data-focus-active reflects focus state", () => {
			const root = document.body;
			renderInspector(root, { session });

			const allBtns = document.querySelectorAll(
				'[data-field="focus-vista"]',
			) as NodeListOf<HTMLElement>;
			expect(allBtns.length).toBeGreaterThanOrEqual(3);

			let redBtn: HTMLElement | null = null;
			let greenBtn: HTMLElement | null = null;

			for (const btn of allBtns) {
				const panel = btn.closest(".ai-panel") as HTMLElement;
				const aiId = panel?.getAttribute("data-ai");
				if (aiId === "red") redBtn = btn;
				if (aiId === "green") greenBtn = btn;
			}

			expect(redBtn).toBeTruthy();
			expect(greenBtn).toBeTruthy();

			setMapFocus("red");
			expect(redBtn?.getAttribute("data-focus-active")).toBe("true");
			expect(greenBtn?.getAttribute("data-focus-active")).toBe("false");

			setMapFocus("green");
			expect(redBtn?.getAttribute("data-focus-active")).toBe("false");
			expect(greenBtn?.getAttribute("data-focus-active")).toBe("true");
		});
	});

	describe("Escape key handling", () => {
		it("Escape clears tint, focus attributes and every button", () => {
			const root = document.body;
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderInspector(root, { session });
			renderWorldMap(containerEl, session);

			setMapFocus("red");
			expect(focusedCellIds(containerEl).length).toBeGreaterThan(0);
			expect(activeFocusButtons()).toEqual(["red"]);

			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);

			expect(containerEl.querySelectorAll("[data-vista-focus]").length).toBe(0);
			expect(focusedCellIds(containerEl)).toEqual([]);
			expect(activeFocusButtons()).toEqual([]);
			for (const btn of document.querySelectorAll<HTMLElement>(
				'[data-field="focus-vista"]',
			)) {
				expect(btn.getAttribute("data-focus-active")).toBe("false");
			}
			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				expect(cell.style.backgroundColor).toBe("");
			}
		});

		it("Escape clears active focus", () => {
			const root = document.body;
			renderInspector(root, { session });

			setMapFocus("red");
			expect(getMapFocus()).toBe("red");

			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			expect(getMapFocus()).toBeNull();
		});

		it("Escape clears tint when focus is active", () => {
			const root = document.body;
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderInspector(root, { session });
			renderWorldMap(containerEl, session);

			setMapFocus("red");

			expect(highlightedCells(containerEl, "red").size).toBeGreaterThan(0);

			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			expect(containerEl.querySelectorAll("[data-vista-focus]").length).toBe(0);
		});

		it("Escape no-op when no focus is active", () => {
			const root = document.body;
			renderInspector(root, { session });

			expect(getMapFocus()).toBeNull();

			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			expect(getMapFocus()).toBeNull();
		});

		it("Escape listener attached only once", () => {
			const root = document.body;

			renderInspector(root, { session });

			__resetInspectorForTests();
			renderInspector(root, { session });

			setMapFocus("red");
			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			expect(getMapFocus()).toBeNull();
		});

		it("other keys do not clear focus", () => {
			const root = document.body;
			renderInspector(root, { session });

			setMapFocus("red");
			expect(getMapFocus()).toBe("red");

			const enterEvent = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
			});
			document.dispatchEvent(enterEvent);

			expect(getMapFocus()).toBe("red");
		});
	});
});
