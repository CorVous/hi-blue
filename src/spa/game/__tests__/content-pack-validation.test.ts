import { describe, expect, it } from "vitest";
import { findMatchedUseTellKeywords } from "../content-pack-validation.js";

function examineMentionsUseTell(examineDescription: string): boolean {
	return findMatchedUseTellKeywords(examineDescription).length > 0;
}

describe("examineMentionsUseTell", () => {
	it.each([
		[
			"a verb-of-activation like 'press'",
			"A small brass dial mounted on a panel. It looks like it should be pressed to open the chamber.",
		],
		[
			"the bare verb 'use'",
			"A peculiar device. You wonder if it could be used.",
		],
		[
			"an activation verb in context",
			"A heavy stone slab carved with runes. Press the slab to activate the chamber.",
		],
		[
			"a control noun like 'lever' even without an activation verb",
			"A heavy iron lever bolted to the wall, weathered by years of damp.",
		],
		["a single cue word in isolation", "A copper button on the far wall."],
		["case-insensitive cue words", "PRESS the BUTTON to begin."],
		["an upper-case control noun", "PULL THE LEVER."],
	])("matches %s", (_label, examineDescription) => {
		expect(examineMentionsUseTell(examineDescription)).toBe(true);
	});

	it.each([
		[
			"an examine with no verb or control-noun cue",
			"A small porcelain figurine, chipped along one edge but otherwise intact.",
		],
		[
			"a generic descriptive examine with no activation cue",
			"A sturdy mount carved from weathered stone, half-buried in moss.",
		],
		[
			"'use' inside a longer word like 'fuse' (whole-word match)",
			"A scorched copper fuse, brittle and discoloured.",
		],
		["the empty string", ""],
	])("rejects %s", (_label, examineDescription) => {
		expect(examineMentionsUseTell(examineDescription)).toBe(false);
	});
});
