import { expect, type Page, test } from "@playwright/test";
import {
	expectNoPageErrors,
	type GridPosition,
	goToGame,
	inRoom,
	type VistaCell,
	vistaCells,
} from "./helpers";

const ROOM_ROWS = 5;
const ROOM_COLS = 5;

const ALL_CELLS: string[] = Array.from(
	{ length: ROOM_ROWS * ROOM_COLS },
	(_, i) => `${Math.floor(i / ROOM_COLS)},${i % ROOM_COLS}`,
);

const SUBPIXEL_TOLERANCE_PX = 1;

const ROOM_CENTRE: GridPosition = { row: 2, col: 2 };

const FULL_VISTA_CELL_COUNT = 13;

const FOCUS_TINT_ALPHA = "0.25";

const ARROW_OR_CARET_GLYPHS = /[<^>↑↓←→↖↗↘↙]/;

const DIRECTION_OR_MOVEMENT_WORDS =
	/\b(north|south|east|west|ahead|behind|left|right|facing|moved)\b/i;

const DIRECTION_ATTRIBUTE_NAMES = /direction|facing|last-move|compass/;

async function liftMobileBannerRowHide(page: Page): Promise<void> {
	await page.evaluate(() => {
		const row = document.querySelector<HTMLElement>("#banner-row");
		if (row) row.style.display = "block";
	});
}

function expectedHighlight(position: GridPosition): Set<string> {
	const inBounds = vistaCells(position).filter(
		(cell: VistaCell) => !cell.isWall && inRoom(cell.position),
	);
	return new Set(
		inBounds.map((cell) => `${cell.position.row},${cell.position.col}`),
	);
}

function parseCell(dataCell: string): GridPosition {
	const [rowStr, colStr] = dataCell.split(",");
	const row = Number(rowStr);
	const col = Number(colStr);
	if (Number.isNaN(row) || Number.isNaN(col)) {
		throw new Error(`e2e: malformed data-cell "${dataCell}"`);
	}
	return { row, col };
}

async function readBoard(page: Parameters<typeof goToGame>[0]) {
	return page.evaluate(() => {
		const container = document.querySelector<HTMLElement>("#dev-world-map");
		const grid = container?.querySelector<HTMLElement>(".dev-map-grid");
		const cells = Array.from(
			container?.querySelectorAll<HTMLElement>(".dev-map-cell") ?? [],
		);
		return {
			hasContainer: container !== null,
			declaredRows: grid?.getAttribute("data-rows") ?? null,
			declaredCols: grid?.getAttribute("data-cols") ?? null,
			cells: cells.map((cell) => ({
				dataCell: cell.getAttribute("data-cell") ?? "",
				dataKind: cell.getAttribute("data-kind") ?? "",
				dataAi: cell.getAttribute("data-ai"),
				glyph: cell.querySelector(".dev-map-glyph")?.textContent ?? "",
				tooltip: cell.querySelector(".dev-map-tooltip")?.textContent ?? "",
				text: cell.textContent ?? "",
				color: cell.style.color,
				backgroundColor: cell.style.backgroundColor,
				vistaFocus: cell.getAttribute("data-vista-focus"),
				attributeNames: cell.getAttributeNames(),
			})),
			text: container?.textContent ?? "",
		};
	});
}

async function readDaemonCells(
	page: Parameters<typeof goToGame>[0],
): Promise<Map<string, { position: GridPosition; dataCell: string }>> {
	const cells = await page.evaluate(() =>
		Array.from(
			document.querySelectorAll<HTMLElement>(
				"#dev-world-map .dev-map-cell[data-ai]",
			),
		).map((cell) => ({
			aiId: cell.getAttribute("data-ai") ?? "",
			dataCell: cell.getAttribute("data-cell") ?? "",
		})),
	);
	return new Map(
		cells.map((cell) => [
			cell.aiId,
			{ position: parseCell(cell.dataCell), dataCell: cell.dataCell },
		]),
	);
}

