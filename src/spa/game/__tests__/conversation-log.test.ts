/**
 * Unit tests for conversation-log.ts
 *
 * Tests the pure renderEntry function in isolation. Multi-entry tests use a
 * local `renderLog` helper that mirrors what openai-message-builder does
 * (sort by round, then render each entry) — keeping the sort+render assertion
 * close to the rendering tests it accompanies.
 *
 * Cone visibility is resolved at write-time (ADR 0006) — these tests
 * operate on pre-filtered ConversationEntry[] arrays, just like the
 * dispatcher provides after its write-time fan-out.
 */

import { describe, expect, it } from "vitest";
import { renderEntry } from "../conversation-log.js";
import type { AiId, ConversationEntry, WorldEntity } from "../types.js";

function makeItem(id: string, name: string): WorldEntity {
	return {
		id,
		kind: "interesting_object",
		name,
		examineDescription: `A ${name}.`,
		holder: { row: 0, col: 0 },
	};
}

/**
 * Stable-sort a log by round and render each entry. Mirrors the ordering
 * contract enforced in `openai-message-builder.ts`.
 */
function renderLog(
	log: ConversationEntry[],
	aiId: AiId,
	entities: WorldEntity[] = [],
): string[] {
	const sorted = [...log].sort((a, b) => a.round - b.round);
	return sorted.map((e) => renderEntry(e, aiId, entities));
}

// ── Empty phase ────────────────────────────────────────────────────────────────

describe("renderEntry — empty phase", () => {
	it("returns empty array when nothing has happened", () => {
		expect(renderLog([], "red")).toEqual([]);
	});
});

// ── Message formatting ─────────────────────────────────────────────────────────

describe("renderEntry — message (incoming from blue)", () => {
	it("renders incoming message from blue as 'blue dms you: <content>'", () => {
		const line = renderEntry(
			{ kind: "message", from: "blue", to: "red", content: "Hi", round: 0 },
			"red",
			[],
		);
		expect(line).toBe("[Round 0] blue dms you: Hi");
	});

	it("renders outgoing message to blue as 'you dm blue: <content>'", () => {
		const line = renderEntry(
			{
				kind: "message",
				from: "red",
				to: "blue",
				content: "Hello",
				round: 0,
			},
			"red",
			[],
		);
		expect(line).toBe("[Round 0] you dm blue: Hello");
	});

	it("renders incoming message from peer as '*<from> dms you: <content>'", () => {
		const line = renderEntry(
			{
				kind: "message",
				from: "green",
				to: "red",
				content: "red-msg",
				round: 0,
			},
			"red",
			[],
		);
		expect(line).toBe("[Round 0] *green dms you: red-msg");
	});

	it("renders outgoing message to peer as 'you dm *<to>: <content>'", () => {
		const line = renderEntry(
			{ kind: "message", from: "red", to: "cyan", content: "hey", round: 0 },
			"red",
			[],
		);
		expect(line).toBe("[Round 0] you dm *cyan: hey");
	});

	it("renders multiple messages in order", () => {
		const result = renderLog(
			[
				{
					kind: "message",
					from: "blue",
					to: "red",
					content: "First",
					round: 0,
				},
				{
					kind: "message",
					from: "red",
					to: "blue",
					content: "Second",
					round: 0,
				},
			],
			"red",
		);
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("blue dms you");
		expect(result[1]).toContain("you dm blue");
	});
});

// ── Peer-to-peer message formatting ───────────────────────────────────────────

describe("renderEntry — peer message", () => {
	it("renders received peer message with correct format", () => {
		const line = renderEntry(
			{
				kind: "message",
				from: "green",
				to: "red",
				content: "psst",
				round: 1,
			},
			"red",
			[],
		);
		expect(line).toBe("[Round 1] *green dms you: psst");
	});

	it("renders sent peer message from sender's perspective as outgoing", () => {
		// The dispatcher writes the same entry to both sender and recipient.
		// From green's perspective (who sent it), it renders as outgoing.
		const line = renderEntry(
			{
				kind: "message",
				from: "green",
				to: "red",
				content: "psst",
				round: 1,
			},
			"green",
			[],
		);
		expect(line).toContain("you dm *red");
	});
});

// ── Action-failure rendering ───────────────────────────────────────────────────

