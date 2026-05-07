import { findFirstMention } from "./mention-parser.js";
import type { AiId } from "./types.js";

export interface ComposerInput {
	text: string;
	lockouts: ReadonlyMap<AiId, boolean>;
	personaNamesToId: ReadonlyMap<string, AiId>;
}

export interface ComposerState {
	addressee: AiId | null;
	sendEnabled: boolean;
}

/**
 * Derives the composer state (addressee + send button enabled) from the
 * current prompt text, the chat-lockout map, and the persona name→id map.
 *
 * - `addressee` is the first valid @mention in the text.
 * - `sendEnabled` is true only when `addressee` is non-null AND the
 *   addressed AI is not chat-locked AND there is non-empty body text
 *   outside the mention token.
 */
export function deriveComposerState(input: ComposerInput): ComposerState {
	const { text, lockouts, personaNamesToId } = input;
	const match = findFirstMention(text, personaNamesToId);
	if (match === null) return { addressee: null, sendEnabled: false };

	const { aiId: addressee, start, end } = match;
	// Body is everything except the @Name token itself.
	const bodyAfterMention = (text.slice(0, start) + text.slice(end)).trim();
	const sendEnabled =
		lockouts.get(addressee) !== true && bodyAfterMention.length > 0;
	return { addressee, sendEnabled };
}
