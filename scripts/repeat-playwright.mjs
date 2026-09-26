#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);
const DEFAULT_ITERATIONS = 10;
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
		`[smoke:repeat] interrupted on iteration ${currentIteration}/${iterations}`,
	);
	process.exit(EXIT_CODE_INTERRUPTED);
});

for (let i = 1; i <= iterations; i++) {
	currentIteration = i;
	console.log(
		`[smoke:repeat] iteration ${i}/${iterations} — running: playwright test ${passthrough.join(" ")}`,
	);

	const result = spawnSync(
		"pnpm",
		["exec", "playwright", "test", ...passthrough],
		{
			stdio: "inherit",
			cwd: repoRoot,
			shell: false,
		},
	);

	if (result.status !== 0) {
		console.error(`[smoke:repeat] FAILED on iteration ${i} of ${iterations}`);
		process.exit(result.status ?? 1);
	}

	if (result.signal) {
		console.error(
			`[smoke:repeat] FAILED on iteration ${i} of ${iterations} (signal: ${result.signal})`,
		);
		process.exit(1);
	}
}

console.log(`[smoke:repeat] PASSED ${iterations}/${iterations}`);
process.exit(0);
