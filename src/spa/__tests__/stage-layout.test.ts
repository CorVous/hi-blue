// @ts-expect-error — node:fs types not in tsconfig
import * as fs from "node:fs";
// @ts-expect-error — node:path types not in tsconfig
import * as path from "node:path";
// @ts-expect-error — node:url types not in tsconfig
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, "../styles.css");
const cssStr = fs.readFileSync(cssPath, "utf-8");

describe("#stage layout contract", () => {
	it("uses min-height: 100dvh (not height) so dev surfaces can grow the page", () => {
		expect(cssStr).toMatch(/#stage\s*\{[^}]*min-height:\s*100dvh/);
		// Negative lookahead ensures "height: 100dvh" doesn't appear (only "min-height" is ok)
		expect(cssStr).not.toMatch(/#stage\s*\{[^}]*\nheight:\s*100dvh/);
	});

	it("retains main { display: contents } so direct children flatten into #stage's grid", () => {
		expect(cssStr).toMatch(/^main\s*\{\s*display:\s*contents/m);
	});

	it("pins #panels to grid-row 5 (the 1fr row) so it always gets the stretchy slot", () => {
		// #phase-banner uses display:none when hidden, removing it from grid flow.
		// Without explicit placement, #panels lands on row 4 (auto) and #composer
		// takes row 5 (1fr), causing the game to overflow off the bottom of the screen.
		expect(cssStr).toMatch(/#panels\.row\s*\{[^}]*grid-row:\s*5/);
	});

	it("pins #composer to grid-row 6 (trailing auto row) to stay below panels", () => {
		expect(cssStr).toMatch(/#composer\s*\{[^}]*grid-row:\s*6/);
	});
});