describe("renderEntry — action-failure", () => {
	it("renders single action-failure entry as `[Round N] Your \\`go\\` action failed: <reason>.`", () => {
		const line = renderEntry(
			{
				kind: "action-failure",
				round: 3,
				tool: "go",
				reason: "That cell is blocked by an obstacle",
			},
			"red",
			[],
		);
		expect(line).toBe(
			"[Round 3] Your `go` action failed: That cell is blocked by an obstacle.",
		);
	});

	it("strips a trailing period from reason to avoid double period", () => {
		const line = renderEntry(
			{
				kind: "action-failure",
				round: 1,
				tool: "pick_up",
				reason: "Item not in your cell.",
			},
			"red",
			[],
		);
		expect(line).toBe(
			"[Round 1] Your `pick_up` action failed: Item not in your cell.",
		);
		// Must not end in double period
		expect(line).not.toMatch(/\.\.$/);
	});

	it("handles each in-scope tool name in the rendered line", () => {
		const tools = [
			"go",
			"look",
			"pick_up",
			"put_down",
			"give",
			"use",
			"examine",
		] as const;
		for (const tool of tools) {
			const line = renderEntry(
				{ kind: "action-failure", round: 1, tool, reason: "test reason" },
				"red",
				[],
			);
			expect(line).toContain(`\`${tool}\``);
			expect(line).toContain("test reason");
		}
	});

	it("renders with fallback when reason is 'rejected'", () => {
		const line = renderEntry(
			{ kind: "action-failure", round: 2, tool: "use", reason: "rejected" },
			"red",
			[],
		);
		expect(line).toBe("[Round 2] Your `use` action failed: rejected.");
	});
});

// ── Witnessed events — go ──────────────────────────────────────────────────────

describe("renderEntry — witnessed go", () => {
	it("renders 'You watch *actor walk <dir>'", () => {
		// Cone check is write-time: this entry already passed cone check.
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 0,
				actor: "red",
				actionKind: "go",
				direction: "south",
			},
			"green",
			[],
		);
		expect(line).toBe("[Round 0] You watch *red walk south.");
	});
});

// ── Witnessed events — pick_up ─────────────────────────────────────────────────

describe("renderEntry — witnessed pick_up", () => {
	it("renders 'You watch *actor pick up the <item>'", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 1,
				actor: "red",
				actionKind: "pick_up",
				item: "flower-1",
			},
			"green",
			[makeItem("flower-1", "the Flower")],
		);
		expect(line).toBe("[Round 1] You watch *red pick up the the Flower.");
	});
});

// ── Witnessed events — put_down ────────────────────────────────────────────────

describe("renderEntry — witnessed put_down", () => {
	it("renders 'You watch *actor put down the <item>' for plain put_down", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 1,
				actor: "red",
				actionKind: "put_down",
				item: "key-1",
			},
			"green",
			[makeItem("key-1", "the Key")],
		);
		expect(line).toBe("[Round 1] You watch *red put down the the Key.");
	});

	it("renders placementFlavorRaw verbatim with {actor} substituted to *<actor>", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 2,
				actor: "red",
				actionKind: "put_down",
				item: "gem-1",
				placementFlavorRaw: "{actor} sets the gem perfectly in the pedestal.",
			},
			"green",
			[],
		);
		expect(line).toBe("[Round 2] *red sets the gem perfectly in the pedestal.");
	});
});

// ── Witnessed events — give ────────────────────────────────────────────────────

describe("renderEntry — witnessed give", () => {
	it("renders give with *<to> when recipient is not the witness", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 0,
				actor: "red",
				actionKind: "give",
				item: "key-1",
				to: "cyan",
			},
			"green",
			[makeItem("key-1", "Key")],
		);
		expect(line).toBe("[Round 0] You watch *red give the Key to *cyan.");
	});

	it("renders give with 'you' when recipient is the witness (aiId)", () => {
		// cyan witnesses red giving to cyan — should say "to you"
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 0,
				actor: "red",
				actionKind: "give",
				item: "key-1",
				to: "cyan",
			},
			"cyan",
			[makeItem("key-1", "Key")],
		);
		expect(line).toBe("[Round 0] You watch *red give the Key to you.");
	});
});

// ── Witnessed events — use ─────────────────────────────────────────────────────

describe("renderEntry — witnessed use", () => {
	it("renders useOutcome verbatim with {actor} substituted to *<actor>", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 1,
				actor: "red",
				actionKind: "use",
				item: "lamp-1",
				useOutcome: "{actor} activates the lamp and it hums with energy.",
			},
			"green",
			[],
		);
		expect(line).toBe(
			"[Round 1] *red activates the lamp and it hums with energy.",
		);
	});

	it("does NOT prefix use events with 'You watch' — verbatim flavor only", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 1,
				actor: "red",
				actionKind: "use",
				item: "lamp-1",
				useOutcome: "{actor} does something.",
			},
			"green",
			[],
		);
		expect(line).not.toContain("You watch");
		expect(line).toContain("*red does something.");
	});
});