async function highlightedCells(
	page: Parameters<typeof goToGame>[0],
	aiId: string,
): Promise<string[]> {
	return page.evaluate((id) => {
		return Array.from(
			document.querySelectorAll<HTMLElement>(
				"#dev-world-map .dev-map-cell[data-vista-focus]",
			),
		)
			.filter((cell) => cell.getAttribute("data-vista-focus") === id)
			.map((cell) => cell.getAttribute("data-cell") ?? "");
	}, aiId);
}

async function activeFocusPanels(
	page: Parameters<typeof goToGame>[0],
): Promise<string[]> {
	return page.evaluate(() =>
		Array.from(
			document.querySelectorAll<HTMLElement>('[data-field="focus-vista"]'),
		)
			.filter((btn) => btn.getAttribute("data-focus-active") === "true")
			.map(
				(btn) =>
					btn.closest<HTMLElement>(".ai-panel")?.getAttribute("data-ai") ??
					"(unknown)",
			),
	);
}

async function clickFocus(
	page: Parameters<typeof goToGame>[0],
	aiId: string,
): Promise<void> {
	await page
		.locator(`.ai-panel[data-ai="${aiId}"] [data-field="focus-vista"]`)
		.click();
}

test.describe("dev inspector world map", () => {
	test("board renders the room-only 5×5 grid with no wall cells", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		await expect(page.locator("#dev-world-map")).toBeVisible();

		const board = await readBoard(page);
		expect(board.hasContainer).toBe(true);
		expect(board.declaredRows).toBe(String(ROOM_ROWS));
		expect(board.declaredCols).toBe(String(ROOM_COLS));

		expect(board.cells).toHaveLength(ROOM_ROWS * ROOM_COLS);
		const coordinates = board.cells.map((cell) => cell.dataCell);
		expect(new Set(coordinates).size).toBe(ROOM_ROWS * ROOM_COLS);
		expect([...coordinates].sort()).toEqual([...ALL_CELLS].sort());

		const inspectorText = await page
			.locator("#dev-world-map")
			.evaluate((el) => el.textContent ?? "");
		expect(inspectorText).not.toMatch(/wall/i);
		expect(inspectorText).not.toContain("out of bounds");
		for (const cell of board.cells) {
			expect(cell.dataKind).not.toBe("wall");
		}

		await expectNoPageErrors(page, pageErrors);
	});

	test("board lays out as five rows of five, not a wrapped narrow grid", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });
		await expect(page.locator("#dev-world-map")).toBeVisible();

		const layout = await page.evaluate(() => {
			const container = document.querySelector<HTMLElement>("#dev-world-map");
			const cells = Array.from(
				container?.querySelectorAll<HTMLElement>(".dev-map-cell") ?? [],
			);
			const rows = new Map<number, Set<number>>();
			const columns = new Map<number, Set<number>>();
			for (const cell of cells) {
				const [rowStr, colStr] = (cell.getAttribute("data-cell") ?? "").split(
					",",
				);
				const rect = cell.getBoundingClientRect();
				const top = Math.round(rect.top);
				const left = Math.round(rect.left);
				if (!rows.has(top)) rows.set(top, new Set());
				if (!columns.has(left)) columns.set(left, new Set());
				rows.get(top)?.add(Number(rowStr));
				columns.get(left)?.add(Number(colStr));
			}
			return {
				distinctTops: rows.size,
				distinctLefts: columns.size,
				rowLabelCounts: [...rows.values()].map((labels) => labels.size),
				columnLabelCounts: [...columns.values()].map((labels) => labels.size),
			};
		});

		expect(layout.distinctTops).toBe(ROOM_ROWS);
		expect(layout.distinctLefts).toBe(ROOM_COLS);
		expect(layout.rowLabelCounts).toEqual([1, 1, 1, 1, 1]);
		expect(layout.columnLabelCounts).toEqual([1, 1, 1, 1, 1]);

		await expectNoPageErrors(page, pageErrors);
	});

	test("daemon markers carry identity only — no direction or movement marker", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		const board = await readBoard(page);
		const daemonCells = board.cells.filter((cell) => cell.dataAi !== null);
		expect(daemonCells).toHaveLength(3);

		const colors = new Set(daemonCells.map((cell) => cell.color));

		for (const cell of daemonCells) {
			expect(cell.glyph).toBe("@ ");

			const tooltipShape = /^\*([a-z0-9]+) — holds: (.+)$/.exec(cell.tooltip);
			expect(tooltipShape).not.toBeNull();
			expect(cell.tooltip).toMatch(/(\(\S+\)|nothing)$/);

			expect(cell.text).toBe(`@ ${cell.tooltip}`);

			expect(cell.color).not.toBe("");
			expect(cell.color).toMatch(/^rgb/);

			const tooltipWithoutHandle = tooltipShape?.[2] ?? cell.tooltip;
			expect(cell.glyph).not.toMatch(ARROW_OR_CARET_GLYPHS);
			expect(tooltipWithoutHandle).not.toMatch(ARROW_OR_CARET_GLYPHS);
			expect(tooltipWithoutHandle).not.toMatch(DIRECTION_OR_MOVEMENT_WORDS);
			for (const attr of cell.attributeNames) {
				expect(attr).not.toMatch(DIRECTION_ATTRIBUTE_NAMES);
			}
		}
		expect(colors.size).toBe(3);

		await expectNoPageErrors(page, pageErrors);
	});

	test("focus highlights the in-bounds Vista, leaving the marker intact", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		const daemons = await readDaemonCells(page);
		const aiId = [...daemons.keys()][0];
		if (aiId === undefined) throw new Error("e2e: no Daemon cell rendered");
		const { position, dataCell } = daemons.get(aiId) as {
			position: GridPosition;
			dataCell: string;
		};
		const expected = expectedHighlight(position);

		await clickFocus(page, aiId);
		await expect(page.locator('[data-field="focus-vista"]')).toHaveCount(3);
		await expect(
			page.locator(`.ai-panel[data-ai="${aiId}"] [data-field="focus-vista"]`),
		).toHaveAttribute("data-focus-active", "true");

		const highlighted = await highlightedCells(page, aiId);
		expect([...highlighted].sort()).toEqual([...expected].sort());
		expect(highlighted).toContain(dataCell);

		const tinted = await page.evaluate(
			(tintAlpha) =>
				Array.from(
					document.querySelectorAll<HTMLElement>(
						"#dev-world-map .dev-map-cell[data-vista-focus]",
					),
				).map((cell) => ({
					owner: cell.getAttribute("data-vista-focus"),
					background: cell.style.backgroundColor,
					hasFocusTintAlpha: cell.style.backgroundColor.includes(tintAlpha),
				})),
			FOCUS_TINT_ALPHA,
		);
		expect(tinted).toHaveLength(expected.size);
		for (const cell of tinted) {
			expect(cell.owner).toBe(aiId);
			expect(cell.background).not.toBe("");
			expect(cell.hasFocusTintAlpha).toBe(true);
		}

		const owner = await page.evaluate((id) => {
			const cell = document.querySelector<HTMLElement>(
				`#dev-world-map .dev-map-cell[data-ai="${id}"]`,
			);
			return {
				glyph: cell?.querySelector(".dev-map-glyph")?.textContent ?? "",
				tooltip: cell?.querySelector(".dev-map-tooltip")?.textContent ?? "",
				color: cell?.style.color ?? "",
				dataAi: cell?.getAttribute("data-ai") ?? "",
			};
		}, aiId);
		expect(owner.dataAi).toBe(aiId);
		expect(owner.glyph).toBe("@ ");
		expect(owner.tooltip).toMatch(/^\*[A-Za-z0-9]+ — holds: .+$/);
		expect(owner.color).toMatch(/^rgb/);

		await expectNoPageErrors(page, pageErrors);
	});

	test("switching focus moves the tint; repeat-click and Escape both clear it", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		const daemons = await readDaemonCells(page);
		const ids = [...daemons.keys()];
		const first = ids[0];
		const second = ids[1];
		if (first === undefined || second === undefined) {
			throw new Error("e2e: need two Daemon cells to switch focus");
		}

		await clickFocus(page, first);
		expect(await activeFocusPanels(page)).toEqual([first]);
		const firstHighlight = await highlightedCells(page, first);
		expect(firstHighlight.length).toBeGreaterThan(0);

		await clickFocus(page, second);
		expect(await activeFocusPanels(page)).toEqual([second]);
		expect(await highlightedCells(page, first)).toEqual([]);
		const secondHighlight = await highlightedCells(page, second);
		expect([...secondHighlight].sort()).toEqual(
			[
				...expectedHighlight(
					(daemons.get(second) as { position: GridPosition }).position,
				),
			].sort(),
		);
		const staleOwners = await page.evaluate(
			(id) =>
				Array.from(
					document.querySelectorAll<HTMLElement>(
						"#dev-world-map .dev-map-cell[data-vista-focus]",
					),
				).filter((cell) => cell.getAttribute("data-vista-focus") === id).length,
			first,
		);
		expect(staleOwners).toBe(0);

		await clickFocus(page, second);
		expect(await activeFocusPanels(page)).toEqual([]);
		expect(await highlightedCells(page, second)).toEqual([]);
		const anyTint = await page.evaluate(
			() =>
				Array.from(
					document.querySelectorAll<HTMLElement>(
						"#dev-world-map .dev-map-cell[data-vista-focus]",
					),
				).length,
		);
		expect(anyTint).toBe(0);

		await clickFocus(page, first);
		expect(await activeFocusPanels(page)).toEqual([first]);
		await page.locator("#composer").click();
		await page.keyboard.press("Escape");
		await expect
			.poll(async () => (await activeFocusPanels(page)).length, {
				timeout: 5_000,
			})
			.toBe(0);
		expect(await highlightedCells(page, first)).toEqual([]);

		await expectNoPageErrors(page, pageErrors);
	});

	test("boundary Daemons highlight fewer cells than a centred one, all in room", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		const daemons = await readDaemonCells(page);
		const entries = [...daemons.entries()];
		expect(entries.length).toBeGreaterThan(0);

		const counts = new Map<string, number>();
		for (const [aiId, { position }] of entries) {
			await clickFocus(page, aiId);
			const highlighted = await highlightedCells(page, aiId);
			const expected = expectedHighlight(position);
			expect([...highlighted].sort()).toEqual([...expected].sort());
			counts.set(aiId, highlighted.length);

			for (const dataCell of highlighted) {
				const { row, col } = parseCell(dataCell);
				expect(row).toBeGreaterThanOrEqual(0);
				expect(row).toBeLessThanOrEqual(ROOM_ROWS - 1);
				expect(col).toBeGreaterThanOrEqual(0);
				expect(col).toBeLessThanOrEqual(ROOM_COLS - 1);
			}
			await clickFocus(page, aiId);
		}

		const centreCount = expectedHighlight(ROOM_CENTRE).size;
		expect(centreCount).toBe(FULL_VISTA_CELL_COUNT);

		const edgeRows = new Set([0, ROOM_ROWS - 1]);
		const edgeCols = new Set([0, ROOM_COLS - 1]);
		const isEdge = (position: GridPosition): boolean =>
			edgeRows.has(position.row) || edgeCols.has(position.col);

		for (const [aiId, { position }] of entries) {
			if (!isEdge(position)) continue;
			const count = counts.get(aiId) ?? 0;
			expect(expectedHighlight(position).size).toBeLessThan(centreCount);
			expect(count).toBeLessThan(centreCount);
			expect(count).toBeGreaterThan(0);
		}

		for (let row = 0; row < ROOM_ROWS; row++) {
			for (let col = 0; col < ROOM_COLS; col++) {
				const size = expectedHighlight({ row, col }).size;
				expect(size).toBeGreaterThan(0);
				expect(size).toBeLessThanOrEqual(centreCount);
				if (row === ROOM_CENTRE.row && col === ROOM_CENTRE.col) {
					expect(size).toBe(centreCount);
				} else {
					expect(size).toBeLessThan(centreCount);
				}
			}
		}

		for (const [aiId, { position }] of entries) {
			const size = expectedHighlight(position).size;
			expect(counts.get(aiId)).toBe(size);
			if (
				position.row === ROOM_CENTRE.row &&
				position.col === ROOM_CENTRE.col
			) {
				expect(size).toBe(centreCount);
			} else {
				expect(size).toBeLessThan(centreCount);
			}
		}

		await expectNoPageErrors(page, pageErrors);
	});
});

