/**
 * Verifies that src/spa/index.html uses sibling-relative asset paths.
 * Uses vitest's ?raw import to read the HTML file as a string without node:fs.
 */
// @ts-expect-error — node types not available in SPA project

// @ts-expect-error — node types not available in SPA project
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";
// @ts-expect-error — vitest handles ?raw suffix; no TS type for it
import html from "../index.html?raw";

const __dirname_bt = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname_bt, "../../..");

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

	it("index.html contains a settings button #byok-cog labelled [ cfg ]", () => {
		expect(html as string).toContain('id="byok-cog"');
		expect(html as string).toContain("[ cfg ]");
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

describe("SPA prod bundle (__DEV__=false) tree-shakes the dev inspector", () => {
	it("does not contain renderInspector or dev-daemon-footer", async () => {
		const result = await esbuild.build({
			entryPoints: [path.join(repoRoot, "src/spa/main.ts")],
			bundle: true,
			write: false,
			outdir: path.join(repoRoot, "dist"),
			format: "esm",
			target: ["es2022"],
			minify: true,
			loader: { ".css": "css" },
			define: {
				__WORKER_BASE_URL__: JSON.stringify("https://example.com"),
				__COMMIT_SHA__: JSON.stringify("test"),
				__COMMIT_TIMESTAMP_MS__: "0",
				__VERSION__: JSON.stringify("0.0.0"),
				__RELEASE_VERSION__: "null",
				__LATEST_RELEASE_VERSION__: "null",
				__DEV__: "false",
			},
		});
		const js = result.outputFiles
			.filter((f) => f.path.endsWith(".js"))
			.map((f) => f.text)
			.join("\n");
		expect(js).not.toContain("renderInspector");
		expect(js).not.toContain("dev-daemon-footer");
	});
}, 60_000);
