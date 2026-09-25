import type { AiId } from "./types.js";

const MENTION_SIGIL = "*";
const MENTION_PATTERN = /(?:^|\s)\*([A-Za-z0-9]+)/g;
const TRAILING_PUNCTUATION = /[.,!?;:]/;
const ENDS_WITH_PUNCTUATION = /[.,!?;:]$/;

export interface MentionMatch {
	aiId: AiId;
	start: number;
	nameEnd: number;
	end: number;
}

export function findFirstMention(
	text: string,
	personaNamesToId: ReadonlyMap<string, AiId>,
): MentionMatch | null {
	for (const match of text.matchAll(MENTION_PATTERN)) {
		const mentionedName = match[1];
		if (!mentionedName) continue;
		const id = personaNamesToId.get(mentionedName.toLowerCase());
		if (id !== undefined) {
			const matchEnd = (match.index ?? 0) + match[0].length;
			const start = matchEnd - mentionedName.length - MENTION_SIGIL.length;
			const nameEnd = matchEnd;
			const end = TRAILING_PUNCTUATION.test(text[nameEnd] ?? "")
				? nameEnd + 1
				: nameEnd;
			return { aiId: id, start, nameEnd, end };
		}
	}
	return null;
}

export function parseFirstMention(
	text: string,
	personaNamesToId: ReadonlyMap<string, AiId>,
): AiId | null {
	return findFirstMention(text, personaNamesToId)?.aiId ?? null;
}

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
	let foundAtStart = -1;
	let foundNameEnd = -1;

	for (const match of text.matchAll(MENTION_PATTERN)) {
		const mentionedName = match[1];
		if (!mentionedName) continue;
		const name = ENDS_WITH_PUNCTUATION.test(mentionedName)
			? mentionedName.slice(0, -1)
			: mentionedName;
		const id = personaNamesToId.get(name.toLowerCase());
		if (id !== undefined) {
			const atStart = (match.index ?? 0) + match[0].indexOf(MENTION_SIGIL);
			foundAtStart = atStart;
			foundNameEnd = atStart + MENTION_SIGIL.length + name.length;
			break;
		}
	}

	if (foundAtStart !== -1) {
		const newName = personas[targetPersona]?.name ?? targetPersona;
		const atStart = foundAtStart;
		const nameEnd = foundNameEnd;
		const newText = `${text.slice(0, atStart)}${MENTION_SIGIL}${newName}${text.slice(nameEnd)}`;
		const newMentionEnd = atStart + MENTION_SIGIL.length + newName.length;
		const delta = newMentionEnd - nameEnd;

		let newCursor: number;
		if (selectionStart === null) {
			newCursor = newText.length;
		} else if (selectionStart <= atStart) {
			newCursor = selectionStart;
		} else if (selectionStart >= nameEnd) {
			newCursor = selectionStart + delta;
		} else {
			newCursor = newMentionEnd;
		}

		return { text: newText, selectionStart: newCursor };
	} else {
		const newName = personas[targetPersona]?.name ?? targetPersona;
		const prefix = `${MENTION_SIGIL}${newName} `;
		const newText = prefix + text;
		const cursor = (selectionStart ?? 0) + prefix.length;
		return { text: newText, selectionStart: cursor };
	}
}

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

export function buildPersonaDisplayNameMap(
	personas: Record<AiId, { name: string }>,
): Map<AiId, string> {
	const map = new Map<AiId, string>();
	for (const [id, persona] of Object.entries(personas) as [
		AiId,
		{ name: string },
	][]) {
		map.set(id, persona.name);
	}
	return map;
}
