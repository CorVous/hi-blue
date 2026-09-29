import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const script = path.join(root, "scripts/build-spa.mjs");

describe("build-spa.mjs (one-shot, no --watch)", () => {
	let distDir = "";

	beforeEach(() => {
		distDir = fs.mkdtempSync(path.join(os.tmpdir(), "hi-blue-build-spa-"));
	});

	afterEach(() => {
		fs.rmSync(distDir, { recursive: true, force: true });
	});

	it("exits with code 0 and emits content-hashed assets referenced from index.html", () => {
		const result = spawnSync("node", [script], {
			cwd: root,
			encoding: "utf-8",
			timeout: 30_000,
			env: { ...process.env, SPA_DIST_DIR: distDir },
		});

		expect(result.status).toBe(0);
		expect(
			fs.existsSync(path.join(distDir, "index.html")),
			"index.html should exist in SPA_DIST_DIR",
		).toBe(true);

		const assets = fs.readdirSync(path.join(distDir, "assets"));
		const jsName = assets.find((n) => /^index-[A-Z0-9]+\.js$/.test(n));
		const cssName = assets.find((n) => /^index-[A-Z0-9]+\.css$/.test(n));
		expect(jsName, "a content-hashed JS bundle should exist").toBeDefined();
		expect(cssName, "a content-hashed CSS bundle should exist").toBeDefined();

		const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
		expect(html).toContain(`./assets/${jsName}`);
		expect(html).toContain(`./assets/${cssName}`);
	});

	it("falls back to the local worker URL when WORKER_BASE_URL is empty", () => {
		const result = spawnSync("node", [script], {
			cwd: root,
			encoding: "utf-8",
			timeout: 30_000,
			env: { ...process.env, WORKER_BASE_URL: "", SPA_DIST_DIR: distDir },
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("WORKER_BASE_URL=http://localhost:8787 ");
		const version = JSON.parse(
			fs.readFileSync(path.join(root, "package.json"), "utf8"),
		).version;
		expect(result.stdout).toContain(`VERSION=${version} `);
	});
});
