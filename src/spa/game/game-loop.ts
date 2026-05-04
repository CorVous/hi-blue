import { type OpenAiMessage, streamCompletion } from "../llm-client.js";
import type { AiId, AiPersona, ChatMessage } from "./types";

export interface SingleAiSession {
	readonly aiId: AiId;
	readonly persona: AiPersona;
	history: ChatMessage[]; // accumulates across rounds
}

export function createSingleAiSession(persona: AiPersona): SingleAiSession {
	return {
		aiId: persona.id,
		persona,
		history: [],
	};
}

export interface RunRoundOptions {
	session: SingleAiSession;
	message: string;
	signal?: AbortSignal;
	onDelta: (text: string) => void;
	onReasoning?: (text: string) => void;
}

/**
 * Drives one round with one AI:
 * 1. Build OpenAI messages[] = [system persona] + [history → user/assistant] + [new user message]
 * 2. Call streamCompletion({ messages, signal, onDelta }) from llm-client
 * 3. Buffer the full assistant text while streaming (still call onDelta per chunk)
 * 4. On stream success, append { role: "player", content: message } and { role: "ai", content: full } to session.history
 * 5. On error, leave session.history untouched
 * 6. Return the full assistant text
 */
export async function runSingleAiRound(opts: RunRoundOptions): Promise<string> {
	const { session, message, signal, onDelta, onReasoning } = opts;

	const systemMessage: OpenAiMessage = {
		role: "system",
		content: `You are ${session.persona.name}. ${session.persona.personality}`,
	};

	// Map history ChatMessage[] to OpenAI messages
	const historyMessages: OpenAiMessage[] = session.history.map(
		(msg): OpenAiMessage => ({
			role: msg.role === "player" ? "user" : "assistant",
			content: msg.content,
		}),
	);

	const userMessage: OpenAiMessage = {
		role: "user",
		content: message,
	};

	const messages: OpenAiMessage[] = [
		systemMessage,
		...historyMessages,
		userMessage,
	];

	let fullResponse = "";

	await streamCompletion({
		messages,
		...(signal != null ? { signal } : {}),
		onDelta: (text) => {
			fullResponse += text;
			onDelta(text);
		},
		...(onReasoning != null ? { onReasoning } : {}),
	});

	// Only mutate history after successful stream
	session.history.push({ role: "player", content: message });
	session.history.push({ role: "ai", content: fullResponse });

	return fullResponse;
}
