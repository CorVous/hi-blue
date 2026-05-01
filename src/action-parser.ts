import type { AiId, AiTurnAction } from "./types";

const WHISPER_RE = /^\[whisper:(\w+)\]\s*/i;
const PASS_RE = /^\[pass\]$/i;

/**
 * Parses a raw LLM string output into a structured AiTurnAction.
 *
 * Convention:
 *   - "[WHISPER:<target>] <content>" → whisper to target AI
 *   - "[PASS]" or empty string       → pass
 *   - anything else                  → chat to player
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

	return { aiId, chat: { target: "player", content: trimmed } };
}
