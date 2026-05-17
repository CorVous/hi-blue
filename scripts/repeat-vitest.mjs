#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Parse argv: first numeric arg is iteration count (default 20), rest are passthrough
const args = process.argv.slice(2);
let N = 20;
let passthrough = args;

if (args.length > 0 && /^\d+$/.test(args[0])) {
	N = parseInt(args[0], 10);
	passthrough = args.slice(1);
}

let currentIteration = 0;

// Handle SIGINT (Ctrl-C)
process.on("SIGINT", () => {
	console.error(
		`[test:repeat] interrupted on iteration ${currentIteration}/${N}`,
	);
	process.exit(130);
});

// Run the loop
for (let i = 1; i <= N; i++) {
	currentIteration = i;
	console.log(
		`[test:repeat] iteration ${i}/${N} — running: vitest run ${passthrough.join(" ")}`,
	);

	const result = spawnSync("pnpm", ["exec", "vitest", "run", ...passthrough], {
		stdio: "inherit",
		cwd: repoRoot,
		shell: false,
	});

	if (result.status !== 0) {
		console.error(`[test:repeat] FAILED on iteration ${i} of ${N}`);
		process.exit(result.status ?? 1);
	}

	if (result.signal) {
		console.error(
			`[test:repeat] FAILED on iteration ${i} of ${N} (signal: ${result.signal})`,
		);
		process.exit(1);
	}
}

console.log(`[test:repeat] PASSED ${N}/${N}`);
process.exit(0);
