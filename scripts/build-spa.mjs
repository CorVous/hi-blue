import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "http://localhost:8787";

console.log(`Building SPA with WORKER_BASE_URL=${WORKER_BASE_URL}`);

// Ensure dist/ and dist/assets/ exist
await fs.mkdir(path.join(root, "dist", "assets"), { recursive: true });

await esbuild.build({
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
	},
});

await fs.copyFile(
	path.join(root, "src/spa/index.html"),
	path.join(root, "dist/index.html"),
);

console.log("Build complete: dist/index.html + dist/assets/index.{js,css}");
