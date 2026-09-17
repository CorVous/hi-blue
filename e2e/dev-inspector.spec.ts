/**
 * E2E — dev inspector world map (ticket #540, ADR 0015).
 *
 * The inspector is a dev-build-only affordance, and Playwright's webServer runs
 * `wrangler dev --local` with the default `WORKER_BASE_URL`, so `__DEV__` is
 * true and `#dev-world-map` renders in e2e. Nothing else in `e2e/` touches it:
 * these specs are the only coverage of the real inspector DOM in a real
 * browser, as opposed to the jsdom unit tests under
 * `src/spa/dev-inspector/__tests__/`.
 *
 * The map is a room-only 5×5 board: 25 cells, no wall ring, and no
 * out-of-bounds cells (the Walls a Daemon perceives have no display cell).
 * Daemon markers carry identity only — colour, `data-ai`, and a `*name`
 * tooltip — with no direction arrow, compass letter, or movement marker.
 *
 * Expected highlights are derived from the e2e tree's own copy of the ADR 0015
 * geometry (`vistaCells`), clipped to the room, and the observed Daemon
 * position is read back from the rendered DOM: a Daemon's cell `data-cell` IS
 * its room position, so no spawn is assumed.
 */
import { expect, test } from "@playwright/test";
import {
	expectNoPageErrors,
	type GridPosition,
	goToGame,
	inRoom,
	type VistaCell,
	vistaCells,
} from "./helpers";

/** The room is 5×5 (matches `data-rows` / `data-cols` on `.dev-map-grid`). */
const ROOM_ROWS = 5;
const ROOM_COLS = 5;

/** Every "r,c" coordinate of the room, in row-major order. */
const ALL_CELLS: string[] = Array.from(
	{ length: ROOM_ROWS * ROOM_COLS },
	(_, i) => `${Math.floor(i / ROOM_COLS)},${i % ROOM_COLS}`,
);

/**
 * The expected in-bounds highlight for a Daemon at `position`.
 *
 * Built from the shared Vista oracle (`vistaCells`, the e2e copy of
 * `projectVista`) rather than a hand-rolled disk: the inspector clips the
 * 13-cell Vista to the 5×5 room, so out-of-bounds (`isWall`) cells — which
 * have no display cell — are dropped.
 */
function expectedHighlight(position: GridPosition): Set<string> {
	const inBounds = vistaCells(position).filter(
		(cell: VistaCell) => !cell.isWall && inRoom(cell.position),
	);
	return new Set(
		inBounds.map((cell) => `${cell.position.row},${cell.position.col}`),
	);
}

/** Parse a rendered `data-cell` coordinate, failing loudly if it is malformed. */
function parseCell(dataCell: string): GridPosition {
	const [rowStr, colStr] = dataCell.split(",");
	const row = Number(rowStr);
	const col = Number(colStr);
	if (Number.isNaN(row) || Number.isNaN(col)) {
		throw new Error(`e2e: malformed data-cell "${dataCell}"`);
	}
	return { row, col };
}

/**
 * Read the board's shape straight out of the document: the grid's declared
 * dimensions, every cell coordinate in DOM order, and the whole inspector's
 * text (used for the absence checks).
 */
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

/** The board cell each Daemon currently occupies, keyed by `data-ai`. */
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

/** The `data-cell` coordinates currently tinted for `aiId`. */
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

/**
 * The panel `data-ai` values whose focus-vista button is currently active.
 * `null` means no button carries `data-focus-active="true"`.
 */
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

