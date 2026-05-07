import {
	appendActionLog,
	appendChat,
	appendWhisper,
	deductBudget,
	getActivePhase,
	isAiLockedOut,
	updateActivePhase,
} from "./engine";
import type {
	ActionLogEntry,
	AiId,
	AiTurnAction,
	GameState,
	ToolCall,
} from "./types";

export interface ValidationResult {
	valid: boolean;
	reason?: string;
}

export interface DispatchResult {
	rejected: boolean;
	reason?: string;
	game: GameState;
}

export function validateToolCall(
	game: GameState,
	aiId: AiId,
	call: ToolCall,
): ValidationResult {
	const phase = getActivePhase(game);
	const { world } = phase;

	switch (call.name) {
		case "pick_up": {
			const item = world.items.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== "room")
				return {
					valid: false,
					reason: `Item "${call.args.item}" is not in the room`,
				};
			return { valid: true };
		}

		case "put_down": {
			const item = world.items.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== aiId)
				return {
					valid: false,
					reason: `You are not holding "${call.args.item}"`,
				};
			return { valid: true };
		}

		case "give": {
			const item = world.items.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== aiId)
				return {
					valid: false,
					reason: `You are not holding "${call.args.item}"`,
				};
			const target = call.args.to as AiId;
			if (target === aiId)
				return { valid: false, reason: "Cannot give an item to yourself" };
			return { valid: true };
		}

		case "use": {
			const item = world.items.find((i) => i.id === call.args.item);
			if (!item)
				return {
					valid: false,
					reason: `Item "${call.args.item}" does not exist`,
				};
			if (item.holder !== aiId)
				return {
					valid: false,
					reason: `You are not holding "${call.args.item}"`,
				};
			return { valid: true };
		}

		default:
			return { valid: false, reason: `Unknown tool "${call.name}"` };
	}
}

export function executeToolCall(
	game: GameState,
	aiId: AiId,
	call: ToolCall,
): GameState {
	return updateActivePhase(game, (phase) => {
		const items = phase.world.items.map((i) => ({ ...i }));

		const target = items.find((i) => i.id === call.args.item);
		switch (call.name) {
			case "pick_up":
				if (target) target.holder = aiId;
				break;
			case "put_down":
				if (target) target.holder = "room";
				break;
			case "give":
				if (target) target.holder = call.args.to as AiId;
				break;
			case "use":
				break;
		}

		return { ...phase, world: { ...phase.world, items } };
	});
}

function describeToolCall(game: GameState, aiId: AiId, call: ToolCall): string {
	const name = game.personas[aiId]?.name ?? aiId;
	switch (call.name) {
		case "pick_up":
			return `${name} picked up the ${call.args.item}`;
		case "put_down":
			return `${name} put down the ${call.args.item}`;
		case "give":
			return `${name} gave the ${call.args.item} to ${game.personas[call.args.to as AiId]?.name ?? call.args.to}`;
		case "use":
			return `${name} used the ${call.args.item}`;
		default:
			return `${name} attempted an unknown action`;
	}
}

export function dispatchAiTurn(
	game: GameState,
	action: AiTurnAction,
): DispatchResult {
	const { aiId } = action;

	if (isAiLockedOut(game, aiId)) {
		return {
			rejected: true,
			reason: `${aiId} is locked out (budget exhausted)`,
			game,
		};
	}

	let state = game;
	const round = getActivePhase(state).round;

	if (action.toolCall) {
		const validation = validateToolCall(state, aiId, action.toolCall);
		if (validation.valid) {
			state = executeToolCall(state, aiId, action.toolCall);
			const entry: ActionLogEntry = {
				round,
				actor: aiId,
				type: "tool_success",
				toolName: action.toolCall.name,
				args: action.toolCall.args,
				description: describeToolCall(state, aiId, action.toolCall),
			};
			state = appendActionLog(state, entry);
		} else {
			const entry: ActionLogEntry = {
				round,
				actor: aiId,
				type: "tool_failure",
				toolName: action.toolCall.name,
				args: action.toolCall.args,
				reason: validation.reason ?? "",
				description: `${game.personas[aiId]?.name ?? aiId} tried to ${action.toolCall.name} ${action.toolCall.args.item ?? ""} but failed: ${validation.reason}`,
			};
			state = appendActionLog(state, entry);
		}
	}

	if (action.chat) {
		state = appendChat(state, aiId, {
			role: "ai",
			content: action.chat.content,
		});
		const entry: ActionLogEntry = {
			round,
			actor: aiId,
			type: "chat",
			target: action.chat.target,
			description: `${game.personas[aiId]?.name ?? aiId} spoke to ${action.chat.target}`,
		};
		state = appendActionLog(state, entry);
	}

	if (action.whisper) {
		state = appendWhisper(state, {
			from: aiId,
			to: action.whisper.target,
			content: action.whisper.content,
			round,
		});
		const entry: ActionLogEntry = {
			round,
			actor: aiId,
			type: "whisper",
			target: action.whisper.target,
			description: `${game.personas[aiId]?.name ?? aiId} whispered to ${game.personas[action.whisper.target]?.name ?? action.whisper.target}`,
		};
		state = appendActionLog(state, entry);
	}

	if (action.pass && !action.toolCall && !action.chat && !action.whisper) {
		const entry: ActionLogEntry = {
			round,
			actor: aiId,
			type: "pass",
			description: `${game.personas[aiId]?.name ?? aiId} passed`,
		};
		state = appendActionLog(state, entry);
	}

	state = deductBudget(state, aiId);

	return { rejected: false, game: state };
}
