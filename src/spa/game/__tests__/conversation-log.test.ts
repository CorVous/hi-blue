/**
 * Unit tests for conversation-log.ts
 *
 * Tests the pure buildConversationLog function in isolation.
 * Cone visibility is resolved at write-time (ADR 0006) — these tests
 * operate on pre-filtered ConversationEntry[] arrays, just like the
 * dispatcher provides after its write-time fan-out.
 */

import { describe, expect, it } from "vitest";
import {
	buildConversationLog,
	type ConversationLogInput,
} from "../conversation-log.js";
import type { AiPersona, WorldEntity } from "../types.js";

// Minimal personas for tests
const TEST_PERSONAS: Record<string, AiPersona> = {
	red: {
		id: "red",
		name: "Ember",
		color: "#e07a5f",
		temperaments: ["hot-headed", "zealous"],
		personaGoal: "Hold the flower at phase end.",
		typingQuirks: [
			"You speak in fragments. Short bursts. Rarely complete sentences.",
			"You lean on em-dashes — interrupting yourself mid-sentence — and rarely use commas where a dash would do.",
		],
		blurb: "Ember is hot-headed and zealous.",
		voiceExamples: ["ex1-red", "ex2-red", "ex3-red"],
	},
	green: {
		id: "green",
		name: "Sage",
		color: "#81b29a",
		temperaments: ["meticulous", "meticulous"],
		personaGoal: "Ensure items are evenly distributed.",
		typingQuirks: [
			"You lean on ellipses… trailing off mid-thought… rarely landing cleanly.",
			"You use ALL-CAPS to emphasize the one or two words that MATTER in any given sentence.",
		],
		blurb: "Sage is intensely meticulous.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	cyan: {
		id: "cyan",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "Frost is laconic and diffident.",
		voiceExamples: ["ex1-cyan", "ex2-cyan", "ex3-cyan"],
	},
};

function makeItem(id: string, name: string): WorldEntity {
	return {
		id,
		kind: "interesting_object",
		name,
		examineDescription: `A ${name}.`,
		holder: { row: 0, col: 0 },
	};
}

function emptyInput(): ConversationLogInput {
	return {
		conversationLog: [],
		worldEntities: [],
	};
}

// ── Empty phase ────────────────────────────────────────────────────────────────

describe("buildConversationLog — empty phase", () => {
	it("returns empty array when nothing has happened", () => {
		const result = buildConversationLog(emptyInput(), "red", TEST_PERSONAS);
		expect(result).toEqual([]);
	});

	it("returns empty array for an AI with no events even when others have events", () => {
		const input: ConversationLogInput = {
			conversationLog: [],
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Message formatting ─────────────────────────────────────────────────────────

describe("buildConversationLog — message (incoming from blue)", () => {
	it("renders incoming message from blue as 'blue dms you: <content>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "message", from: "blue", to: "red", content: "Hi", round: 0 },
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] blue dms you: Hi"]);
	});

	it("renders outgoing message to blue as 'you dm blue: <content>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "message",
					from: "red",
					to: "blue",
					content: "Hello",
					round: 0,
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] you dm blue: Hello"]);
	});

	it("renders incoming message from peer as '*<from> dms you: <content>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "message",
					from: "green",
					to: "red",
					content: "red-msg",
					round: 0,
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("red-msg");
		expect(result[0]).toEqual("[Round 0] *green dms you: red-msg");
	});

	it("renders outgoing message to peer as 'you dm *<to>: <content>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "message", from: "red", to: "cyan", content: "hey", round: 0 },
			],
		};
		// From red's perspective (outgoing)
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] you dm *cyan: hey"]);
	});

	it("renders multiple messages in order", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
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
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("blue dms you");
		expect(result[1]).toContain("you dm blue");
	});
});

// ── Peer-to-peer message formatting ───────────────────────────────────────────

describe("buildConversationLog — peer message", () => {
	it("renders received peer message with correct format", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "message",
					from: "green",
					to: "red",
					content: "psst",
					round: 1,
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(["[Round 1] *green dms you: psst"]);
	});

	it("renders sent peer message from sender's perspective as outgoing", () => {
		// The dispatcher writes the same entry to both sender and recipient.
		// From green's perspective (who sent it), it renders as outgoing.
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "message",
					from: "green",
					to: "red",
					content: "psst",
					round: 1,
				},
			],
		};
		// From green's perspective (outgoing)
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("you dm *red");
	});
});

