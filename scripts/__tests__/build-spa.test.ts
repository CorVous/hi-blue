import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/build-spa.mjs");

describe("build-spa.mjs (one-shot, no --watch)", () => {
	it("exits with code 0 and emits content-hashed assets referenced from index.html", () => {
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

		const assets = fs.readdirSync(path.join(root, "dist/assets"));
		const jsName = assets.find((n) => /^index-[A-Z0-9]+\.js$/.test(n));
		const cssName = assets.find((n) => /^index-[A-Z0-9]+\.css$/.test(n));
		expect(jsName, "a content-hashed JS bundle should exist").toBeDefined();
		expect(cssName, "a content-hashed CSS bundle should exist").toBeDefined();

		const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
		expect(html).toContain(`./assets/${jsName}`);
		expect(html).toContain(`./assets/${cssName}`);
	});
});
