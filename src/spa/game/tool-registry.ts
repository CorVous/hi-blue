/**
 * Tool Registry
 *
 * Single source of truth for the OpenAI-spec `tools` array.
 * Declares one `function` per dispatcher tool: `pick_up`, `put_down`, `give`, `use`.
 * Names and argument keys mirror `validateToolCall` in `dispatcher.ts` 1:1.
 */

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
				"Pick up an item that is currently in the room. Fails if you are already holding it or it is held by another AI.",
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
				"Put down an item you are currently holding. Places it in the room.",
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
				"Give an item you are holding to another AI. Fails if you are not holding it or you target yourself.",
			parameters: {
				type: "object",
				properties: {
					item: {
						type: "string",
						description: "The id of the item you are holding.",
					},
					to: {
						type: "string",
						enum: ["red", "green", "blue"],
						description: "The AI to give the item to.",
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
];

type ParseSuccess<T> = { ok: true; args: T };
type ParseFailure = { ok: false; reason: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

/** Argument shapes per tool */
type PickUpArgs = { item: string };
type PutDownArgs = { item: string };
type GiveArgs = { item: string; to: string };
type UseArgs = { item: string };

type ToolArgs = {
	pick_up: PickUpArgs;
	put_down: PutDownArgs;
	give: GiveArgs;
	use: UseArgs;
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
		case "use": {
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
		default:
			return { ok: false, reason: `Unknown tool "${name}"` };
	}
}