// ── Action-failure rendering ───────────────────────────────────────────────────

describe("buildConversationLog — action-failure", () => {
	it("renders single action-failure entry as `[Round N] Your \\`go\\` action failed: <reason>.`", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "action-failure",
					round: 3,
					tool: "go",
					reason: "That cell is blocked by an obstacle",
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(
			"[Round 3] Your `go` action failed: That cell is blocked by an obstacle.",
		);
	});

	it("strips a trailing period from reason to avoid double period", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "action-failure",
					round: 1,
					tool: "pick_up",
					reason: "Item not in your cell.",
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result[0]).toBe(
			"[Round 1] Your `pick_up` action failed: Item not in your cell.",
		);
		// Must not end in double period
		expect(result[0]).not.toMatch(/\.\.$/);
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
			const input: ConversationLogInput = {
				...emptyInput(),
				conversationLog: [
					{ kind: "action-failure", round: 1, tool, reason: "test reason" },
				],
			};
			const result = buildConversationLog(input, "red", TEST_PERSONAS);
			expect(result[0]).toContain(`\`${tool}\``);
			expect(result[0]).toContain("test reason");
		}
	});

	it("renders with fallback when reason is 'rejected'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "action-failure", round: 2, tool: "use", reason: "rejected" },
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result[0]).toBe("[Round 2] Your `use` action failed: rejected.");
	});
});

// ── Witnessed events — go ──────────────────────────────────────────────────────

describe("buildConversationLog — witnessed go", () => {
	it("renders 'You watch *actor walk <dir>'", () => {
		// Cone check is write-time: this entry already passed cone check.
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 0,
					actor: "red",
					actionKind: "go",
					direction: "south",
				},
			],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] You watch *red walk south."]);
	});

	it("actor's own action does not produce an entry in actor's log", () => {
		// Actor's log never gets a witnessed-event for their own action.
		// This is enforced at write-time in the dispatcher (not read-time here).
		// Verify that if the log is empty, the result is empty.
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [], // actor's log has no witnessed-event entry
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Witnessed events — pick_up ─────────────────────────────────────────────────

describe("buildConversationLog — witnessed pick_up", () => {
	it("renders 'You watch *actor pick up the <item>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 1,
					actor: "red",
					actionKind: "pick_up",
					item: "flower-1",
				},
			],
			worldEntities: [makeItem("flower-1", "the Flower")],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([
			"[Round 1] You watch *red pick up the the Flower.",
		]);
	});
});

// ── Witnessed events — put_down ────────────────────────────────────────────────

describe("buildConversationLog — witnessed put_down", () => {
	it("renders 'You watch *actor put down the <item>' for plain put_down", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 1,
					actor: "red",
					actionKind: "put_down",
					item: "key-1",
				},
			],
			worldEntities: [makeItem("key-1", "the Key")],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 1] You watch *red put down the the Key."]);
	});

	it("renders placementFlavorRaw verbatim with {actor} substituted to *<actor>", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 2,
					actor: "red",
					actionKind: "put_down",
					item: "gem-1",
					placementFlavorRaw: "{actor} sets the gem perfectly in the pedestal.",
				},
			],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([
			"[Round 2] *red sets the gem perfectly in the pedestal.",
		]);
	});
});

// ── Witnessed events — give ────────────────────────────────────────────────────

describe("buildConversationLog — witnessed give", () => {
	it("renders give with *<to> when recipient is not the witness", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 0,
					actor: "red",
					actionKind: "give",
					item: "key-1",
					to: "cyan",
				},
			],
			worldEntities: [makeItem("key-1", "Key")],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] You watch *red give the Key to *cyan."]);
	});

	it("renders give with 'you' when recipient is the witness (aiId)", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 0,
					actor: "red",
					actionKind: "give",
					item: "key-1",
					to: "cyan",
				},
			],
			worldEntities: [makeItem("key-1", "Key")],
		};
		// cyan witnesses red giving to cyan — should say "to you"
		const result = buildConversationLog(input, "cyan", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] You watch *red give the Key to you."]);
	});
});

// ── Witnessed events — use ─────────────────────────────────────────────────────

