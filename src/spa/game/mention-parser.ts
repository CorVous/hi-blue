import type { AiId } from "./types.js";

/** Shape returned by findFirstMention — includes range info for the overlay. */
export interface MentionMatch {
	aiId: AiId;
	/** Start index of "@Name" in the text (inclusive). */
	start: number;
	/** End index of "@Name" in the text (exclusive). Trailing punctuation excluded. */
	end: number;
}

/**
 * Finds the first valid @mention from `text` that maps to a known persona,
 * returning both the resolved AiId and the character range [start, end).
 *
 * Rules:
 * - "@Name" must be preceded by start-of-string or whitespace.
 * - "@Name" terminates at end-of-string, whitespace, or a single trailing
 *   punctuation character (the punctuation is not part of the range).
 * - Case-insensitive.
 * - First mention wins.
 * - "@Nonpersona" or "@" alone returns null.
 * - "user@host" style does NOT match (no preceding whitespace).
 */
export function findFirstMention(
	text: string,
	personaNamesToId: ReadonlyMap<string, AiId>,
): MentionMatch | null {
	const re = /(?:^|\s)@([A-Za-z][A-Za-z0-9]*)/g;
	for (const match of text.matchAll(re)) {
		const raw = match[1];
		if (!raw) continue;
		// Strip a single trailing punctuation character if present.
		const name = /[.,!?;:]$/.test(raw) ? raw.slice(0, -1) : raw;
		const id = personaNamesToId.get(name.toLowerCase());
		if (id !== undefined) {
			// matchAll always populates match.index for each result.
			const matchIndex = match.index ?? 0;
			const start = matchIndex + match[0].indexOf("@");
			const end = start + 1 + name.length;
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

/**
 * Builds an AiId → color string map from a personas record.
 * The color value is returned verbatim from the persona record.
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
