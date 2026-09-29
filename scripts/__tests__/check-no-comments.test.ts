import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(__dirname, "../check-no-comments.mjs");

const sourcesToCheck = new Map<string, string>();
const flaggedByName = new Map<string, number[]>();
let workDir: string;

beforeAll(() => {
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-no-comments-"));
	for (const [name, text] of sourcesToCheck) {
		fs.writeFileSync(path.join(workDir, name), text);
	}
	const result = spawnSync("node", [script, ...sourcesToCheck.keys()], {
		cwd: workDir,
		encoding: "utf-8",
	});
	for (const match of result.stderr.matchAll(
		/^(.+):(\d+): comment is not allowed$/gm,
	)) {
		const [, name = "", line] = match;
		flaggedByName.set(name, [...(flaggedByName.get(name) ?? []), Number(line)]);
	}
});

afterAll(() => {
	fs.rmSync(workDir, { recursive: true, force: true });
});

function itFlags(
	title: string,
	name: string,
	lines: string[],
	expected: number[],
): void {
	sourcesToCheck.set(name, lines.join("\n"));
	it(title, () => {
		expect(flaggedByName.get(name) ?? []).toEqual(expected);
	});
}

function fixed(name: string, text: string): string {
	const file = path.join(workDir, name);
	fs.writeFileSync(file, text);
	spawnSync("node", [script, "--fix", file], { cwd: workDir });
	return fs.readFileSync(file, "utf8");
}

describe("check-no-comments.mjs: scripts", () => {
	itFlags(
		"flags line and block comments but not // inside strings",
		"a.ts",
		[
			"const url = 'https://example.com';",
			"// a comment",
			"const x = 1; /* trailing */",
		],
		[2, 3],
	);

	itFlags(
		"keeps tool directives, including both PURE spellings and the block vitest-environment",
		"b.ts",
		[
			"/** @vitest-environment jsdom */",
			"// @vitest-environment node",
			"// biome-ignore lint/style/noNonNullAssertion: reason",
			"const a = /*#__PURE__*/ make();",
			"const b = /* @__PURE__ */ make();",
			"function make() { return 1; }",
		],
		[],
	);
});

describe("check-no-comments.mjs: shell", () => {
	itFlags(
		"keeps the shebang and flags whole-line and trailing comments",
		"a.sh",
		[
			"#!/usr/bin/env bash",
			"# whole line",
			"echo hi # trailing",
			"echo \"a # in quotes\" 'b # too'",
			"echo $\x7b#ARR[@]} foo#bar $#",
		],
		[2, 3],
	);

	itFlags(
		"skips heredoc bodies",
		"b.sh",
		[
			"cat <<'EOF' > out.md",
			"# a heading, not a comment",
			"EOF",
			"cat <<-EOF",
			"\t# indented heading",
			"\tEOF",
			'cat <<<"here # string"',
			"# real comment",
		],
		[8],
	);

	itFlags(
		"does not treat a shift inside arithmetic as a heredoc",
		"d.sh",
		[
			"mask=$((1<<BITS))",
			"# comment after arithmetic",
			"((flags = flags<<SHIFT))",
			"# another comment",
		],
		[2, 4],
	);

	itFlags(
		"does not treat <<EOF inside quotes as a heredoc",
		"e.sh",
		["echo \"use <<EOF to start\" 'or <<-END'", "# comment after quoted text"],
		[2],
	);

	itFlags(
		"skips the bodies of several heredocs started on one line",
		"f.sh",
		[
			"paste <(cat <<A) <(cat <<\\B)",
			"# body of A",
			"A",
			"# body of B",
			"B",
			"# real comment",
		],
		[6],
	);

	it("--fix strips a trailing comment and keeps the command", () => {
		expect(fixed("c.sh", "echo hi # trailing\n# gone\necho bye\n")).toBe(
			"echo hi\necho bye\n",
		);
	});
});

describe("check-no-comments.mjs: css", () => {
	itFlags(
		"ignores /* inside strings and url()",
		"a.css",
		[
			'a { background: url("data:x/*y"); }',
			"b { background: url(/*/path); }",
			"c::before { content: '/* not */'; }",
			"/* real */",
		],
		[4],
	);
});

describe("check-no-comments.mjs: html", () => {
	itFlags(
		"ignores <!-- inside script strings and flags comments in both places",
		"a.html",
		[
			"<p>hi</p>",
			"<!-- markup comment -->",
			"<script>",
			'  const s = "<!-- not a comment -->";',
			"  // script comment",
			"</script>",
		],
		[2, 5],
	);
});
