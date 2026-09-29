import { describe, expect, it } from "vitest";
import { renderEntry } from "../conversation-log.js";
import type { WorldEntity } from "../types.js";

function makeItem(id: string, name: string): WorldEntity {
	return {
		id,
		kind: "interesting_object",
		name,
		examineDescription: `A ${name}.`,
		holder: { row: 0, col: 0 },
	};
}

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
});

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
		expect(line).not.toMatch(/\.\.$/);
	});

	it("handles each in-scope tool name in the rendered line", () => {
		const tools = ["go", "message", "pick_up", "put_down", "use"] as const;
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

describe("renderEntry — witnessed go", () => {
	it("pins the step as a cardinal direction, never a relative one", () => {
		const relativeWords = ["forward", "back", "left", "right"];
		for (const direction of ["north", "south", "east", "west"] as const) {
			const line = renderEntry(
				{
					kind: "witnessed-event",
					round: 3,
					actor: "cyan",
					actionKind: "go",
					direction,
				},
				"green",
				[],
			);
			expect(line).toBe(`[Round 3] You watch *cyan walk ${direction}.`);
			for (const relative of relativeWords) {
				expect(line).not.toContain(relative);
			}
		}
	});

	it("falls back to a directionless line when a legacy entry carries no direction", () => {
		const line = renderEntry(
			{
				kind: "witnessed-event",
				round: 2,
				actor: "red",
				actionKind: "go",
			},
			"green",
			[],
		);
		expect(line).toBe("[Round 2] You watch *red move.");
	});
});

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
});

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
});