/** Click the focus-vista control inside the panel for `aiId`. */
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

		// The container is un-hidden once a session renders.
		await expect(page.locator("#dev-world-map")).toBeVisible();

		const board = await readBoard(page);
		expect(board.hasContainer).toBe(true);
		expect(board.declaredRows).toBe(String(ROOM_ROWS));
		expect(board.declaredCols).toBe(String(ROOM_COLS));

		// Exactly 25 cells carrying the 25 distinct room coordinates.
		expect(board.cells).toHaveLength(ROOM_ROWS * ROOM_COLS);
		const coordinates = board.cells.map((cell) => cell.dataCell);
		expect(new Set(coordinates).size).toBe(ROOM_ROWS * ROOM_COLS);
		expect([...coordinates].sort()).toEqual([...ALL_CELLS].sort());

		// Room-only: no wall cells and no out-of-bounds wording anywhere.
		// (The container also covers the grid, so this sweeps the whole board.)
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

		// `data-rows`/`data-cols` come from the renderer, so they would still
		// read 5 even if the CSS flowed the 25 cells into a different number of
		// columns — the ticket's display regression. Assert the geometry the
		// browser actually produced: cells sharing a `data-cell` row must share
		// a top edge, and there must be exactly five distinct rows and columns.
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

		// Five visual rows holds exactly one `data-cell` row label each, and
		// likewise for columns: a 7-column template would put all 25 cells on
		// only four visual rows, with the last holding four columns.
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

		// Identity colours must be distinct: colour is part of what identifies a
		// Daemon now that the marker carries no direction.
		const colors = new Set(daemonCells.map((cell) => cell.color));

		for (const cell of daemonCells) {
			// Uniform, direction-independent glyph for every Daemon.
			expect(cell.glyph).toBe("@ ");

			// Exact tooltip: `*<Name> — holds: <item> (<id>)` or `… nothing`.
			const tooltipShape = /^\*([a-z0-9]+) — holds: (.+)$/.exec(cell.tooltip);
			expect(tooltipShape).not.toBeNull();
			expect(cell.tooltip).toMatch(/(\(\S+\)|nothing)$/);

			// The marker's entire observable surface is glyph + tooltip: the
			// whole cell is `@ ` plus the tooltip, in either order-free shape.
			expect(cell.text).toBe(`@ ${cell.tooltip}`);

			// A non-empty identity colour (browsers normalise hex to rgb(...)).
			expect(cell.color).not.toBe("");
			expect(cell.color).toMatch(/^rgb/);

			// No arrow, compass letter, or movement marker — in text or in
			// attributes. Persona handles are 4-char [a-z0-9] strings, so a
			// handle may itself be `east`/`west`/`left` or contain `v`: the
			// direction checks therefore run against the tooltip's fixed
			// scaffolding (everything but the free-form handle) and the glyph
			// span, never against the handle text.
			const scaffolding = tooltipShape?.[2] ?? cell.tooltip;
			expect(cell.glyph).not.toMatch(/[<^>↑↓←→↖↗↘↙]/);
			expect(scaffolding).not.toMatch(/[<^>↑↓←→↖↗↘↙]/);
			expect(scaffolding).not.toMatch(
				/\b(north|south|east|west|ahead|behind|left|right|facing|moved)\b/i,
			);
			for (const attr of cell.attributeNames) {
				expect(attr).not.toMatch(/direction|facing|last-move|compass/);
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

		// The highlighted set is exactly the in-bounds disk for the position the
		// Daemon actually occupies.
		const highlighted = await highlightedCells(page, aiId);
		expect([...highlighted].sort()).toEqual([...expected].sort());
		expect(highlighted).toContain(dataCell);

		// Every tinted cell names exactly this Daemon and is actually tinted.
		const tinted = await page.evaluate(() =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					"#dev-world-map .dev-map-cell[data-vista-focus]",
				),
			).map((cell) => ({
				owner: cell.getAttribute("data-vista-focus"),
				background: cell.style.backgroundColor,
				alpha: cell.style.backgroundColor.includes("0.25"),
			})),
		);
		expect(tinted).toHaveLength(expected.size);
		for (const cell of tinted) {
			expect(cell.owner).toBe(aiId);
			expect(cell.background).not.toBe("");
			expect(cell.alpha).toBe(true);
		}

		// The focused Daemon's own identity marker and colour survive the tint:
		// the tint is a background, identity is the foreground colour.
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

		// Focus the first Daemon.
		await clickFocus(page, first);
		expect(await activeFocusPanels(page)).toEqual([first]);
		const firstHighlight = await highlightedCells(page, first);
		expect(firstHighlight.length).toBeGreaterThan(0);

		// Focus a different Daemon: exactly one active control, and no cell
		// still names the previous owner.
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

		// Repeat-click the already-focused control: focus clears to zero.
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

		// Focus again, then Escape anywhere clears it.
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

		// Every Daemon highlights exactly the in-bounds disk for its rendered
		// position, and every highlighted coordinate lies inside 0..4 × 0..4.
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

		// The clip is real: a centred Daemon keeps the full 13-cell disk.
		const centreCount = expectedHighlight({ row: 2, col: 2 }).size;
		expect(centreCount).toBe(13);

		// Edge proximity is read from the rendered position, not assumed from a
		// spawn: spawns are drawn at random from the 25 cells, so a run need not
		// contain an edge Daemon. The relation is therefore asserted two ways —
		// against whatever the draw produced below, and exhaustively over the
		// room from the shared oracle in the loop that follows.
		const edgeRows = new Set([0, ROOM_ROWS - 1]);
		const edgeCols = new Set([0, ROOM_COLS - 1]);
		const isEdge = (position: GridPosition): boolean =>
			edgeRows.has(position.row) || edgeCols.has(position.col);

		for (const [aiId, { position }] of entries) {
			if (!isEdge(position)) continue;
			const count = counts.get(aiId) ?? 0;
			// The clip is geometric, not incidental: fewer in-bounds cells.
			expect(expectedHighlight(position).size).toBeLessThan(centreCount);
			expect(count).toBeLessThan(centreCount);
			expect(count).toBeGreaterThan(0);
		}

		// Independently of the draw, the relation itself holds for every room
		// position: it is checked exhaustively from the shared oracle rather than
		// left to whether a Daemon happened to spawn on an edge. Only the exact
		// centre (2,2) keeps the whole 13-cell disk — every other cell, edge or
		// merely off-centre, is clipped strictly below 13 by the 5×5 room.
		const centre: GridPosition = { row: 2, col: 2 };
		for (let row = 0; row < ROOM_ROWS; row++) {
			for (let col = 0; col < ROOM_COLS; col++) {
				const size = expectedHighlight({ row, col }).size;
				expect(size).toBeGreaterThan(0);
				expect(size).toBeLessThanOrEqual(centreCount);
				if (row === centre.row && col === centre.col) {
					expect(size).toBe(centreCount);
				} else {
					expect(size).toBeLessThan(centreCount);
				}
			}
		}

		// And each Daemon's rendered highlight matches that geometry for its own
		// rendered cell.
		for (const [aiId, { position }] of entries) {
			const size = expectedHighlight(position).size;
			expect(counts.get(aiId)).toBe(size);
			if (position.row === centre.row && position.col === centre.col) {
				expect(size).toBe(centreCount);
			} else {
				expect(size).toBeLessThan(centreCount);
			}
		}

		await expectNoPageErrors(page, pageErrors);
	});
});

