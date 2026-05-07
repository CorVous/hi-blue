import type { AiId } from "./types.js";

/**
 * Result of a successful mention parse — includes the AiId and the character
 * offsets of the `@Name` token (excluding any leading whitespace captured by
 * the regex but including the `@`).
 */
export interface MentionMatch {
	aiId: AiId;
	/** Index of the `@` character in `text`. */
	start: number;
	/** End of `@Name` (excludes any trailing punctuation). Use this for the highlight range. */
	nameEnd: number;
	/** One past the last consumed character: end of name, or end of a single trailing punctuation char if one immediately follows. */
	end: number;
}

/**
 * Like `parseFirstMention` but also returns the position of the `@Name`
 * token so callers can compute what text surrounds the mention.
 *
 * Rules (same as `parseFirstMention`):
 * - "@Name" must be preceded by start-of-string or whitespace.
 * - A single trailing punctuation character immediately after the name is
 *   consumed into the token (included in `end`) so it is excluded from the
 *   body-after-mention computation.
 * - Case-insensitive, first mention wins.
 */
export function findFirstMention(
	text: string,
	personaNamesToId: ReadonlyMap<string, AiId>,
): MentionMatch | null {
	const re = /(?:^|\s)@([A-Za-z][A-Za-z0-9]*)/g;
	for (const match of text.matchAll(re)) {
		const raw = match[1];
		if (!raw) continue;
		const id = personaNamesToId.get(raw.toLowerCase());
		if (id !== undefined) {
			// match.index is the start of the full match (may include a leading space).
			// The `@` is at match.index + (full-match-length - raw.length - 1).
			const fullMatch = match[0];
			const start = (match.index ?? 0) + fullMatch.length - raw.length - 1;
			const nameEnd = start + 1 + raw.length; // 1 for '@', excludes trailing punct
			let end = nameEnd;
			// Consume a single trailing punctuation character immediately after the
			// name so that "@Sage," treats the comma as part of the token and the
			// body-after-mention computation does not surface bare punctuation.
			if (/[.,!?;:]/.test(text[end] ?? "")) {
				end += 1;
			}
			return { aiId: id, start, nameEnd, end };
		}
	}
	return null;
}

/**
 * Parses the first valid @mention from `text` that maps to a known persona.
 *
 * Rules:
 * - "@Name" must be preceded by start-of-string or whitespace.
 * - "@Name" terminates at end-of-string, whitespace, or a single trailing
 *   punctuation character (the punctuation is not part of the name).
 * - Case-insensitive.
 * - First mention wins.
 * - "@Nonpersona" or "@" alone returns null.
 * - "user@host" style does NOT match (no preceding whitespace).
 */
export function parseFirstMention(
	text: string,
	personaNamesToId: ReadonlyMap<string, AiId>,
): AiId | null {
	return findFirstMention(text, personaNamesToId)?.aiId ?? null;
}

/**
 * Applies an addressee change to the composer text by either rewriting an
 * existing first mention in-place or prepending a new mention.
 *
 * Rules:
 * a. If a valid first mention is found, rewrite it with the target persona's
 *    name. Cursor delta is applied based on position relative to the mention.
 * b. If no valid mention is found, prepend "@<name> " to the text.
 *    Cursor shifts by the prefix length.
 */
export function applyAddresseeChange({
	text,
	selectionStart,
	targetPersona,
	personaNamesToId,
	personas,
}: {
	text: string;
	selectionStart: number | null;
	targetPersona: AiId;
	personaNamesToId: ReadonlyMap<string, AiId>;
	personas: Record<AiId, { name: string }>;
}): { text: string; selectionStart: number } {
	const re = /(?:^|\s)@([A-Za-z][A-Za-z0-9]*)/g;
	let foundAtStart = -1;
	let foundNameEnd = -1;

	for (const match of text.matchAll(re)) {
		const raw = match[1];
		if (!raw) continue;
		// Strip a single trailing punctuation character if present.
		const name = /[.,!?;:]$/.test(raw) ? raw.slice(0, -1) : raw;
		const id = personaNamesToId.get(name.toLowerCase());
		if (id !== undefined) {
			// matchIndex is the start of the full match (which may include a
			// leading space). The @ is immediately after any leading whitespace.
			const matchIndex = match.index ?? 0;
			const atStart =
				matchIndex + (match[0].startsWith("@") ? 0 : match[0].indexOf("@"));
			// nameEnd is the index after the raw capture (before trailing punct).
			const nameEnd = atStart + 1 + name.length;
			foundAtStart = atStart;
			foundNameEnd = nameEnd;
			break;
		}
	}

	if (foundAtStart !== -1) {
		// Rewrite in place.
		const newName = personas[targetPersona].name;
		const atStart = foundAtStart;
		const nameEnd = foundNameEnd;
		const newText = `${text.slice(0, atStart)}@${newName}${text.slice(nameEnd)}`;
		const delta = 1 + newName.length - (nameEnd - atStart);

		let newCursor: number;
		if (selectionStart === null) {
			newCursor = newText.length;
		} else if (selectionStart <= atStart) {
			newCursor = selectionStart;
		} else if (selectionStart >= nameEnd) {
			newCursor = selectionStart + delta;
		} else {
			// Cursor inside the mention → move to end of new name.
			newCursor = atStart + 1 + newName.length;
		}

		return { text: newText, selectionStart: newCursor };
	} else {
		// Prepend.
		const newName = personas[targetPersona].name;
		const prefix = `@${newName} `;
		const newText = prefix + text;
		const cursor = (selectionStart ?? 0) + prefix.length;
		return { text: newText, selectionStart: cursor };
	}
}

/**
 * Builds a lowercased name → AiId map from a personas record.
 */
export function buildPersonaNameMap(
	personas: Record<AiId, { name: string }>,
): Map<string, AiId> {
	const map = new Map<string, AiId>();
	for (const [id, persona] of Object.entries(personas) as [
		AiId,
		{ name: string },
	][]) {
		map.set(persona.name.toLowerCase(), id);
	}
	return map;
}

/**
 * Builds an AiId → color string map from a personas record.
 * Color values are sourced from the persona's `color` field (not the AiId key),
 * so a future palette swap only requires persona-record updates, not JS changes.
 */
export function buildPersonaColorMap(
	personas: Record<AiId, { color: string }>,
): Map<AiId, string> {
	const map = new Map<AiId, string>();
	for (const [id, persona] of Object.entries(personas) as [
		AiId,
		{ color: string },
	][]) {
		map.set(id, persona.color);
	}
	return map;
}
