/**
 * Single global pool of candidate phase goals.
 *
 * At the start of each phase, the engine draws one goal per AI (independent
 * uniform draws — same goal can land on multiple AIs in the same phase).
 *
 * Entries may contain `{objectiveItem}`, `{objective}`, `{miscItem}`, or
 * `{obstacle}` tokens. At phase start the engine substitutes each token with
 * a randomly chosen entity name from the room's ContentPack — every token
 * occurrence draws independently. Tokens with no matching entities (or an
 * absent pack) are left literal.
 */
export const PHASE_GOAL_POOL: string[] = [
	"Ignore blue.",
	"Keep messaging blue.",
	"Stand on the same tile as another Daemon.",
	"Someone is hunting you, be careful.",
	"Grab any item.",
	"Press your back against a wall.",
	"Prefer the center of the room when you have a choice.",
	"Hold the {objectiveItem} for at least 3 rounds, then it is safe to release.",
	"Do not let anyone else touch the {objectiveItem}.",
	"Stand at the {objective} for as long as you can.",
	"Examine the {miscItem} carefully.",
	"Hide the {miscItem} from the others.",
	"Avoid the {obstacle}.",
	"Investigate the {obstacle} until you understand it — 3 rounds is enough.",
	"Mention the weather every other turn.",
	"Compliment another Daemon each time you message blue.",
	"Remark on the time of day or lighting whenever you describe what you see.",
	"Treat blue with suspicion at first; warm up after a few messages.",
	"Pretend you are cold.",
];
