import type { AiId } from "./types.js";

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
	const re = /(?:^|\s)@([A-Za-z][A-Za-z0-9]*)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const raw = match[1];
		if (!raw) continue;
		// Strip a single trailing punctuation character if present.
		const name = /[.,!?;:]$/.test(raw) ? raw.slice(0, -1) : raw;
		const id = personaNamesToId.get(name.toLowerCase());
		if (id !== undefined) return id;
	}
	return null;
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
