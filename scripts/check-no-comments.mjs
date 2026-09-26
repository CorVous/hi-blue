#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const ROOTS = [
	"src",
	"e2e",
	"evals",
	"scripts",
	"vitest.config.ts",
	"playwright.config.ts",
	"wrangler.jsonc",
	"biome.json",
	"tsconfig.json",
	"tsconfig.base.json",
	"tsconfig.tools.json",
	"package.json",
];
const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);
const SCRIPT_EXTENSIONS = new Set([
	".ts",
	".mts",
	".cts",
	".js",
	".mjs",
	".cjs",
]);
const SHELL_EXTENSIONS = new Set([".sh"]);
const STYLE_EXTENSIONS = new Set([".css"]);
const MARKUP_EXTENSIONS = new Set([".html"]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".wrangler"]);

const KEPT_DIRECTIVES = [
	/^\/\/\s*biome-ignore\b/,
	/^\/\/\s*@ts-expect-error\b/,
	/^\/\/\s*@ts-ignore\b/,
	/^\/\/\/\s*<reference\b/,
	/^\/\/\s*@vitest-environment\b/,
	/^\/\*\s*(v8|c8) ignore\b/,
	/^\/\*\s*@__PURE__\s*\*\/$/,
];

function listFiles(directory) {
	const found = [];
	for (const entry of readdirSync(directory)) {
		if (SKIPPED_DIRECTORIES.has(entry)) continue;
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) found.push(...listFiles(path));
		else found.push(path);
	}
	return found;
}

function scriptCommentRanges(path, text) {
	const extension = extname(path);
	const kind = JSON_EXTENSIONS.has(extension)
		? ts.ScriptKind.JSON
		: extension.startsWith(".t")
			? ts.ScriptKind.TS
			: ts.ScriptKind.JS;
	const source = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		kind,
	);
	const ranges = new Map();
	const record = (list) => {
		for (const range of list ?? []) {
			const raw = text.slice(range.pos, range.end);
			if (KEPT_DIRECTIVES.some((pattern) => pattern.test(raw))) continue;
			ranges.set(range.pos, { start: range.pos, end: range.end });
		}
	};
	const visit = (node) => {
		record(ts.getLeadingCommentRanges(text, node.getFullStart()));
		record(ts.getTrailingCommentRanges(text, node.getEnd()));
		for (const child of node.getChildren(source)) visit(child);
	};
	visit(source);
	return [...ranges.values()].sort((a, b) => a.start - b.start);
}

function patternCommentRanges(text, pattern, keepShebang) {
	const ranges = [];
	for (const match of text.matchAll(pattern)) {
		if (keepShebang && match.index === 0 && text.startsWith("#!")) continue;
		ranges.push({ start: match.index, end: match.index + match[0].length });
	}
	return ranges;
}

function commentRanges(path, text) {
	const extension = extname(path);
	if (SCRIPT_EXTENSIONS.has(extension) || JSON_EXTENSIONS.has(extension))
		return scriptCommentRanges(path, text);
	if (SHELL_EXTENSIONS.has(extension))
		return patternCommentRanges(text, /^[ \t]*#.*$/gm, true);
	if (STYLE_EXTENSIONS.has(extension))
		return patternCommentRanges(text, /\/\*[\s\S]*?\*\//g, false);
	if (MARKUP_EXTENSIONS.has(extension))
		return patternCommentRanges(text, /<!--[\s\S]*?-->/g, false);
	return null;
}

function stripRanges(text, ranges) {
	let output = text;
	for (const { start, end } of [...ranges].reverse()) {
		let from = start;
		let to = end;
		while (from > 0 && (output[from - 1] === " " || output[from - 1] === "\t"))
			from -= 1;
		const lineStart = from === 0 || output[from - 1] === "\n";
		const lineEnd = to === output.length || output[to] === "\n";
		if (lineStart && lineEnd && to < output.length) to += 1;
		output = output.slice(0, from) + output.slice(to);
	}
	return output;
}

function lineOf(text, offset) {
	return text.slice(0, offset).split("\n").length;
}

const fix = process.argv.includes("--fix");
const explicit = process.argv
	.slice(2)
	.filter((argument) => !argument.startsWith("--"));
const expand = (path) =>
	statSync(path).isDirectory() ? listFiles(path) : [path];
const files = (explicit.length > 0 ? explicit : ROOTS).flatMap(expand);

let violations = 0;
for (const path of files) {
	const text = readFileSync(path, "utf8");
	const ranges = commentRanges(path, text);
	if (!ranges || ranges.length === 0) continue;
	if (fix) {
		writeFileSync(path, stripRanges(text, ranges));
		continue;
	}
	violations += ranges.length;
	for (const range of ranges) {
		console.error(
			`${relative(process.cwd(), path)}:${lineOf(text, range.start)}: comment is not allowed`,
		);
	}
}

if (!fix && violations > 0) {
	console.error(
		`\n${violations} comment(s) found. Run \`node scripts/check-no-comments.mjs --fix\` to remove them.`,
	);
	process.exit(1);
}
