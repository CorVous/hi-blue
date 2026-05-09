import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "http://localhost:8787";
const watchMode = process.argv.includes("--watch");

const COMMIT_SHA = (() => {
	try {
		return execSync("git rev-parse --short HEAD", { cwd: root })
			.toString()
			.trim();
	} catch {
		return "unknown";
	}
})();

const COMMIT_TIMESTAMP_MS = (() => {
	try {
		const seconds = Number.parseInt(
			execSync("git log -1 --format=%ct HEAD", { cwd: root }).toString().trim(),
			10,
		);
		return Number.isFinite(seconds) ? seconds * 1000 : 0;
	} catch {
		return 0;
	}
})();

console.log(
	`Building SPA with WORKER_BASE_URL=${WORKER_BASE_URL} COMMIT_SHA=${COMMIT_SHA} COMMIT_TIMESTAMP_MS=${COMMIT_TIMESTAMP_MS}`,
);

// Ensure dist/ and dist/assets/ exist
await fs.mkdir(path.join(root, "dist", "assets"), { recursive: true });

/** esbuild plugin: re-copy index.html after every (re)build. */
const copyHtmlPlugin = {
	name: "copy-html",
	setup(build) {
		build.onEnd(async () => {
			try {
				await fs.copyFile(
					path.join(root, "src/spa/index.html"),
					path.join(root, "dist/index.html"),
				);
			} catch (err) {
				console.error("[copy-html] failed to copy index.html:", err);
			}
		});
	},
};

const ctx = await esbuild.context({
	entryPoints: { index: path.join(root, "src/spa/main.ts") },
	bundle: true,
	outdir: path.join(root, "dist/assets"),
	format: "esm",
	target: ["es2022"],
	sourcemap: true,
	minify: true,
	loader: { ".css": "css" },
	define: {
		__WORKER_BASE_URL__: JSON.stringify(WORKER_BASE_URL),
		__COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
		__COMMIT_TIMESTAMP_MS__: JSON.stringify(COMMIT_TIMESTAMP_MS),
	},
	plugins: [copyHtmlPlugin],
});

if (watchMode) {
	await ctx.watch();
	console.log("watching SPA sources…");
	// Keep the process alive — ctrl-C to stop.
} else {
	await ctx.rebuild();
	await ctx.dispose();
	console.log("Build complete: dist/index.html + dist/assets/index.{js,css}");
}
