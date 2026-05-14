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

// Drop any previously-built hashed assets so old hashes don't accumulate
// across rebuilds (esbuild won't clean its outdir).
async function cleanAssets() {
	const assetsDir = path.join(root, "dist", "assets");
	const entries = await fs.readdir(assetsDir).catch(() => []);
	await Promise.all(
		entries.map((name) =>
			fs.rm(path.join(assetsDir, name), { force: true, recursive: true }),
		),
	);
}
await cleanAssets();

/**
 * esbuild plugin: after each (re)build, look up the content-hashed entry
 * filenames from the metafile and rewrite dist/index.html to reference them.
 * The source HTML keeps the un-hashed `./assets/index.{js,css}` paths so it
 * stays valid as a template; the build is the only place hashes are wired in.
 */
const templateHtmlPlugin = {
	name: "template-html",
	setup(build) {
		build.onEnd(async (result) => {
			try {
				if (!result.metafile) {
					console.error("[template-html] missing metafile in build result");
					return;
				}
				let jsName = null;
				let cssName = null;
				for (const outPath of Object.keys(result.metafile.outputs)) {
					const base = path.basename(outPath);
					if (base.endsWith(".map")) continue;
					if (base.endsWith(".js")) jsName = base;
					else if (base.endsWith(".css")) cssName = base;
				}
				if (!jsName || !cssName) {
					console.error("[template-html] could not find hashed entry outputs", {
						jsName,
						cssName,
					});
					return;
				}
				const src = await fs.readFile(
					path.join(root, "src/spa/index.html"),
					"utf8",
				);
				const html = src
					.replace("./assets/index.css", `./assets/${cssName}`)
					.replace("./assets/index.js", `./assets/${jsName}`);
				await fs.writeFile(path.join(root, "dist/index.html"), html);
			} catch (err) {
				console.error("[template-html] failed:", err);
			}
		});
	},
};

const ctx = await esbuild.context({
	entryPoints: { index: path.join(root, "src/spa/main.ts") },
	bundle: true,
	outdir: path.join(root, "dist/assets"),
	// Content-hashed entry filenames so new commits invalidate downstream
	// caches automatically. Combined with long-lived Cache-Control headers on
	// /assets/* in the Worker, this gives immutable-cacheable bundles.
	entryNames: "[name]-[hash]",
	metafile: true,
	format: "esm",
	target: ["es2022"],
	sourcemap: true,
	minify: true,
	loader: { ".css": "css" },
	define: {
		__WORKER_BASE_URL__: JSON.stringify(WORKER_BASE_URL),
		__COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
		__COMMIT_TIMESTAMP_MS__: JSON.stringify(COMMIT_TIMESTAMP_MS),
		__DEV__: WORKER_BASE_URL === "http://localhost:8787" ? "true" : "false",
	},
	plugins: [templateHtmlPlugin],
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