test.describe("dev inspector at 375×667", () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test("narrow viewport keeps the board rendered without horizontal overflow", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		await expect(page.locator("#dev-world-map")).toBeAttached();
		await expect(page.locator("#banner-row")).toBeHidden();
		await expect(page.locator("#dev-world-map")).toHaveClass(/dev-map/);

		const probe = await page.evaluate(() => {
			const container = document.querySelector<HTMLElement>("#dev-world-map");
			const grid = container?.querySelector<HTMLElement>(".dev-map-grid");
			const gridRect = grid?.getBoundingClientRect();
			const containerRect = container?.getBoundingClientRect();
			return {
				cellCount: container?.querySelectorAll(".dev-map-cell").length ?? 0,
				gridRectWidth: gridRect?.width ?? -1,
				gridLeft: gridRect?.left ?? -1,
				gridRight: gridRect?.right ?? -1,
				containerLeft: containerRect?.left ?? -1,
				containerRight: containerRect?.right ?? -1,
				containerScrollWidth: container?.scrollWidth ?? 0,
				containerClientWidth: container?.clientWidth ?? 0,
				bodyScrollWidth: document.body.scrollWidth,
				bodyClientWidth: document.body.clientWidth,
				viewportWidth: window.innerWidth,
			};
		});

		expect(probe.cellCount).toBe(ROOM_ROWS * ROOM_COLS);
		expect(probe.viewportWidth).toBe(375);

		expect(probe.gridRectWidth).toBeLessThanOrEqual(
			probe.bodyClientWidth + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.gridRight).toBeLessThanOrEqual(
			probe.containerRight + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.gridLeft).toBeGreaterThanOrEqual(
			probe.containerLeft - SUBPIXEL_TOLERANCE_PX,
		);

		expect(probe.containerScrollWidth).toBeLessThanOrEqual(
			probe.containerClientWidth + SUBPIXEL_TOLERANCE_PX,
		);

		await expectNoPageErrors(page, pageErrors);
	});

	test("board renders and the grid does not overflow when the media query is lifted", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });
		await expect(page.locator("#dev-world-map")).toBeAttached();

		await liftMobileBannerRowHide(page);
		await expect(page.locator("#dev-world-map")).toBeVisible();

		const probe = await page.evaluate(() => {
			const container = document.querySelector<HTMLElement>("#dev-world-map");
			const grid = container?.querySelector<HTMLElement>(".dev-map-grid");
			const gridRect = grid?.getBoundingClientRect();
			const containerRect = container?.getBoundingClientRect();
			return {
				cellCount: container?.querySelectorAll(".dev-map-cell").length ?? 0,
				scrollWidth: container?.scrollWidth ?? 0,
				clientWidth: container?.clientWidth ?? 0,
				gridRectWidth: gridRect?.width ?? -1,
				gridLeft: gridRect?.left ?? -1,
				gridRight: gridRect?.right ?? -1,
				containerLeft: containerRect?.left ?? -1,
				containerRight: containerRect?.right ?? -1,
			};
		});

		expect(probe.cellCount).toBe(ROOM_ROWS * ROOM_COLS);
		expect(probe.gridRectWidth).toBeGreaterThan(0);

		expect(probe.gridRight).toBeLessThanOrEqual(
			probe.containerRight + SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.gridLeft).toBeGreaterThanOrEqual(
			probe.containerLeft - SUBPIXEL_TOLERANCE_PX,
		);
		expect(probe.scrollWidth).toBeLessThanOrEqual(
			probe.clientWidth + SUBPIXEL_TOLERANCE_PX,
		);

		await expectNoPageErrors(page, pageErrors);
	});
});
