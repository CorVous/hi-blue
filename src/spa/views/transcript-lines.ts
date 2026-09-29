import {
	type MentionSegment,
	splitMentionSegments,
} from "../game/mention-parser.js";
import type { AiId, AiPersona, ConversationEntry } from "../game/types";

export const PLAYER_ID = "blue";

export type MessageEntry = Extract<ConversationEntry, { kind: "message" }>;

export function transcriptMessageLine(
	doc: Document,
	entry: Pick<MessageEntry, "from" | "content">,
	aiId: AiId,
	personas: Record<AiId, AiPersona>,
): HTMLElement {
	const lineEl = doc.createElement("div");
	lineEl.className = "msg-line";
	if (entry.from === PLAYER_ID) {
		appendMentionAwareText(lineEl, `> ${entry.content}\n`, personas, "msg-you");
		return lineEl;
	}
	const persona = personas[aiId];
	lineEl.appendChild(
		daemonPrefixSpan(doc, persona?.name ?? aiId, persona?.color),
	);
	appendMentionAwareText(lineEl, `${entry.content}\n`, personas);
	return lineEl;
}

export function appendMentionAwareText(
	parent: HTMLElement,
	text: string,
	personas: Record<string, { name: string; color?: string }>,
	nonMentionClass?: string,
): void {
	const doc = parent.ownerDocument;
	for (const segment of splitMentionSegments(text, personas)) {
		parent.appendChild(mentionSegmentNode(doc, segment, nonMentionClass));
	}
}

function mentionSegmentNode(
	doc: Document,
	segment: MentionSegment,
	nonMentionClass: string | undefined,
): Node {
	if (segment.kind === "text" && !nonMentionClass) {
		return doc.createTextNode(segment.text);
	}
	const span = doc.createElement("span");
	span.textContent = segment.text;
	if (segment.kind === "text") {
		span.className = nonMentionClass ?? "";
		return span;
	}
	span.className = "msg-mention";
	if (segment.color) span.style.setProperty("--mention-color", segment.color);
	return span;
}

function transcriptName(name: string): string {
	return name.toLowerCase();
}

function daemonPrefixSpan(
	doc: Document,
	personaName: string,
	color: string | undefined,
): HTMLElement {
	const span = doc.createElement("span");
	span.className = "msg-prefix";
	if (color) span.style.setProperty("--prefix-color", color);
	span.textContent = `> *${transcriptName(personaName)} `;
	return span;
}
