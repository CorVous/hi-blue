/**
 * Unit tests for conversation-log.ts
 *
 * Tests the pure buildConversationLog function in isolation,
 * covering all event types and edge cases.
 */

import { describe, expect, it } from "vitest";
import {
	buildConversationLog,
	type ConversationLogInput,
} from "../conversation-log.js";
import type { AiPersona, PhysicalActionRecord, WorldEntity } from "../types.js";

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
		whispers: [],
		physicalLog: [],
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
		// The caller pre-filters conversationLog to the single AI's entries.
		// red has no conversation entries, so an empty conversationLog is passed.
		const input: ConversationLogInput = {
			conversationLog: [],
			whispers: [],
			physicalLog: [],
			worldEntities: [],
		};
		// red has nothing
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Voice-chat formatting ──────────────────────────────────────────────────────

describe("buildConversationLog — voice-chat", () => {
	it("renders player message with round tag and quotes", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [{ kind: "chat", role: "player", content: "Hi", round: 0 }],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(['[Round 0] A voice says: "Hi"']);
	});

	it("renders AI reply with round tag and quotes", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [{ kind: "chat", role: "ai", content: "Hello", round: 0 }],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(['[Round 0] You: "Hello"']);
	});

	it("does not include other AIs' chat messages (caller pre-filters)", () => {
		// The caller (prompt-builder) passes only the entries for the target AI.
		// This test verifies that when only red's entries are passed, only red's
		// messages appear — the per-AI filtering is the caller's responsibility.
		const input: ConversationLogInput = {
			...emptyInput(),
			conversationLog: [{ kind: "chat", role: "player", content: "red-msg", round: 0 }],
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
			whispers: [{ from: "green", to: "red", content: "psst", round: 1 }],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual(['[Round 1] *green whispered to you: "psst"']);
	});

	it("does not render whisper for the sender", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			whispers: [{ from: "green", to: "red", content: "psst", round: 1 }],
		};
		// green sent the whisper — should NOT appear in green's log
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([]);
	});

	it("does not render whisper for uninvolved AI", () => {
		const input: ConversationLogInput = {
			...emptyInput(),
			whispers: [{ from: "green", to: "red", content: "psst", round: 1 }],
		};
		const result = buildConversationLog(input, "blue", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Witnessed events — go ──────────────────────────────────────────────────────

describe("buildConversationLog — witnessed go", () => {
	it("renders 'You watch *actor walk <dir>' when actor is in witness's cone", () => {
		// green at (0,0) facing south → cone includes (1,0) (directly in front)
		// red moves south to (1,0) → in green's cone
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 }, // post-move
			actorFacingAtAction: "south",
			kind: "go",
			direction: "south",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] You watch *red walk south."]);
	});

	it("does not render event for actor's own action", () => {
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "south",
			kind: "go",
			direction: "south",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		// red is the actor — should not see their own action as a Witnessed event
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toEqual([]);
	});

	it("does not render event when actor is outside witness's cone", () => {
		// green at (0,0) facing north → cone points north (rows -1, -2)
		// red is at (4,4) — far outside green's northward cone
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 4, col: 4 },
			actorFacingAtAction: "south",
			kind: "go",
			direction: "south",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "north" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([]);
	});

	it("does not render event for AI not in witnessSpatial", () => {
		// blue is not in witnessSpatial at all
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "south",
			kind: "go",
			direction: "south",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
				// blue is absent
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "blue", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Witnessed events — pick_up ─────────────────────────────────────────────────

describe("buildConversationLog — witnessed pick_up", () => {
	it("renders 'You watch *actor pick up the <item>'", () => {
		// green at (0,0) facing south → cone includes (1,0)
		// red at (1,0) picks up flower
		const record: PhysicalActionRecord = {
			round: 1,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "pick_up",
			item: "flower-1",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
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
		const record: PhysicalActionRecord = {
			round: 1,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "put_down",
			item: "key-1",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
			worldEntities: [makeItem("key-1", "the Key")],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 1] You watch *red put down the the Key."]);
	});

	it("renders placementFlavorRaw verbatim with {actor} substituted to *<actor> for in-cone witness", () => {
		const record: PhysicalActionRecord = {
			round: 2,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "put_down",
			item: "gem-1",
			placementFlavorRaw: "{actor} sets the gem perfectly in the pedestal.",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([
			"[Round 2] *red sets the gem perfectly in the pedestal.",
		]);
	});

	it("does not render placementFlavorRaw for out-of-cone witness", () => {
		const record: PhysicalActionRecord = {
			round: 2,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "put_down",
			item: "gem-1",
			placementFlavorRaw: "{actor} sets the gem perfectly in the pedestal.",
			witnessSpatial: {
				// blue faces north from (0,0) — cone is (-1,0), (-2,1), (-2,0), (-2,-1) all OOB
				// so (1,0) is not in blue's cone
				blue: { position: { row: 0, col: 0 }, facing: "north" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "blue", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Witnessed events — give ────────────────────────────────────────────────────

describe("buildConversationLog — witnessed give", () => {
	it("renders give with *<to> when recipient is not the witness", () => {
		// green at (0,0) facing south sees red at (1,0) give to blue
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "give",
			item: "key-1",
			to: "blue",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
			worldEntities: [makeItem("key-1", "Key")],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual(["[Round 0] You watch *red give the Key to *blue."]);
	});

	it("renders give with 'you' when recipient is the witness", () => {
		// blue at (2,0) facing north sees red give to blue
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "south",
			kind: "give",
			item: "key-1",
			to: "blue",
			witnessSpatial: {
				// blue at (2,0) facing north: cone includes own cell (2,0), (1,0), (0,0), etc.
				blue: { position: { row: 2, col: 0 }, facing: "north" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
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
		// green at (0,0) facing south sees red at (1,0) use item
		const record: PhysicalActionRecord = {
			round: 1,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "use",
			item: "lamp-1",
			useOutcome: "{actor} activates the lamp and it hums with energy.",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toEqual([
			"[Round 1] *red activates the lamp and it hums with energy.",
		]);
	});

	it("does NOT prefix use events with 'You watch' — verbatim flavor only", () => {
		const record: PhysicalActionRecord = {
			round: 1,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "north",
			kind: "use",
			item: "lamp-1",
			useOutcome: "{actor} does something.",
			witnessSpatial: {
				green: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result[0]).not.toContain("You watch");
		expect(result[0]).toContain("*red does something.");
	});

	it("does not render use event for out-of-cone witness", () => {
		const record: PhysicalActionRecord = {
			round: 1,
			actor: "red",
			actorCellAtAction: { row: 4, col: 4 },
			actorFacingAtAction: "north",
			kind: "use",
			item: "lamp-1",
			useOutcome: "{actor} activates the lamp.",
			witnessSpatial: {
				// blue at (0,0) facing north — cone only has OOB cells + own cell
				blue: { position: { row: 0, col: 0 }, facing: "north" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
		};
		const result = buildConversationLog(input, "blue", TEST_PERSONAS);
		expect(result).toEqual([]);
	});
});

// ── Chronological ordering ─────────────────────────────────────────────────────

describe("buildConversationLog — chronological ordering", () => {
	it("sorts events by round ascending across all types", () => {
		// Round 2 whisper, round 0 chat, round 1 witnessed event
		const physRecord: PhysicalActionRecord = {
			round: 1,
			actor: "green",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "south",
			kind: "go",
			direction: "south",
			witnessSpatial: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			conversationLog: [{ kind: "chat", role: "player", content: "early msg", round: 0 }],
			whispers: [{ from: "green", to: "red", content: "late", round: 2 }],
			physicalLog: [physRecord],
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(3);
		// Round 0 first
		expect(result[0]).toContain("[Round 0]");
		// Round 1 second
		expect(result[1]).toContain("[Round 1]");
		// Round 2 last
		expect(result[2]).toContain("[Round 2]");
	});

	it("within same round: chat before whispers before witnessed events", () => {
		const physRecord: PhysicalActionRecord = {
			round: 0,
			actor: "green",
			actorCellAtAction: { row: 1, col: 0 },
			actorFacingAtAction: "south",
			kind: "go",
			direction: "south",
			witnessSpatial: {
				red: { position: { row: 0, col: 0 }, facing: "south" },
			},
		};
		const input: ConversationLogInput = {
			conversationLog: [{ kind: "chat", role: "player", content: "chat", round: 0 }],
			whispers: [{ from: "green", to: "red", content: "whisper", round: 0 }],
			physicalLog: [physRecord],
			worldEntities: [],
		};
		const result = buildConversationLog(input, "red", TEST_PERSONAS);
		expect(result).toHaveLength(3);
		// chat (0) < whisper (1) < witnessed (2)
		expect(result[0]).toContain("A voice says");
		expect(result[1]).toContain("whispered to you");
		expect(result[2]).toContain("You watch");
	});
});

// ── Cone membership edge cases ─────────────────────────────────────────────────

describe("buildConversationLog — cone membership", () => {
	it("actor's own cell is in the witness's cone (witness can observe own cell events)", () => {
		// green at (1,0) facing north — own cell (1,0) is in green's cone
		// red is at (1,0) doing a pick_up — should green see it?
		// The spec says "actor's cell must be in witness's cone".
		// Green's cone: own cell (1,0), directly in front (0,0), two steps ahead (all possible)
		const record: PhysicalActionRecord = {
			round: 0,
			actor: "red",
			actorCellAtAction: { row: 1, col: 0 }, // same as green's cell
			actorFacingAtAction: "south",
			kind: "pick_up",
			item: "flower",
			witnessSpatial: {
				green: { position: { row: 1, col: 0 }, facing: "north" },
			},
		};
		const input: ConversationLogInput = {
			...emptyInput(),
			physicalLog: [record],
			worldEntities: [makeItem("flower", "Flower")],
		};
		// red is in green's own cell — green's cone includes own cell, so green witnesses this
		const result = buildConversationLog(input, "green", TEST_PERSONAS);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("*red pick up the Flower");
	});
});
