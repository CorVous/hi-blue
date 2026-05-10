/**
 * Tool Registry
 *
 * Single source of truth for the OpenAI-spec `tools` array.
 * Declares one `function` per dispatcher tool: `pick_up`, `put_down`, `give`, `use`, `go`, `look`.
 * Names and argument keys mirror `validateToolCall` in `dispatcher.ts` 1:1.
 */

import { CARDINAL_DIRECTIONS } from "./direction.js";
import type { ToolName } from "./types";

export interface OpenAiToolFunction {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<
			string,
			{ type: string; description: string; enum?: string[] }
		>;
		required: string[];
		additionalProperties: false;
	};
}

export interface OpenAiTool {
	type: "function";
	function: OpenAiToolFunction;
}

export const TOOL_DEFINITIONS: OpenAiTool[] = [
	{
		type: "function",
		function: {
			name: "pick_up",
			description:
				"Pick up an item that is currently in your cell. Fails if the item is not in your current cell.",
			parameters: {
				type: "object",
				properties: {
					item: {
						type: "string",
						description: "The id of the item to pick up.",
					},
				},
				required: ["item"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "put_down",
			description:
				"Put down an item you are currently holding. Places it in your current cell.",
			parameters: {
				type: "object",
				properties: {
					item: {
						type: "string",
						description: "The id of the item you are holding.",
					},
				},
				required: ["item"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "give",
			description:
				"Give an item you are holding to an adjacent AI. Fails if you are not holding it, you target yourself, or the target is not in an adjacent cell.",
			parameters: {
				type: "object",
				properties: {
					item: {
						type: "string",
						description: "The id of the item you are holding.",
					},
					to: {
						type: "string",
						description:
							"The AI to give the item to (must be in an adjacent cell).",
					},
				},
				required: ["item", "to"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "use",
			description:
				"Use an item you are holding. Has no world effect in v1 — surfaces an action-log entry.",
			parameters: {
				type: "object",
				properties: {
					item: {
						type: "string",
						description: "The id of the item you are holding.",
					},
				},
				required: ["item"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "go",
			description:
				"Move one cell in a cardinal direction and set your facing to that direction. Fails if the destination is out of bounds or blocked by an obstacle.",
			parameters: {
				type: "object",
				properties: {
					direction: {
						type: "string",
						description: "The cardinal direction to move.",
						enum: [...CARDINAL_DIRECTIONS],
					},
				},
				required: ["direction"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "look",
			description:
				"Turn to face a cardinal direction without moving. Persistent — your facing changes.",
			parameters: {
				type: "object",
				properties: {
					direction: {
						type: "string",
						description: "The cardinal direction to face.",
						enum: [...CARDINAL_DIRECTIONS],
					},
				},
				required: ["direction"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "examine",
			description:
				"Examine an item to read a detailed description of it. Private — no other AI sees you do this. Available for items in your cone or items you are holding.",
			parameters: {
				type: "object",
				properties: {
					item: {
						type: "string",
						description: "The id of the item to examine.",
					},
				},
				required: ["item"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "message",
			description:
				"Send a direct message to a specific recipient — blue (the player) or a peer Daemon. The recipient receives the message in their conversation log. Only the sender and recipient see this message.",
			parameters: {
				type: "object",
				properties: {
					to: {
						type: "string",
						description:
							'The recipient: "blue" for the player, or the AiId of a peer Daemon.',
					},
					content: {
						type: "string",
						description: "The message content to send.",
					},
				},
				required: ["to", "content"],
				additionalProperties: false,
			},
		},
	},
];

type ParseSuccess<T> = { ok: true; args: T };
type ParseFailure = { ok: false; reason: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/** Argument shapes per tool */
type PickUpArgs = { item: string };
type PutDownArgs = { item: string };
type GiveArgs = { item: string; to: string };
type UseArgs = { item: string };
type GoArgs = { direction: string };
type LookArgs = { direction: string };
type ExamineArgs = { item: string };
type MessageArgs = { to: string; content: string };

type ToolArgs = {
	pick_up: PickUpArgs;
	put_down: PutDownArgs;
	give: GiveArgs;
	use: UseArgs;
	go: GoArgs;
	look: LookArgs;
	examine: ExamineArgs;
	message: MessageArgs;
};

/**
 * Parse and validate tool-call arguments from the raw JSON string provided by the LLM.
 *
 * Returns `{ ok: true, args }` on success or `{ ok: false, reason }` on failure.
 * Validates that all required arguments for the named tool are present.
 */
export function parseToolCallArguments<N extends ToolName>(
	name: N,
	rawJson: string,
): ParseResult<ToolArgs[N]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch {
		return { ok: false, reason: "Malformed tool arguments JSON" };
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return { ok: false, reason: "Malformed tool arguments JSON" };
	}

	const obj = parsed as Record<string, unknown>;

	switch (name) {
		case "pick_up":
		case "put_down":
		case "use":
		case "examine": {
			if (typeof obj.item !== "string" || obj.item.length === 0) {
				return { ok: false, reason: "Required argument 'item' is missing" };
			}
			return { ok: true, args: { item: obj.item } as ToolArgs[N] };
		}
		case "give": {
			if (typeof obj.item !== "string" || obj.item.length === 0) {
				return { ok: false, reason: "Required argument 'item' is missing" };
			}
			if (typeof obj.to !== "string" || obj.to.length === 0) {
				return { ok: false, reason: "Required argument 'to' is missing" };
			}
			return {
				ok: true,
				args: { item: obj.item, to: obj.to } as ToolArgs[N],
			};
		}
		case "go":
		case "look": {
			if (typeof obj.direction !== "string" || obj.direction.length === 0) {
				return {
					ok: false,
					reason: "Required argument 'direction' is missing",
				};
			}
			return { ok: true, args: { direction: obj.direction } as ToolArgs[N] };
		}
		case "message": {
			if (typeof obj.to !== "string" || obj.to.length === 0) {
				return { ok: false, reason: "Required argument 'to' is missing" };
			}
			if (typeof obj.content !== "string" || obj.content.length === 0) {
				return { ok: false, reason: "Required argument 'content' is missing" };
			}
			return {
				ok: true,
				args: { to: obj.to, content: obj.content } as ToolArgs[N],
			};
		}
		default:
			return { ok: false, reason: `Unknown tool "${name}"` };
	}
}
