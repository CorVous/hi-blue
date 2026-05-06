import { parseFirstMention } from "./mention-parser.js";
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
 *   addressed AI is not chat-locked.
 */
export function deriveComposerState(input: ComposerInput): ComposerState {
	const { text, lockouts, personaNamesToId } = input;
	const addressee = parseFirstMention(text, personaNamesToId);
	const sendEnabled =
		addressee !== null && lockouts.get(addressee) !== true;
	return { addressee, sendEnabled };
}
