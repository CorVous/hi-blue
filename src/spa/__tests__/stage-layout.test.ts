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
});
