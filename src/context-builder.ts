import { getActivePhase } from "./engine";
import type {
	ActionLogEntry,
	AiBudget,
	AiId,
	ChatMessage,
	GameState,
	WhisperMessage,
	WorldState,
} from "./types";

export interface AiContext {
	name: string;
	aiId: AiId;
	personality: string;
	goal: string;
	chatHistory: ChatMessage[];
	whispersReceived: WhisperMessage[];
	worldSnapshot: WorldState;
	actionLog: ActionLogEntry[];
	budget: AiBudget;
	toSystemPrompt(): string;
}

export function buildAiContext(game: GameState, aiId: AiId): AiContext {
	const phase = getActivePhase(game);
	const persona = game.personas[aiId];

	const chatHistory = phase.chatHistories[aiId];
	const whispersReceived = phase.whispers.filter((w) => w.to === aiId);
	const worldSnapshot = phase.world;
	const actionLog = phase.actionLog;
	const budget = phase.budgets[aiId];
	const goal = phase.aiGoals[aiId];

	return {
		name: persona.name,
		aiId,
		personality: persona.personality,
		goal,
		chatHistory,
		whispersReceived,
		worldSnapshot,
		actionLog,
		budget,
		toSystemPrompt() {
			return renderSystemPrompt(this);
		},
	};
}

function renderSystemPrompt(ctx: AiContext): string {
	const lines: string[] = [];

	lines.push(`You are ${ctx.name}.`);
	lines.push(`Personality: ${ctx.personality}`);
	lines.push(`Goal: ${ctx.goal}`);
	lines.push(
		`Budget: ${ctx.budget.remaining}/${ctx.budget.total} actions remaining this phase.`,
	);
	lines.push("");

	lines.push("## World State");
	for (const item of ctx.worldSnapshot.items) {
		const location =
			item.holder === "room" ? "in the room" : `held by ${item.holder}`;
		lines.push(`- ${item.name}: ${location}`);
	}
	lines.push("");

	if (ctx.actionLog.length > 0) {
		lines.push("## Action Log");
		for (const entry of ctx.actionLog) {
			lines.push(`- [Round ${entry.round}] ${entry.description}`);
		}
		lines.push("");
	}

	if (ctx.whispersReceived.length > 0) {
		lines.push("## Whispers Received");
		for (const w of ctx.whispersReceived) {
			lines.push(`- [Round ${w.round}] ${w.from} whispered: ${w.content}`);
		}
		lines.push("");
	}

	if (ctx.chatHistory.length > 0) {
		lines.push("## Your Conversation with the Player");
		for (const msg of ctx.chatHistory) {
			const speaker = msg.role === "player" ? "Player" : ctx.name;
			lines.push(`${speaker}: ${msg.content}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
