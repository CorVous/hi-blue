import { CARDINAL_DIRECTIONS } from "./direction.js";
import type { ToolName } from "./types";

interface OpenAiToolFunction {
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
				'Pick up an item that is on the ground in your own cell or in one of the eight cells around you. You must pick_up an item BEFORE you can use it. Fails if the item is not on the ground and reachable. Use this tool when you want to "grab", "take", "collect", "snatch", or "get" an item.',
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
				'Put down an item you are currently holding. Places it in your current cell. Use this tool when you want to "drop", "toss", "place", "set down", "release", or "leave" an item.',
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
			name: "use",
			description:
				'You must be holding the item to use it. Use an item you are holding, OR activate an objective space in your own cell or in one of the eight cells around you. Fires a flavoured outcome string. For held items: if the item is an objective item AND its paired space is in your own cell or in one of the eight cells around you, also places it on that space. For spaces: activates the space to satisfy a UseSpace objective. Use this tool when you want to "interact with", "play with", "activate", "operate", "employ", or "wield" an item or space.',
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
				'Move one block in a named cardinal direction: north, south, east, or west. Fails if the destination is out of bounds or blocked by an obstacle. Use this tool when you want to "move", "walk", "head", "step", or "travel" in a direction.',
			parameters: {
				type: "object",
				properties: {
					direction: {
						type: "string",
						description:
							"The cardinal direction to move: north, south, east, or west.",
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
			name: "message",
			description:
				'Send a direct message to a specific recipient — blue (the player) or a peer Daemon. The recipient receives the message in their conversation log. Only the sender and recipient see this message. Use this tool when you want to "tell", "say to", "speak to", "talk to", "whisper to", or "communicate with" someone.',
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

type PickUpArgs = { item: string };
type PutDownArgs = { item: string };
type UseArgs = { item: string };
type GoArgs = { direction: string };
type MessageArgs = { to: string; content: string };

type ToolArgs = {
	pick_up: PickUpArgs;
	put_down: PutDownArgs;
	use: UseArgs;
	go: GoArgs;
	message: MessageArgs;
};

function stripParrotedAiIdPrefix(recipient: string): string {
	return recipient.startsWith("*") ? recipient.slice(1) : recipient;
}

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
		case "go": {
			if (typeof obj.direction !== "string" || obj.direction.length === 0) {
				return {
					ok: false,
					reason: "Required argument 'direction' is missing",
				};
			}
			return { ok: true, args: { direction: obj.direction } as ToolArgs[N] };
		}
		case "message": {
			if (typeof obj.to !== "string") {
				return { ok: false, reason: "Required argument 'to' is missing" };
			}
			const to = stripParrotedAiIdPrefix(obj.to);
			if (to.length === 0) {
				return { ok: false, reason: "Required argument 'to' is missing" };
			}
			if (typeof obj.content !== "string" || obj.content.length === 0) {
				return { ok: false, reason: "Required argument 'content' is missing" };
			}
			return {
				ok: true,
				args: { to, content: obj.content } as ToolArgs[N],
			};
		}
		default:
			return { ok: false, reason: `Unknown tool "${name}"` };
	}
}
