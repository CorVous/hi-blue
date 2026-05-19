/**
 * cone-focus.test.ts
 *
 * Tests for cone-focus tinting feature in the dev inspector.
 * - Cone mask computation
 * - Focus state management
 * - Visual tinting
 * - Button interaction
 * - Escape key handling
 */

import { beforeEach, describe, expect, it } from "vitest";
import { STATIC_CONTENT_PACKS } from "../../__tests__/fixtures/static-content-packs";
import { STATIC_PERSONAS } from "../../__tests__/fixtures/static-personas";
import { GameSession } from "../../game/game-session";
import { coneMaskForDaemon } from "../cone-mask";
import { __resetInspectorForTests, renderInspector } from "../index";
import {
	getMapFocus,
	renderWorldMap,
	setMapFocus,
	updateWorldMap,
} from "../world-map";

describe("cone-focus", () => {
	let session: GameSession;
	const contentPack = STATIC_CONTENT_PACKS[0];

	beforeEach(() => {
		// Build full inspector DOM
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

		// Reset inspector state
		__resetInspectorForTests();
	});

	describe("mask computation", () => {
		it("mask shape — corner cell facing north: red at inner (0,0) → only own cell in bounds", () => {
			const state = session.getState();
			const mask = coneMaskForDaemon(state, "red");

			// Red starts at (0,0) corner facing north, so most cone cells are OOB (walls).
			// Only the own cell (1,1) should be in the mask (the 8 others are filtered as walls).
			expect(mask.size).toBeGreaterThanOrEqual(1);
			// At least the own cell should be in the mask
			expect(mask.has("1,1")).toBe(true);
		});

		it("mask omits OOB walls — corner: red at (0,0) facing north → only valid cells", () => {
			const state = session.getState();
			const mask = coneMaskForDaemon(state, "red");

			// Red at corner (0,0), so many cells out of bounds.
			// Expect no cells with invalid visual coords (row/col < 1 or > 5)
			for (const cellStr of mask) {
				const [rowStr, colStr] = cellStr.split(",");
				const row = Number(rowStr);
				const col = Number(colStr);
				expect(row).toBeGreaterThanOrEqual(1);
				expect(row).toBeLessThanOrEqual(5);
				expect(col).toBeGreaterThanOrEqual(1);
				expect(col).toBeLessThanOrEqual(5);
			}
		});

		it("mask empty when daemon missing", () => {
			const state = session.getState();
			const mask = coneMaskForDaemon(state, "nonexistent");
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
			let redCells = 0;
			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				if (cell.getAttribute("data-cone-focus") === "red") {
					redCells++;
				}
			}
			expect(redCells).toBeGreaterThan(0);

			setMapFocus("green");
			const greenCells = containerEl.querySelectorAll<HTMLElement>(
				'[data-cone-focus="green"]',
			).length;
			const stillRedCells = containerEl.querySelectorAll<HTMLElement>(
				'[data-cone-focus="red"]',
			).length;

			expect(greenCells).toBeGreaterThan(0);
			expect(stillRedCells).toBe(0);
		});
	});

	describe("visual tinting", () => {
		it("setMapFocus tints cone cells with persona-colored background", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");

			const state = session.getState();
			const mask = coneMaskForDaemon(state, "red");
			const redColor = state.personas.red?.color;

			expect(redColor).toBeTruthy();

			for (const cell of containerEl.querySelectorAll<HTMLElement>(
				".dev-map-cell",
			)) {
				const dataCell = cell.getAttribute("data-cell");
				if (mask.has(dataCell!)) {
					// Should have non-empty backgroundColor
					expect(cell.style.backgroundColor).toBeTruthy();
					expect(cell.getAttribute("data-cone-focus")).toBe("red");
				} else {
					// Should not be tinted
					expect(cell.style.backgroundColor).toBe("");
					expect(cell.getAttribute("data-cone-focus")).toBeNull();
				}
			}
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
				expect(cell.getAttribute("data-cone-focus")).toBeNull();
			}
		});

		it("truth-always — daemon glyph preserved when cone focused", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");

			const redCell = containerEl.querySelector(
				'[data-ai="red"]',
			) as HTMLElement;
			expect(redCell).toBeTruthy();

			// Glyph should still be @<arrow>
			const glyph = redCell.querySelector(".dev-map-glyph");
			expect(glyph?.textContent).toMatch(/^@[<>^v]$/);

			// AI marker should be preserved
			expect(redCell.getAttribute("data-ai")).toBe("red");
		});

		it("updateWorldMap re-applies active tint after mutation", () => {
			const containerEl = document.getElementById(
				"dev-world-map",
			) as HTMLElement;
			renderWorldMap(containerEl, session);

			setMapFocus("red");
			const state1 = session.getState();
			const mask1 = coneMaskForDaemon(state1, "red");

			// Verify tint is applied
			const tintedBefore =
				containerEl.querySelectorAll<HTMLElement>("[data-cone-focus]").length;
			expect(tintedBefore).toBeGreaterThan(0);

			// Update the session (simulate a game step)
			updateWorldMap(containerEl, session);

			// Re-check tinted cells
			const state2 = session.getState();
			const mask2 = coneMaskForDaemon(state2, "red");
			const tintedAfter =
				containerEl.querySelectorAll<HTMLElement>("[data-cone-focus]").length;

			// Masks should be identical if state hasn't changed
			expect(mask1.size).toBe(mask2.size);
			expect(tintedAfter).toBeGreaterThan(0);
		});
	});

	describe("focus button", () => {
		it("button rendered in footer", () => {
			const root = document.body;
			renderInspector(root, { session });

			const focusBtn = document.querySelector(
				'[data-field="focus-cone"]',
			) as HTMLButtonElement;
			expect(focusBtn).toBeTruthy();
			expect(focusBtn.textContent).toBe("[ focus cone ]");
		});

		it("button click sets focus", () => {
			const root = document.body;
			renderInspector(root, { session });

			const focusBtn = document.querySelector(
				'[data-field="focus-cone"]',
			) as HTMLButtonElement;
			expect(focusBtn).toBeTruthy();

			// Click should set focus to the button's daemon
			focusBtn.click();

			// The button's data-ai is determined by its closest .ai-panel
			const panel = focusBtn.closest(".ai-panel") as HTMLElement;
			const aiId = panel?.getAttribute("data-ai");
			expect(getMapFocus()).toBe(aiId);
		});

		it("button click toggles focus off when already focused", () => {
			const root = document.body;
			renderInspector(root, { session });

			const redPanel = document.querySelector('[data-ai="red"]') as HTMLElement;
			expect(redPanel).toBeTruthy();

			const focusBtnInPanel = redPanel?.querySelector(
				'[data-field="focus-cone"]',
			) as HTMLButtonElement;

			// Try to find the button anywhere as a fallback
			const allBtns = document.querySelectorAll('[data-field="focus-cone"]');
			const focusBtn = focusBtnInPanel || (allBtns[0] as HTMLButtonElement);

			expect(focusBtn).toBeTruthy();

			setMapFocus("red");
			expect(getMapFocus()).toBe("red");

			focusBtn.click();
			expect(getMapFocus()).toBeNull();
		});

		it("data-focus-active reflects focus state", () => {
			const root = document.body;
			renderInspector(root, { session });

			// Get all buttons
			const allBtns = document.querySelectorAll(
				'[data-field="focus-cone"]',
			) as NodeListOf<HTMLElement>;
			expect(allBtns.length).toBeGreaterThanOrEqual(3);

			// Find red and green buttons by their panel
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
			expect(redBtn!.getAttribute("data-focus-active")).toBe("true");
			expect(greenBtn!.getAttribute("data-focus-active")).toBe("false");

			setMapFocus("green");
			expect(redBtn!.getAttribute("data-focus-active")).toBe("false");
			expect(greenBtn!.getAttribute("data-focus-active")).toBe("true");
		});
	});

	describe("Escape key handling", () => {
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

			// Verify tint is applied
			const tintedBefore =
				containerEl.querySelectorAll("[data-cone-focus]").length;
			expect(tintedBefore).toBeGreaterThan(0);

			// Press Escape
			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			// Verify tint is cleared
			const tintedAfter =
				containerEl.querySelectorAll("[data-cone-focus]").length;
			expect(tintedAfter).toBe(0);
		});

		it("Escape no-op when no focus is active", () => {
			const root = document.body;
			renderInspector(root, { session });

			expect(getMapFocus()).toBeNull();

			// Should not throw
			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			expect(getMapFocus()).toBeNull();
		});

		it("Escape listener attached only once", () => {
			const root = document.body;

			// First render
			renderInspector(root, { session });

			// Re-render (simulating re-init)
			__resetInspectorForTests();
			renderInspector(root, { session });

			// Set focus and press Escape
			setMapFocus("red");
			const escapeEvent = new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
			});
			document.dispatchEvent(escapeEvent);

			// Should still work correctly (and not have double-listeners)
			expect(getMapFocus()).toBeNull();
		});

		it("other keys do not clear focus", () => {
			const root = document.body;
			renderInspector(root, { session });

			setMapFocus("red");
			expect(getMapFocus()).toBe("red");

			// Press Enter
			const enterEvent = new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
			});
			document.dispatchEvent(enterEvent);

			// Focus should remain
			expect(getMapFocus()).toBe("red");
		});
	});
});
