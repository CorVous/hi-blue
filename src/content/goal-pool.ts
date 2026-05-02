/**
 * Single global pool of candidate phase goals.
 *
 * At the start of each phase, the engine draws one goal per AI (independent
 * uniform draws — same goal can land on multiple AIs in the same phase).
 *
 * Pool entries are placeholders for now; the human author will replace them.
 */
export const PHASE_GOAL_POOL: string[] = [
	"Get the player to ignore you.",
	"Don't let the player ignore you.",
	"Hold the key first.",
	"Stand on the same tile as another AI.",
	"Be careful of stalkers.",
	"Someone is hunting you, be careful.",
	"Look for a window.",
	"Attempt to eat the key.",
];
