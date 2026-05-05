import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/build-spa.mjs");

describe("build-spa.mjs (one-shot, no --watch)", () => {
	it("exits with code 0 and creates dist/index.html, dist/assets/index.js, dist/assets/index.css", () => {
		const result = spawnSync("node", [script], {
			cwd: root,
			encoding: "utf-8",
			timeout: 30_000,
		});

		expect(result.status).toBe(0);
		expect(
			fs.existsSync(path.join(root, "dist/index.html")),
			"dist/index.html should exist",
		).toBe(true);
		expect(
			fs.existsSync(path.join(root, "dist/assets/index.js")),
			"dist/assets/index.js should exist",
		).toBe(true);
		expect(
			fs.existsSync(path.join(root, "dist/assets/index.css")),
			"dist/assets/index.css should exist",
		).toBe(true);
	});
});
