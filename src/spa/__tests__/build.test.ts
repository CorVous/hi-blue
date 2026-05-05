/**
 * Verifies that src/spa/index.html uses sibling-relative asset paths.
 * Uses vitest's ?raw import to read the HTML file as a string without node:fs.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — vitest handles ?raw suffix; no TS type for it
import html from "../index.html?raw";

describe("src/spa/index.html asset references", () => {
	it('references CSS as sibling-relative path "./assets/index.css"', () => {
		expect(html as string).toContain("./assets/index.css");
	});

	it('references JS as sibling-relative path "./assets/index.js"', () => {
		expect(html as string).toContain("./assets/index.js");
	});

	it("references both assets", () => {
		expect(html as string).toContain("./assets/index.css");
		expect(html as string).toContain("./assets/index.js");
	});

	it("does not contain a <base href> element", () => {
		expect((html as string).toLowerCase()).not.toContain("<base");
	});

	it('script tag uses type="module"', () => {
		expect(html as string).toContain('type="module"');
	});

	it('contains cap-hit section with id="cap-hit"', () => {
		expect(html as string).toContain('id="cap-hit"');
	});

	it("cap-hit section has hidden attribute", () => {
		expect(html as string).toMatch(
			/id="cap-hit"[^>]*hidden|hidden[^>]*id="cap-hit"/,
		);
	});

	it('index.html contains a <dialog id="byok-dialog">', () => {
		expect(html as string).toContain('id="byok-dialog"');
	});

	it("index.html contains a cog button #byok-cog with the ⚙ glyph", () => {
		expect(html as string).toContain('id="byok-cog"');
		expect(html as string).toContain("⚙");
	});

	it('contains persistence-warning aside with id="persistence-warning"', () => {
		expect(html as string).toContain('id="persistence-warning"');
	});

	it("persistence-warning aside has hidden attribute", () => {
		expect(html as string).toMatch(
			/id="persistence-warning"[^>]*hidden|hidden[^>]*id="persistence-warning"/,
		);
	});
});
