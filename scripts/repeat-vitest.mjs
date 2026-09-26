#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);
const DEFAULT_ITERATIONS = 20;
const EXIT_CODE_INTERRUPTED = 130;
let iterations = DEFAULT_ITERATIONS;
let passthrough = args;

if (args.length > 0 && /^\d+$/.test(args[0])) {
	iterations = parseInt(args[0], 10);
	passthrough = args.slice(1);
}

let currentIteration = 0;

process.on("SIGINT", () => {
	console.error(
		`[test:repeat] interrupted on iteration ${currentIteration}/${iterations}`,
	);
	process.exit(EXIT_CODE_INTERRUPTED);
});

for (let i = 1; i <= iterations; i++) {
	currentIteration = i;
	console.log(
		`[test:repeat] iteration ${i}/${iterations} — running: vitest run ${passthrough.join(" ")}`,
	);

	const result = spawnSync("pnpm", ["exec", "vitest", "run", ...passthrough], {
		stdio: "inherit",
		cwd: repoRoot,
		shell: false,
	});

	if (result.status !== 0) {
		console.error(`[test:repeat] FAILED on iteration ${i} of ${iterations}`);
		process.exit(result.status ?? 1);
	}

	if (result.signal) {
		console.error(
			`[test:repeat] FAILED on iteration ${i} of ${iterations} (signal: ${result.signal})`,
		);
		process.exit(1);
	}
}

console.log(`[test:repeat] PASSED ${iterations}/${iterations}`);
process.exit(0);
