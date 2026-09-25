import { findFirstMention } from "./mention-parser.js";
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
	borderColor: string | null;
	panelHighlight: AiId | null;
	mentionHighlight: { start: number; end: number; color: string } | null;
	lockoutError: string | null;
	lockedPanels: ReadonlySet<AiId>;
}

function lockoutErrorText(persona: { name: string }): string {
	return `${persona.name} isn't reading right now`;
}

const NULL_VISUAL: Pick<
	ComposerState,
	"borderColor" | "panelHighlight" | "mentionHighlight"
> = {
	borderColor: null,
	panelHighlight: null,
	mentionHighlight: null,
};

export function deriveComposerState(input: ComposerInput): ComposerState {
	const {
		text,
		lockouts,
		personaNamesToId,
		personaColors,
		personaDisplayNames,
	} = input;

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
	const bodyAfterMention = (text.slice(0, start) + text.slice(end)).trim();
	const isAddresseeLocked = lockedPanels.has(addressee);
	const sendEnabled = !isAddresseeLocked && bodyAfterMention.length > 0;

	let lockoutError: string | null = null;
	if (isAddresseeLocked) {
		const displayName = personaDisplayNames.get(addressee);
		if (displayName !== undefined) {
			lockoutError = lockoutErrorText({ name: displayName });
		}
	}

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