/**
 * Narrow viewport, matching the repo's existing responsive idiom
 * (`responsive-bento.spec.ts` / `start-screen.spec.ts` use the same 375×667
 * phone viewport).
 *
 * At 375px the repo's own media query sets `#banner-row { display: none }` —
 * the inspector's container — so the board is deliberately off-screen on
 * phones. The regression this guards is therefore that the inspector still
 * *renders* coherently (25 cells, no horizontal overflow) rather than
 * collapsing to a stale or overflowing layout; the DOM stays attached and the
 * board is built even while its container is hidden.
 */
test.describe("dev inspector at 375×667", () => {
	test.use({ viewport: { width: 375, height: 667 } });

	test("narrow viewport keeps the board rendered without horizontal overflow", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });

		// Attached (not necessarily visible): the mobile breakpoint hides
		// `#banner-row`, the inspector's container.
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
				bodyScrollWidth: document.body.scrollWidth,
				bodyClientWidth: document.body.clientWidth,
				viewportWidth: window.innerWidth,
			};
		});

		// The board still renders every room cell at 375px wide.
		expect(probe.cellCount).toBe(ROOM_ROWS * ROOM_COLS);
		expect(probe.viewportWidth).toBe(375);

		// The grid does not overflow its container horizontally (1px tolerance
		// for sub-pixel rounding). While the container is hidden this is a
		// zero-vs-zero comparison, which is exactly the coherence claim: the
		// board neither overflows nor leaks width while hidden.
		expect(probe.gridRectWidth).toBeLessThanOrEqual(probe.bodyClientWidth + 1);
		expect(probe.gridRight).toBeLessThanOrEqual(probe.containerRight + 1);
		expect(probe.gridLeft).toBeGreaterThanOrEqual(probe.containerLeft - 1);

		// And the inspector contributes no page-level horizontal scroll.
		expect(probe.bodyScrollWidth).toBeLessThanOrEqual(probe.viewportWidth + 1);

		await expectNoPageErrors(page, pageErrors);
	});

	test("board renders and the grid does not overflow when the media query is lifted", async ({
		page,
	}) => {
		const pageErrors: Error[] = [];
		page.on("pageerror", (err) => pageErrors.push(err));

		await goToGame(page, { sse: ["hi"] });
		await expect(page.locator("#dev-world-map")).toBeAttached();

		// Lift the mobile `#banner-row { display: none }` rule so the inspector
		// is laid out at phone width, then measure the real box. This is the
		// layout regression: at 375px the 5×5 grid (5ch columns + 1ch gaps)
		// must still fit inside its container rather than overflowing it.
		await page.evaluate(() => {
			const row = document.querySelector<HTMLElement>("#banner-row");
			if (row) row.style.display = "block";
		});
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
				bodyScrollWidth: document.body.scrollWidth,
				viewportWidth: window.innerWidth,
			};
		});

		expect(probe.cellCount).toBe(ROOM_ROWS * ROOM_COLS);
		expect(probe.gridRectWidth).toBeGreaterThan(0);

		// The grid fits inside the container; the container itself does not
		// overflow horizontally.
		expect(probe.gridRight).toBeLessThanOrEqual(probe.containerRight + 1);
		expect(probe.gridLeft).toBeGreaterThanOrEqual(probe.containerLeft - 1);
		expect(probe.scrollWidth).toBeLessThanOrEqual(probe.clientWidth + 1);

		// No page-level horizontal scroll appears at phone width.
		expect(probe.bodyScrollWidth).toBeLessThanOrEqual(probe.viewportWidth + 1);

		await expectNoPageErrors(page, pageErrors);
	});
});
