import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LOCAL_WORKER_BASE_URL = "http://localhost:8787";
const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? LOCAL_WORKER_BASE_URL;
const IS_DEV_BUILD = WORKER_BASE_URL === LOCAL_WORKER_BASE_URL;
const ASSETS_DIR = path.join(root, "dist", "assets");
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

const PKG_VERSION = (() => {
	try {
		const raw = JSON.parse(
			execSync("cat package.json", { cwd: root }).toString(),
		);
		return typeof raw.version === "string" ? raw.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
})();

const RELEASE_VERSION_TAGGED_AT_HEAD = (() => {
	try {
		const tag = execSync(
			"git describe --tags --exact-match --match 'v*' HEAD",
			{ cwd: root, stdio: ["ignore", "pipe", "ignore"] },
		)
			.toString()
			.trim();
		return tag.replace(/^v/, "");
	} catch {
		return null;
	}
})();

const LATEST_ANCESTOR_RELEASE_VERSION = (() => {
	try {
		const tag = execSync("git describe --tags --abbrev=0 --match 'v*' HEAD", {
			cwd: root,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
		return tag.replace(/^v/, "");
	} catch {
		return null;
	}
})();

console.log(
	`Building SPA with WORKER_BASE_URL=${WORKER_BASE_URL} COMMIT_SHA=${COMMIT_SHA} COMMIT_TIMESTAMP_MS=${COMMIT_TIMESTAMP_MS} VERSION=${PKG_VERSION} RELEASE_VERSION=${RELEASE_VERSION_TAGGED_AT_HEAD} LATEST_RELEASE_VERSION=${LATEST_ANCESTOR_RELEASE_VERSION}`,
);

await fs.mkdir(ASSETS_DIR, { recursive: true });

async function deleteStaleHashedAssets() {
	const entries = await fs.readdir(ASSETS_DIR).catch(() => []);
	await Promise.all(
		entries.map((name) =>
			fs.rm(path.join(ASSETS_DIR, name), { force: true, recursive: true }),
		),
	);
}
await deleteStaleHashedAssets();

const wireHashedAssetsIntoIndexHtmlPlugin = {
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
	outdir: ASSETS_DIR,
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
		__VERSION__: JSON.stringify(PKG_VERSION),
		__RELEASE_VERSION__: JSON.stringify(RELEASE_VERSION_TAGGED_AT_HEAD),
		__LATEST_RELEASE_VERSION__: JSON.stringify(LATEST_ANCESTOR_RELEASE_VERSION),
		__DEV__: IS_DEV_BUILD ? "true" : "false",
	},
	plugins: [wireHashedAssetsIntoIndexHtmlPlugin],
});

if (watchMode) {
	await ctx.watch();
	console.log("watching SPA sources…");
} else {
	await ctx.rebuild();
	await ctx.dispose();
	console.log("Build complete: dist/index.html + dist/assets/index.{js,css}");

	generateVersionListPage();
}

function generateVersionListPage() {
	try {
		execSync("node scripts/generate-version-list.mjs", { cwd: root });
	} catch (error) {
		console.warn("Warning: Failed to generate version list:", error.message);
	}
}
