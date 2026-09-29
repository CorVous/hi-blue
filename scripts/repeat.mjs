#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const RUNNERS = {
	vitest: {
		label: "test:repeat",
		command: ["vitest", "run"],
		defaultIterations: 20,
	},
	playwright: {
		label: "smoke:repeat",
		command: ["playwright", "test"],
		defaultIterations: 10,
	},
};
const EXIT_CODE_INTERRUPTED = 130;

const [runnerName, ...args] = process.argv.slice(2);
const runner = Object.hasOwn(RUNNERS, runnerName) ? RUNNERS[runnerName] : null;
if (!runner) {
	console.error(
		`usage: repeat.mjs <${Object.keys(RUNNERS).join("|")}> [count] [runner args...]`,
	);
	process.exit(1);
}

let iterations = runner.defaultIterations;
let passthrough = args;

if (args.length > 0 && /^-?\d+$/.test(args[0])) {
	iterations = Number.parseInt(args[0], 10);
	passthrough = args.slice(1);
	if (iterations < 1) {
		console.error(
			`[${runner.label}] count must be at least 1, got ${iterations}`,
		);
		process.exit(1);
	}
}

let currentIteration = 0;

process.on("SIGINT", () => {
	console.error(
		`[${runner.label}] interrupted on iteration ${currentIteration}/${iterations}`,
	);
	process.exit(EXIT_CODE_INTERRUPTED);
});

for (let i = 1; i <= iterations; i++) {
	currentIteration = i;
	const commandLine = [...runner.command, ...passthrough].join(" ");
	console.log(
		`[${runner.label}] iteration ${i}/${iterations} — running: ${commandLine}`,
	);

	const result = spawnSync(
		"pnpm",
		["exec", ...runner.command, ...passthrough],
		{
			stdio: "inherit",
			cwd: repoRoot,
			shell: false,
		},
	);

	if (result.status !== 0) {
		const signal = result.signal ? ` (signal: ${result.signal})` : "";
		console.error(
			`[${runner.label}] FAILED on iteration ${i} of ${iterations}${signal}`,
		);
		process.exit(result.status ?? 1);
	}
}

console.log(`[${runner.label}] PASSED ${iterations}/${iterations}`);
process.exit(0);
