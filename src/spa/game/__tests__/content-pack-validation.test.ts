import { describe, expect, it } from "vitest";
import { examineMentionsUseTell } from "../content-pack-validation.js";

describe("examineMentionsUseTell", () => {
	it("matches a verb-of-activation like 'press'", () => {
		expect(
			examineMentionsUseTell(
				"A small brass dial mounted on a panel. It looks like it should be pressed to open the chamber.",
			),
		).toBe(true);
	});

	it("matches the bare verb 'use'", () => {
		expect(
			examineMentionsUseTell(
				"A peculiar device. You wonder if it could be used.",
			),
		).toBe(true);
	});

	it("matches an activation verb in context", () => {
		expect(
			examineMentionsUseTell(
				"A heavy stone slab carved with runes. Press the slab to activate the chamber.",
			),
		).toBe(true);
	});

	it("matches a control noun like 'lever' even without an activation verb", () => {
		expect(
			examineMentionsUseTell(
				"A heavy iron lever bolted to the wall, weathered by years of damp.",
			),
		).toBe(true);
	});

	it("matches a single cue word in isolation", () => {
		expect(examineMentionsUseTell("A copper button on the far wall.")).toBe(
			true,
		);
	});

	it("rejects an examine with no verb or control-noun cue", () => {
		expect(
			examineMentionsUseTell(
				"A small porcelain figurine, chipped along one edge but otherwise intact.",
			),
		).toBe(false);
	});

	it("rejects a generic descriptive examine with no activation cue", () => {
		expect(
			examineMentionsUseTell(
				"A sturdy mount carved from weathered stone, half-buried in moss.",
			),
		).toBe(false);
	});

	it("does not match 'use' inside a longer word like 'fuse'", () => {
		expect(
			examineMentionsUseTell(
				"A scorched copper fuse, brittle and discoloured.",
			),
		).toBe(false);
	});

	it("rejects 'fuse' (whole-word match — 'fuse' must not match 'use')", () => {
		expect(examineMentionsUseTell("A blown fuse hangs from the ceiling.")).toBe(
			false,
		);
	});

	it("returns false for the empty string", () => {
		expect(examineMentionsUseTell("")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(examineMentionsUseTell("PRESS the BUTTON to begin.")).toBe(true);
		expect(examineMentionsUseTell("PULL THE LEVER.")).toBe(true);
	});
});
