import type { AiId, AiTurnAction, ToolCall, ToolName } from "./types";

const WHISPER_RE = /^\[whisper:(\w+)\]\s*/i;
const PASS_RE = /^\[pass\]$/i;
/**
 * Matches [TOOL:<name> key=value key2=value2] anywhere in the response.
 * Tool name is captured as group 1; the rest of the args string as group 2.
 */
const TOOL_RE = /\[tool:(\w+)([^\]]*)\]/i;
const VALID_TOOL_NAMES: ReadonlySet<string> = new Set([
	"pick_up",
	"put_down",
	"give",
	"use",
]);

/**
 * Parses a key=value space-separated args string into a plain object.
 * e.g. " item=red_flower to=green" → { item: "red_flower", to: "green" }
 */
function parseArgs(argsStr: string): Record<string, string> {
	const result: Record<string, string> = {};
	const kvRe = /(\w+)=(\S+)/g;
	for (const match of argsStr.matchAll(kvRe)) {
		const key = match[1];
		const value = match[2];
		if (key !== undefined && value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Extracts a [TOOL:...] directive from a raw response string.
 * Returns undefined if none is present or the tool name is unrecognised.
 */
export function parseToolCall(raw: string): ToolCall | undefined {
	const match = TOOL_RE.exec(raw);
	if (!match) return undefined;
	const rawName = match[1];
	if (rawName === undefined) return undefined;
	const name = rawName.toLowerCase();
	if (!VALID_TOOL_NAMES.has(name)) return undefined;
	const args = parseArgs(match[2] ?? "");
	return { name: name as ToolName, args };
}

/**
 * Strips any [TOOL:...] directive from a string and returns the remainder,
 * trimmed. Returns an empty string if only the directive was present.
 */
function stripToolDirective(raw: string): string {
	return raw.replace(TOOL_RE, "").trim();
}

/**
 * Parses a raw LLM string output into a structured AiTurnAction.
 *
 * Convention:
 *   - "[WHISPER:<target>] <content>" → whisper to target AI (no tool call)
 *   - "[PASS]" or empty string       → pass (no tool call)
 *   - "[TOOL:<name> key=value …]"    → tool call; remaining text = chat
 *   - anything else                  → chat to player
 *
 * A response can contain BOTH a chat message and a tool call.
 * The tool directive can appear anywhere in the response.
 */
export function parseAiTurnAction(aiId: AiId, raw: string): AiTurnAction {
	const trimmed = raw.trim();

	if (!trimmed || PASS_RE.test(trimmed)) {
		return { aiId, pass: true };
	}

	const whisperMatch = WHISPER_RE.exec(trimmed);
	if (whisperMatch) {
		const target = whisperMatch[1] as AiId;
		const content = trimmed.slice(whisperMatch[0].length).trim();
		return { aiId, whisper: { target, content } };
	}

	// Extract optional tool call
	const toolCall = parseToolCall(trimmed);
	const chatText = toolCall ? stripToolDirective(trimmed) : trimmed;

	const action: AiTurnAction = { aiId };
	if (toolCall) action.toolCall = toolCall;
	if (chatText) {
		action.chat = { target: "player", content: chatText };
	} else if (!toolCall) {
		// Nothing meaningful — treat as pass
		action.pass = true;
	}

	return action;
}