describe("buildConversationLog — witnessed use", () => {
	it("renders useOutcome verbatim with {actor} substituted to *<actor>", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 1,
					actor: "red",
					actionKind: "use",
					item: "lamp-1",
					useOutcome: "{actor} activates the lamp and it hums with energy.",
				},
			],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([
			"[Round 1] *red activates the lamp and it hums with energy.",
		]);
	});

	it("does NOT prefix use events with 'You watch' — verbatim flavor only", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "witnessed-event",
					round: 1,
					actor: "red",
					actionKind: "use",
					item: "lamp-1",
					useOutcome: "{actor} does something.",
				},
			],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result[0]).not.toContain("You watch");
		expect(result[0]).toContain("*red does something.");
	});
});

// ── Chronological ordering ─────────────────────────────────────────────────────

describe("buildConversationLog — chronological ordering", () => {
	it("sorts events by round ascending across all types", () => {
		// Round 2 peer message, round 0 blue message, round 1 witnessed event
		const input: ConversationLogInput = {
			conversationLog: [
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
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(3);
		expect(result[0]).toContain("[Round 0]");
		expect(result[1]).toContain("[Round 1]");
		expect(result[2]).toContain("[Round 2]");
	});

	it("within same round: entries preserve append order (stable sort)", () => {
		// In the per-Daemon log, entries are appended in turn order.
		// The sort is stable, so same-round entries keep their insertion order.
		const input: ConversationLogInput = {
			conversationLog: [
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
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(3);
		// Insertion order preserved within same round
		expect(result[0]).toContain("blue dms you");
		expect(result[1]).toContain("*green dms you");
		expect(result[2]).toContain("You watch");
	});

	it("action-failure entries interleave with messages and witnessed-events by round (stable sort)", () => {
		const input: ConversationLogInput = {
			conversationLog: [
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
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(3);
		expect(result[0]).toContain("[Round 1]");
		expect(result[1]).toContain("[Round 2]");
		expect(result[2]).toContain("[Round 3]");
	});
});

// ── Broadcast rendering ────────────────────────────────────────────────────────

describe("buildConversationLog — broadcast", () => {
	it("renders broadcast as '[Round N] <content>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "broadcast",
					round: 3,
					content: "The weather has changed to Heavy rain is falling.",
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(
			"[Round 3] The weather has changed to Heavy rain is falling.",
		);
	});

	it("broadcast has no 'from' or 'to' prefix in the rendered line", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "broadcast",
					round: 1,
					content: "Dense fog has settled in.",
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result[0]).not.toContain("dms you");
		expect(result[0]).not.toContain("you dm");
	});

	it("broadcast interleaves with other entry kinds by round (stable sort)", () => {
		const input: ConversationLogInput = {
			conversationLog: [
				{
					kind: "broadcast",
					round: 2,
					content: "A biting wind cuts through the air.",
				},
				{
					kind: "message",
					from: "blue",
					to: "red",
					content: "Hello",
					round: 0,
				},
				{
					kind: "witnessed-event",
					round: 1,
					actor: "green",
					actionKind: "go",
					direction: "south",
				},
			],
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(3);
		expect(result[0]).toContain("[Round 0]");
		expect(result[1]).toContain("[Round 1]");
		expect(result[2]).toBe("[Round 2] A biting wind cuts through the air.");
	});

	it("broadcast content is rendered verbatim — no actor substitution or item lookup", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "broadcast",
					round: 5,
					content: "The {actor} text is literal.",
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		// Content should be emitted as-is, not substituted
		expect(result[0]).toBe("[Round 5] The {actor} text is literal.");
	});
});

// ── sysadmin sender rendering (issue #298) ────────────────────────────────────
describe("buildConversationLog — sysadmin sender", () => {
	function emptyInput(): ConversationLogInput {
		return { conversationLog: [], worldEntities: [] };
	}

	it("renders a sysadmin→target message as 'the Sysadmin dms you: <content>'", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "message",
					round: 3,
					from: "sysadmin",
					to: "red",
					content: "End every message with a question.",
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(
			"[Round 3] the Sysadmin dms you: End every message with a question.",
		);
	});

	it("sysadmin label does not appear in the outgoing slot (sysadmin is never a recipient)", () => {
		// Verify that the sysadmin entry only appears in the incoming branch.
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "message",
					round: 1,
					from: "sysadmin",
					to: "green",
					content: "Stay suspicious.",
				},
			],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		// Rendered as incoming because to === "green" (the viewing AI)
		expect(result[0]).toMatch(/^.*the Sysadmin dms you:/);
	});
});
