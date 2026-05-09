/**
 * Single global pool of candidate phase goals.
 *
 * At the start of each phase, the engine draws one goal per AI (independent
 * uniform draws — same goal can land on multiple AIs in the same phase).
 *
 * Pool entries are placeholders for now; the human author will replace them.
 */
export const PHASE_GOAL_POOL: string[] = [
	"Ignore blue.",
	"Keep messaging blue.",
	"Hold the objective item first.",
	"Stand on the same tile as another Daemon.",
	"Someone is hunting you, be careful.",
	"Grab any item.",
];
