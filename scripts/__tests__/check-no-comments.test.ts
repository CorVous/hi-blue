import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(__dirname, "../check-no-comments.mjs");

let workDir: string;

beforeEach(() => {
	workDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-no-comments-"));
});

afterEach(() => {
	fs.rmSync(workDir, { recursive: true, force: true });
});

function flaggedLines(name: string, text: string): number[] {
	const file = path.join(workDir, name);
	fs.writeFileSync(file, text);
	const result = spawnSync("node", [script, file], {
		cwd: workDir,
		encoding: "utf-8",
	});
	return [...result.stderr.matchAll(/:(\d+): comment is not allowed/g)].map(
		(match) => Number(match[1]),
	);
}

function fixed(name: string, text: string): string {
	const file = path.join(workDir, name);
	fs.writeFileSync(file, text);
	spawnSync("node", [script, "--fix", file], { cwd: workDir });
	return fs.readFileSync(file, "utf8");
}

describe("check-no-comments.mjs: scripts", () => {
	it("flags line and block comments but not // inside strings", () => {
		const text = [
			"const url = 'https://example.com';",
			"// a comment",
			"const x = 1; /* trailing */",
		].join("\n");
		expect(flaggedLines("a.ts", text)).toEqual([2, 3]);
	});

	it("keeps tool directives, including both PURE spellings and the block vitest-environment", () => {
		const text = [
			"/** @vitest-environment jsdom */",
			"// @vitest-environment node",
			"// biome-ignore lint/style/noNonNullAssertion: reason",
			"const a = /*#__PURE__*/ make();",
			"const b = /* @__PURE__ */ make();",
			"function make() { return 1; }",
		].join("\n");
		expect(flaggedLines("b.ts", text)).toEqual([]);
	});
});

describe("check-no-comments.mjs: shell", () => {
	it("keeps the shebang and flags whole-line and trailing comments", () => {
		const text = [
			"#!/usr/bin/env bash",
			"# whole line",
			"echo hi # trailing",
			"echo \"a # in quotes\" 'b # too'",
			"echo $\x7b#ARR[@]} foo#bar $#",
		].join("\n");
		expect(flaggedLines("a.sh", text)).toEqual([2, 3]);
	});

	it("skips heredoc bodies", () => {
		const text = [
			"cat <<'EOF' > out.md",
			"# a heading, not a comment",
			"EOF",
			"cat <<-EOF",
			"\t# indented heading",
			"\tEOF",
			'cat <<<"here # string"',
			"# real comment",
		].join("\n");
		expect(flaggedLines("b.sh", text)).toEqual([8]);
	});

	it("does not treat a shift inside arithmetic as a heredoc", () => {
		const text = [
			"mask=$((1<<BITS))",
			"# comment after arithmetic",
			"((flags = flags<<SHIFT))",
			"# another comment",
		].join("\n");
		expect(flaggedLines("d.sh", text)).toEqual([2, 4]);
	});

	it("does not treat <<EOF inside quotes as a heredoc", () => {
		const text = [
			"echo \"use <<EOF to start\" 'or <<-END'",
			"# comment after quoted text",
		].join("\n");
		expect(flaggedLines("e.sh", text)).toEqual([2]);
	});

	it("skips the bodies of several heredocs started on one line", () => {
		const text = [
			"paste <(cat <<A) <(cat <<\\B)",
			"# body of A",
			"A",
			"# body of B",
			"B",
			"# real comment",
		].join("\n");
		expect(flaggedLines("f.sh", text)).toEqual([6]);
	});

	it("--fix strips a trailing comment and keeps the command", () => {
		expect(fixed("c.sh", "echo hi # trailing\n# gone\necho bye\n")).toBe(
			"echo hi\necho bye\n",
		);
	});
});

describe("check-no-comments.mjs: css", () => {
	it("ignores /* inside strings and url()", () => {
		const text = [
			'a { background: url("data:x/*y"); }',
			"b { background: url(/*/path); }",
			"c::before { content: '/* not */'; }",
			"/* real */",
		].join("\n");
		expect(flaggedLines("a.css", text)).toEqual([4]);
	});
});

describe("check-no-comments.mjs: html", () => {
	it("ignores <!-- inside script strings and flags comments in both places", () => {
		const text = [
			"<p>hi</p>",
			"<!-- markup comment -->",
			"<script>",
			'  const s = "<!-- not a comment -->";',
			"  // script comment",
			"</script>",
		].join("\n");
		expect(flaggedLines("a.html", text)).toEqual([2, 5]);
	});
});
