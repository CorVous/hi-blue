import { findFirstMention } from "./mention-parser.js";
import { lockoutErrorText } from "./persona-display.js";
import type { AiId } from "./types.js";

export interface ComposerInput {
	text: string;
	lockouts: ReadonlyMap<AiId, boolean>;
	personaNamesToId: ReadonlyMap<string, AiId>;
	personaColors: ReadonlyMap<AiId, string>;
	personaDisplayNames: ReadonlyMap<AiId, string>;
}

export interface ComposerState {
	addressee: AiId | null;
	sendEnabled: boolean;
	/** Border color string for the composer input, or null when no addressee. */
	borderColor: string | null;
	/** AiId whose panel should carry the highlight class, or null. */
	panelHighlight: AiId | null;
	/** Highlight range for the first @mention in the overlay, or null. */
	mentionHighlight: { start: number; end: number; color: string } | null;
	/** Inline error message when the addressed AI is chat-locked, or null. */
	lockoutError: string | null;
	/** Set of AiIds currently chat-locked (panel muting). */
	lockedPanels: ReadonlySet<AiId>;
}

const NULL_VISUAL: Pick<
	ComposerState,
	"borderColor" | "panelHighlight" | "mentionHighlight"
> = {
	borderColor: null,
	panelHighlight: null,
	mentionHighlight: null,
};

/**
 * Derives the composer state (addressee + send button enabled + visual cues)
 * from the current prompt text, the chat-lockout map, and the persona maps.
 *
 * - `addressee` is the first valid @mention in the text.
 * - `sendEnabled` is true only when `addressee` is non-null AND the
 *   addressed AI is not chat-locked AND there is non-empty body text
 *   outside the mention token.
 * - `borderColor`, `panelHighlight`, `mentionHighlight` are populated whenever
 *   an addressee is identified — even when `sendEnabled` is false (locked
 *   addressees still get visual feedback).
 * - `lockedPanels` is a set of all currently chat-locked AiIds (for panel muting).
 * - `lockoutError` is the inline error string when the addressed AI is locked,
 *   or null when there is no addressee or addressee is not locked.
 */
export function deriveComposerState(input: ComposerInput): ComposerState {
	const { text, lockouts, personaNamesToId, personaColors, personaDisplayNames } =
		input;

	// Derive lockedPanels from the lockouts map (entries where locked === true).
	const lockedPanels: Set<AiId> = new Set();
	for (const [aiId, locked] of lockouts) {
		if (locked) lockedPanels.add(aiId);
	}

	const match = findFirstMention(text, personaNamesToId);
	if (match === null) {
		return {
			addressee: null,
			sendEnabled: false,
			...NULL_VISUAL,
			lockoutError: null,
			lockedPanels,
		};
	}

	const { aiId: addressee, start, nameEnd, end } = match;
	// Body is everything except the @Name token itself.
	const bodyAfterMention = (text.slice(0, start) + text.slice(end)).trim();
	const isAddresseeLocked = lockedPanels.has(addressee);
	const sendEnabled = !isAddresseeLocked && bodyAfterMention.length > 0;

	// Inline error: only set when addressee is locked.
	let lockoutError: string | null = null;
	if (isAddresseeLocked) {
		const displayName = personaDisplayNames.get(addressee);
		if (displayName !== undefined) {
			lockoutError = lockoutErrorText({ name: displayName });
		}
	}

	// Visual cues are populated regardless of sendEnabled.
	const color = personaColors.get(addressee) ?? null;
	const borderColor = color;
	const panelHighlight = addressee;
	const mentionHighlight =
		color != null ? { start, end: nameEnd, color } : null;

	return {
		addressee,
		sendEnabled,
		borderColor,
		panelHighlight,
		mentionHighlight,
		lockoutError,
		lockedPanels,
	};
}
