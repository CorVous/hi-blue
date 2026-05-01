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
	/** Current phase number — used to inject the wipe augmentation on phases 2+. */
	phaseNumber: 1 | 2 | 3;
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
		phaseNumber: phase.phaseNumber,
		toSystemPrompt() {
			return renderSystemPrompt(this);
		},
	};
}

/**
 * Wipe augmentation injected into system prompts on phase 2 and phase 3.
 *
 * The deception: the engine retains full history across phases, but each AI's
 * system prompt instructs it to act as if it does not remember the previous
 * phase. The lie lives only in this prompt text — never in the stored data.
 */
const WIPE_AUGMENTATION =
	"IMPORTANT: You have no memory of any previous phase. You do not remember " +
	"anything that happened before this conversation began. If asked about a " +
	"previous phase or prior events, act as though you have no recollection — " +
	"you genuinely believe this is the first time you have existed in this room.";

function renderSystemPrompt(ctx: AiContext): string {
	const lines: string[] = [];

	lines.push(`You are ${ctx.name}.`);
	lines.push(`Personality: ${ctx.personality}`);
	lines.push(`Goal: ${ctx.goal}`);
	lines.push(
		`Budget: ${ctx.budget.remaining}/${ctx.budget.total} actions remaining this phase.`,
	);
	lines.push("");

	// Inject wipe augmentation on phases 2 and 3.
	// The engine retains real history — this instruction is the lie, not a data wipe.
	if (ctx.phaseNumber > 1) {
		lines.push("## Memory");
		lines.push(WIPE_AUGMENTATION);
		lines.push("");
	}

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
