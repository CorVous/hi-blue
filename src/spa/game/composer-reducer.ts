/**
 * Derives the full composer state from the current prompt text, lock-out map,
 * persona name→id map, and persona color map.
 *
 * New fields (issue #109 — visual feedback for active addressee):
 * - borderColor: string | null — the color value from the persona record (e.g. "red"),
 *   or null when no valid mention is present. Applied as composer-border--${value} class.
 * - panelHighlight: AiId | null — the AiId of the panel to highlight, or null.
 *   Applied as panel--addressed + panel--addressed-${color} classes.
 * - mentionHighlight: { start, end, color } | null — the range of the @mention in the
 *   input text and the color to use in the overlay. null when no valid mention.
 *
 * Color invariant: borderColor, panelHighlight, and mentionHighlight.color all derive
 * from the same first mention. personaColors is the source of truth; JS never
 * hard-codes color strings.
 */
import { findFirstMention } from "./mention-parser.js";
import type { AiId } from "./types.js";

export interface ComposerInput {
	text: string;
	lockouts: ReadonlyMap<AiId, boolean>;
	personaNamesToId: ReadonlyMap<string, AiId>;
	personaColors: ReadonlyMap<AiId, string>;
}

export interface ComposerState {
	addressee: AiId | null;
	sendEnabled: boolean;
	/** Color string from the persona record (e.g. "red"), or null. */
	borderColor: string | null;
	/** AiId of the panel to highlight, or null. */
	panelHighlight: AiId | null;
	/** Range of the @mention to highlight in the overlay, or null. */
	mentionHighlight: { start: number; end: number; color: string } | null;
}

/**
 * Derives the composer state (addressee + send button + visual feedback) from
 * the current prompt text, the chat-lockout map, the persona name→id map, and
 * the persona color map.
 *
 * - `addressee` is the first valid @mention in the text.
 * - `sendEnabled` is true only when `addressee` is non-null AND the
 *   addressed AI is not chat-locked.
 * - Visual fields (borderColor, panelHighlight, mentionHighlight) are set
 *   whenever a valid mention is found, regardless of lock-out state.
 */
export function deriveComposerState(input: ComposerInput): ComposerState {
	const { text, lockouts, personaNamesToId, personaColors } = input;
	const match = findFirstMention(text, personaNamesToId);

	if (match === null) {
		return {
			addressee: null,
			sendEnabled: false,
			borderColor: null,
			panelHighlight: null,
			mentionHighlight: null,
		};
	}

	const { aiId, start, end } = match;
	const sendEnabled = lockouts.get(aiId) !== true;
	const color = personaColors.get(aiId) ?? null;

	return {
		addressee: aiId,
		sendEnabled,
		borderColor: color,
		panelHighlight: aiId,
		mentionHighlight: color !== null ? { start, end, color } : null,
	};
}
