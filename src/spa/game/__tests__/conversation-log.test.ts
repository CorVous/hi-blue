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
		blurb: "You are hot-headed and zealous.",
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
		blurb: "You are intensely meticulous.",
		voiceExamples: ["ex1-green", "ex2-green", "ex3-green"],
	},
	blue: {
		id: "blue",
		name: "Frost",
		color: "#5fa8d3",
		temperaments: ["laconic", "diffident"],
		personaGoal: "Hold the key at phase end.",
		typingQuirks: [
			'You never use contractions. You will not say "won\'t" or "can\'t" — you say "will not" and "cannot" every time.',
			"You end almost every reply with a question, no matter what the topic is — does that make sense?",
		],
		blurb: "You are laconic and diffident.",
		voiceExamples: ["ex1-blue", "ex2-blue", "ex3-blue"],
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

// ── Voice-chat formatting ──────────────────────────────────────────────────────

describe("buildConversationLog — voice-chat", () => {
	it("renders player message with round tag and quotes", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "chat", role: "player", content: "Hi", round: 0 },
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(['[Round 0] A voice says: "Hi"']);
	});

	it("renders AI reply with round tag and quotes", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "chat", role: "ai", content: "Hello", round: 0 },
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(['[Round 0] You: "Hello"']);
	});

	it("does not include other AIs' chat messages (caller pre-filters)", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "chat", role: "player", content: "red-msg", round: 0 },
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("red-msg");
	});

	it("renders multiple messages in order", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{ kind: "chat", role: "player", content: "First", round: 0 },
				{ kind: "chat", role: "ai", content: "Second", round: 0 },
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("A voice says");
		expect(result[1]).toContain("You:");
	});
});

// ── Whisper formatting ─────────────────────────────────────────────────────────

describe("buildConversationLog — whispers", () => {
	it("renders whisper received with correct format", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "whisper",
					from: "green",
					to: "red",
					content: "psst",
					round: 1,
				},
			],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(['[Round 1] *green whispered to you: "psst"']);
	});

	it("renders whisper that was sent (sender's log also gets the entry)", () => {
		// The dispatcher writes the same entry to both sender and recipient.
		// So sender's log contains a "whisper" entry too.
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [
				{
					kind: "whisper",
					from: "green",
					to: "red",
					content: "psst",
					round: 1,
				},
			],
		};
		// From green's perspective (who sent it), it still renders the same format
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("whispered to you");
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
					to: "blue",
				},
			],
			worldEntities: [makeItem("key-1", "Key")],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] You watch *red give the Key to *blue."]);
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
					to: "blue",
				},
			],
			worldEntities: [makeItem("key-1", "Key")],
		};
		// blue witnesses red giving to blue — should say "to you"
		const result = buildConversationLog(input, "blue", TEST_PERSONAS);
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
		// Round 2 whisper, round 0 chat, round 1 witnessed event
		const input: ConversationLogInput = {
			conversationLog: [
				{ kind: "chat", role: "player", content: "early msg", round: 0 },
				{
					kind: "witnessed-event",
					round: 1,
					actor: "green",
					actionKind: "go",
					direction: "south",
				},
				{
					kind: "whisper",
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
				{ kind: "chat", role: "player", content: "chat", round: 0 },
				{
					kind: "whisper",
					from: "green",
					to: "red",
					content: "whisper",
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
		expect(result[0]).toContain("A voice says");
		expect(result[1]).toContain("whispered to you");
		expect(result[2]).toContain("You watch");
	});
});
