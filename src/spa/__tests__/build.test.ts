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
});