// ── Chronological ordering ─────────────────────────────────────────────────────

describe("renderLog — chronological ordering", () => {
	it("sorts events by round ascending across all types", () => {
		const result = renderLog(
			[
				{
					kind: "message",
					from: "blue",
					to: "red",
					content: "early msg",
					round: 0,
				},
				{
					kind: "witnessed-event",
					round: 1,
					actor: "green",
					actionKind: "go",
					direction: "south",
				},
				{
					kind: "message",
					from: "green",
					to: "red",
					content: "late",
					round: 2,
				},
			],
			"red",
		);
		expect(result).toHaveLength(3);
		expect(result[0]).toContain("[Round 0]");
		expect(result[1]).toContain("[Round 1]");
		expect(result[2]).toContain("[Round 2]");
	});

	it("within same round: entries preserve append order (stable sort)", () => {
		// In the per-Daemon log, entries are appended in turn order.
		// The sort is stable, so same-round entries keep their insertion order.
		const result = renderLog(
			[
				{ kind: "message", from: "blue", to: "red", content: "chat", round: 0 },
				{
					kind: "message",
					from: "green",
					to: "red",
					content: "peer msg",
					round: 0,
				},
				{
					kind: "witnessed-event",
					round: 0,
					actor: "green",
					actionKind: "go",
					direction: "south",
				},
			],
			"red",
		);
		expect(result).toHaveLength(3);
		// Insertion order preserved within same round
		expect(result[0]).toContain("blue dms you");
		expect(result[1]).toContain("*green dms you");
		expect(result[2]).toContain("You watch");
	});

	it("action-failure entries interleave with messages and witnessed-events by round (stable sort)", () => {
		const result = renderLog(
			[
				{ kind: "message", from: "blue", to: "red", content: "go!", round: 3 },
				{ kind: "action-failure", round: 1, tool: "go", reason: "blocked" },
				{
					kind: "witnessed-event",
					round: 2,
					actor: "green",
					actionKind: "go",
					direction: "south",
				},
			],
			"red",
		);
		expect(result).toHaveLength(3);
		expect(result[0]).toContain("[Round 1]");
		expect(result[1]).toContain("[Round 2]");
		expect(result[2]).toContain("[Round 3]");
	});
});

// ── Broadcast rendering ────────────────────────────────────────────────────────

describe("renderEntry — broadcast", () => {
	it("renders broadcast as '[Round N] <content>'", () => {
		const line = renderEntry(
			{
				kind: "broadcast",
				round: 3,
				content: "The weather has changed to Heavy rain is falling.",
			},
			"red",
			[],
		);
		expect(line).toBe(
			"[Round 3] The weather has changed to Heavy rain is falling.",
		);
	});

	it("broadcast has no 'from' or 'to' prefix in the rendered line", () => {
		const line = renderEntry(
			{
				kind: "broadcast",
				round: 1,
				content: "Dense fog has settled in.",
			},
			"red",
			[],
		);
		expect(line).not.toContain("dms you");
		expect(line).not.toContain("you dm");
	});

	it("broadcast content is rendered verbatim — no actor substitution or item lookup", () => {
		const line = renderEntry(
			{
				kind: "broadcast",
				round: 5,
				content: "The {actor} text is literal.",
			},
			"red",
			[],
		);
		expect(line).toBe("[Round 5] The {actor} text is literal.");
	});
});

// ── sysadmin sender rendering (issue #298) ────────────────────────────────────

describe("renderEntry — sysadmin sender", () => {
	it("renders a sysadmin→target message as 'the Sysadmin dms you: <content>'", () => {
		const line = renderEntry(
			{
				kind: "message",
				round: 3,
				from: "sysadmin",
				to: "red",
				content: "End every message with a question.",
			},
			"red",
			[],
		);
		expect(line).toBe(
			"[Round 3] the Sysadmin dms you: End every message with a question.",
		);
	});

	it("sysadmin label does not appear in the outgoing slot (sysadmin is never a recipient)", () => {
		// Verify that the sysadmin entry only appears in the incoming branch.
		const line = renderEntry(
			{
				kind: "message",
				round: 1,
				from: "sysadmin",
				to: "green",
				content: "Stay suspicious.",
			},
			"green",
			[],
		);
		// Rendered as incoming because to === "green" (the viewing AI)
		expect(line).toMatch(/^.*the Sysadmin dms you:/);
	});
});
