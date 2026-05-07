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
			let end = start + 1 + raw.length; // 1 for '@'
			// Consume a single trailing punctuation character immediately after the
			// name so that "@Sage," treats the comma as part of the token and the
			// body-after-mention computation does not surface bare punctuation.
			if (/[.,!?;:]/.test(text[end] ?? "")) {
				end += 1;
			}
			return { aiId: id, start, end };
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
