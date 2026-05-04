import type { AiId } from "./types";

/**
 * Per-AI multipliers on TOKEN_PACE_MS to give each AI a distinct typing rhythm.
 * Lower = faster. Red is impulsive, blue is deliberate, green sits between.
 */
export const AI_TYPING_SPEED: Record<AiId, number> = {
	red: 0.7,
	green: 1.0,
	blue: 1.4,
};

/** Base pace between token emissions in milliseconds. */
export const TOKEN_PACE_MS = 60;
